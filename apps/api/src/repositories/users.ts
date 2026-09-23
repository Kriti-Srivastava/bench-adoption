import { and, asc, eq, gt, ilike, isNull, lt, or, sql } from 'drizzle-orm';
import { LIST_LIMIT, type Role } from '@bench/shared';
import { likeContains, type Executor } from '../db/client.ts';
import { adoptions, authTokens, sessions, users } from '../db/schema.ts';

export type UserRow = typeof users.$inferSelect;

/** Returns the user with this email, creating an adopter account if needed. */
export async function findOrCreateUser(db: Executor, email: string): Promise<UserRow> {
  await db.insert(users).values({ email }).onConflictDoNothing({ target: users.email });
  const [row] = await db.select().from(users).where(eq(users.email, email));
  return row!;
}

export async function findUserByEmail(db: Executor, email: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.email, email));
  return row;
}

export async function findUserById(db: Executor, id: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row;
}

/** Users for the admin screen, with how many adoptions each has running. */
export async function listUsers(
  db: Executor,
  f: { q?: string; role?: Role; now: Date },
): Promise<(UserRow & { activeAdoptions: number })[]> {
  const pattern = f.q ? likeContains(f.q) : undefined;
  // "Today" is per park, so compare each adoption against its own park's date.
  // (users.id is written out in full: Drizzle leaves single-table columns
  // unqualified, which would be ambiguous inside the subquery.)
  return db
    .select({
      ...usersColumns,
      activeAdoptions: sql<number>`(
        select count(*)::int
        from ${adoptions} a
        join benches b on b.id = a.bench_id
        join parks p on p.id = b.park_id
        where a.adopter_id = "users"."id" and a.status = 'active'
          and a.end_date > (${f.now.toISOString()}::timestamptz at time zone p.timezone)::date
      )`,
    })
    .from(users)
    .where(
      and(
        pattern ? or(ilike(users.email, pattern), ilike(users.fullName, pattern)) : undefined,
        f.role ? eq(users.role, f.role) : undefined,
      ),
    )
    .orderBy(asc(users.email))
    .limit(LIST_LIMIT);
}

/** How many accounts the same filter matches, cap or no cap. */
export async function countUsers(db: Executor, f: { q?: string; role?: Role }): Promise<number> {
  const pattern = f.q ? likeContains(f.q) : undefined;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(
      and(
        pattern ? or(ilike(users.email, pattern), ilike(users.fullName, pattern)) : undefined,
        f.role ? eq(users.role, f.role) : undefined,
      ),
    );
  return row?.count ?? 0;
}

const usersColumns = {
  id: users.id,
  email: users.email,
  fullName: users.fullName,
  role: users.role,
  createdAt: users.createdAt,
};

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
  values: {
    tokenHash: string;
    email: string;
    redirectTo: string | null;
    audience: 'donor' | 'staff';
    expiresAt: Date;
    createdAt: Date;
  },
): Promise<void> {
  await db.insert(authTokens).values(values);
}

/**
 * Serialises sign-in requests for one address across every API instance
 * (a transaction-scoped Postgres advisory lock), so rate-limit checks can't race.
 */
export async function lockEmail(db: Executor, email: string): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${email}, 0))`);
}

/** How many sign-in links were issued to an address since `since`, and when the latest was. */
export async function recentAuthTokens(db: Executor, email: string, since: Date) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int`, latest: sql<string | null>`max(${authTokens.createdAt})` })
    .from(authTokens)
    .where(and(eq(authTokens.email, email), gt(authTokens.createdAt, since)));
  return { count: row?.count ?? 0, latest: row?.latest ? new Date(row.latest) : null };
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

// ---------------------------------------------------------------- housekeeping

/**
 * Deletes expired sessions, and sign-in links older than a day. Links are
 * kept that long (well past their 15-minute life) because the per-address
 * rate limit counts them.
 */
export async function purgeExpiredAuth(db: Executor, now: Date) {
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const tokens = await db
    .delete(authTokens)
    .where(lt(authTokens.createdAt, dayAgo))
    .returning({ id: authTokens.id });
  const expired = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, now))
    .returning({ id: sessions.id });
  return { tokens: tokens.length, sessions: expired.length };
}
