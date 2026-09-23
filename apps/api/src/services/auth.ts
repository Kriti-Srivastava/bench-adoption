import { createHash, randomBytes } from 'node:crypto';
import type { Me, Role } from '@bench/shared';
import { AppError, conflict, notFound, tooManyRequests } from '../errors.ts';
import * as userRepo from '../repositories/users.ts';
import type { UserRow } from '../repositories/users.ts';
import type { AppContext } from './context.ts';
import { recordEvent } from './events.ts';

const newToken = () => randomBytes(32).toString('base64url');
/** Tokens are stored hashed, so a database leak doesn't expose live links or sessions. */
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const MINUTE = 60_000;
const DAY = 86_400_000;

export const toMe = (u: UserRow): Me => ({
  id: u.id,
  email: u.email,
  fullName: u.fullName,
  role: u.role,
});

export function createAuthService(ctx: AppContext) {
  const { db, config } = ctx;

  return {
    /**
     * Emails a single-use sign-in link. Behaves identically whether or not an
     * account exists; the account is created when the link is first used.
     */
    /**
     * Emails a sign-in link. The staff entrance issues short-lived links and
     * only to accounts that actually have park-staff access; anyone else is
     * told so by email, which avoids revealing who does have access.
     */
    async requestMagicLink(
      email: string,
      redirectTo: string | null,
      audience: 'donor' | 'staff' = 'donor',
    ): Promise<void> {
      const token = newToken();
      const now = ctx.clock.now();
      const limits = config.magicLinkPerEmail;
      const ttlMinutes = audience === 'staff' ? config.staffMagicLinkTtlMinutes : config.magicLinkTtlMinutes;

      if (audience === 'staff') {
        const user = await userRepo.findUserByEmail(db, email);
        if (!user || user.role === 'adopter') {
          await db.transaction((tx) => recordEvent(tx, ctx, { type: 'signin.refused', payload: { email } }));
          return;
        }
      }
      await db.transaction(async (tx) => {
        await userRepo.lockEmail(tx, email);
        const recent = await userRepo.recentAuthTokens(tx, email, new Date(now.getTime() - 60 * MINUTE));
        if (recent.latest && now.getTime() - recent.latest.getTime() < limits.minIntervalSeconds * 1000) {
          throw tooManyRequests('A sign-in link was just sent to this address. Please wait a minute and try again.');
        }
        if (recent.count >= limits.maxPerHour) {
          throw tooManyRequests('Too many sign-in links were requested for this address. Please try again later.');
        }
        await userRepo.insertAuthToken(tx, {
          tokenHash: hashToken(token),
          email,
          redirectTo,
          audience,
          expiresAt: new Date(now.getTime() + ttlMinutes * MINUTE),
          createdAt: now,
        });
        // Queued with the token, so a mail outage delays the link rather than
        // failing the request (and the person is not locked out by the limit).
        await recordEvent(tx, ctx, {
          type: 'signin.requested',
          payload: {
            email,
            link: `${config.webUrl}/auth/verify?token=${encodeURIComponent(token)}`,
            ttlMinutes,
            audience,
          },
        });
      });
    },

    /** Redeems a magic link and opens a session. */
    async verifyMagicLink(token: string) {
      const now = ctx.clock.now();
      const used = await userRepo.consumeAuthToken(db, hashToken(token), now);
      if (!used) {
        throw new AppError(400, 'invalid_link', 'This sign-in link is invalid or has expired.');
      }
      const user = await userRepo.findOrCreateUser(db, used.email);
      // A link only opens the door it was asked for, in both directions: the
      // two entrances stay separate even if an account's role changed (or was
      // revoked) between the link being issued and used.
      const isStaffAccount = user.role !== 'adopter';
      if (used.audience === 'staff' && !isStaffAccount) {
        throw new AppError(403, 'no_staff_access', 'This account does not have park-staff access.');
      }
      if (used.audience === 'donor' && isStaffAccount) {
        throw new AppError(
          403,
          'use_staff_entrance',
          'This is a park-staff account. Sign in through the "Park staff" link at the bottom of the page.',
        );
      }
      const sessionToken = newToken();
      const sessionExpiresAt = new Date(now.getTime() + config.sessionTtlDays * DAY);
      await userRepo.insertSession(db, {
        tokenHash: hashToken(sessionToken),
        userId: user.id,
        expiresAt: sessionExpiresAt,
      });
      return { user, sessionToken, sessionExpiresAt, redirectTo: used.redirectTo };
    },

    async userForSession(sessionToken: string): Promise<UserRow | undefined> {
      return userRepo.findSessionUser(db, hashToken(sessionToken), ctx.clock.now());
    },

    async logout(sessionToken: string): Promise<void> {
      await userRepo.deleteSession(db, hashToken(sessionToken));
    },

    async updateProfile(user: UserRow, fullName: string): Promise<UserRow> {
      return (await userRepo.updateUser(db, user.id, { fullName }))!;
    },

    /** Deletes expired sessions and day-old sign-in links. */
    async purgeExpired() {
      return userRepo.purgeExpiredAuth(db, ctx.clock.now());
    },

    /**
     * Grants a role; creates the account if the person hasn't signed in yet.
     * `actor` is the admin making the change (absent for command-line use);
     * admins can't demote themselves, so the park can't lose its last admin by accident.
     */
    async setRole(email: string, role: Role, actor?: UserRow): Promise<UserRow> {
      if (actor && actor.email === email && role !== actor.role) {
        throw conflict('cannot_change_own_role', "You can't change your own role. Ask another admin.");
      }
      const user = await userRepo.findOrCreateUser(db, email);
      const updated = await userRepo.updateUser(db, user.id, { role });
      if (!updated) throw notFound('User');
      return updated;
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
