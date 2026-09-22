import { createHash, randomBytes } from 'node:crypto';
import type { Me, Role } from '@bench/shared';
import { magicLinkEmail } from '../email/templates.ts';
import { AppError, notFound } from '../errors.ts';
import * as userRepo from '../repositories/users.ts';
import type { UserRow } from '../repositories/users.ts';
import type { AppContext } from './context.ts';

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
    async requestMagicLink(email: string, redirectTo: string | null): Promise<void> {
      const token = newToken();
      await userRepo.insertAuthToken(db, {
        tokenHash: hashToken(token),
        email,
        redirectTo,
        expiresAt: new Date(ctx.clock.now().getTime() + config.magicLinkTtlMinutes * MINUTE),
      });
      const link = `${config.webUrl}/auth/verify?token=${encodeURIComponent(token)}`;
      // Unlike confirmations, a failed sign-in email is the user's whole request.
      await ctx.mailer.send(magicLinkEmail(email, { link, ttlMinutes: config.magicLinkTtlMinutes }));
    },

    /** Redeems a magic link and opens a session. */
    async verifyMagicLink(token: string) {
      const now = ctx.clock.now();
      const used = await userRepo.consumeAuthToken(db, hashToken(token), now);
      if (!used) {
        throw new AppError(400, 'invalid_link', 'This sign-in link is invalid or has expired.');
      }
      const user = await userRepo.findOrCreateUser(db, used.email);
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

    /** Grants a role; creates the account if the person hasn't signed in yet. */
    async setRole(email: string, role: Role): Promise<UserRow> {
      const user = await userRepo.findOrCreateUser(db, email);
      const updated = await userRepo.updateUser(db, user.id, { role });
      if (!updated) throw notFound('User');
      return updated;
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
