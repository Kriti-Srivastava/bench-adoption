import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Role } from '@bench/shared';
import type { Executor } from '../db/client.ts';
import { authTokens, sessions, users } from '../db/schema.ts';

export type UserRow = typeof users.$inferSelect;

/** Returns the user with this email, creating an adopter account if needed. */
export async function findOrCreateUser(db: Executor, email: string): Promise<UserRow> {
  await db.insert(users).values({ email }).onConflictDoNothing({ target: users.email });
  const [row] = await db.select().from(users).where(eq(users.email, email));
  return row!;
}

export async function updateUser(
  db: Executor,
  id: string,
  values: { fullName?: string; role?: Role },
): Promise<UserRow | undefined> {
  const [row] = await db.update(users).set(values).where(eq(users.id, id)).returning();
  return row;
}

// ---------------------------------------------------------------- magic links

export async function insertAuthToken(
  db: Executor,
  values: { tokenHash: string; email: string; redirectTo: string | null; expiresAt: Date },
): Promise<void> {
  await db.insert(authTokens).values(values);
}

/**
 * Marks an unused, unexpired token as used and returns it. The single
 * conditional UPDATE means a link can't be redeemed twice, even concurrently.
 */
export async function consumeAuthToken(db: Executor, tokenHash: string, now: Date) {
  const [row] = await db
    .update(authTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(authTokens.tokenHash, tokenHash),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, now),
      ),
    )
    .returning();
  return row;
}

// ---------------------------------------------------------------- sessions

export async function insertSession(
  db: Executor,
  values: { tokenHash: string; userId: string; expiresAt: Date },
): Promise<void> {
  await db.insert(sessions).values(values);
}

export async function findSessionUser(
  db: Executor,
  tokenHash: string,
  now: Date,
): Promise<UserRow | undefined> {
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)));
  return row?.user;
}

export async function deleteSession(db: Executor, tokenHash: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}
