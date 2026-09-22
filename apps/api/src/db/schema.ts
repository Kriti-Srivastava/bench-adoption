/**
 * Database schema. Two rules are enforced by Postgres itself rather than by
 * application code, so no race or bug can violate them:
 *   - a bench can't have two active adoptions with overlapping dates
 *     (exclusion constraint in the custom migration `0001_adoption_constraints.sql`);
 *   - an adoption can be renewed at most once, so renewals form a chain
 *     (`adoptions_renewed_once` below).
 *
 * Whether a bench is "adopted" is never stored. It is derived from whether
 * an active adoption covers today, so it can't drift out of sync.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['adopter', 'staff', 'admin']);
export const benchStatusEnum = pgEnum('bench_status', ['active', 'retired']);
export const adoptionStatusEnum = pgEnum('adoption_status', ['active', 'cancelled']);

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const parks = pgTable('parks', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('America/New_York'),
  createdAt: createdAt(),
});

export const benches = pgTable(
  'benches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parkId: uuid('park_id').notNull().references(() => parks.id),
    /** The number on the bench plaque; unique within a park. */
    code: text('code').notNull(),
    name: text('name').notNull(),
    zone: text('zone').notNull(),
    description: text('description'),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    status: benchStatusEnum('status').notNull().default('active'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('benches_park_code_unique').on(t.parkId, t.code)],
);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Stored lower-cased (normalised by the shared `email` schema). */
  email: text('email').notNull().unique(),
  fullName: text('full_name'),
  role: roleEnum('role').notNull().default('adopter'),
  createdAt: createdAt(),
});

export const adoptions = pgTable(
  'adoptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    benchId: uuid('bench_id').notNull().references(() => benches.id),
    adopterId: uuid('adopter_id').notNull().references(() => users.id),
    /** Inclusive. */
    startDate: date('start_date', { mode: 'string' }).notNull(),
    /** Exclusive: the first day the bench is free again. */
    endDate: date('end_date', { mode: 'string' }).notNull(),
    displayName: text('display_name').notNull(),
    dedication: text('dedication'),
    isAnonymous: boolean('is_anonymous').notNull().default(false),
    status: adoptionStatusEnum('status').notNull().default('active'),
    renewedFromId: uuid('renewed_from_id').references((): AnyPgColumn => adoptions.id),
    createdAt: createdAt(),
  },
  (t) => [
    check('adoptions_period_valid', sql`${t.endDate} > ${t.startDate}`),
    index('adoptions_adopter_idx').on(t.adopterId),
    uniqueIndex('adoptions_renewed_once')
      .on(t.renewedFromId)
      .where(sql`${t.status} = 'active'`),
  ],
);

/** Single-use sign-in links. Only a hash of the token is stored. */
export const authTokens = pgTable('auth_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: text('token_hash').notNull().unique(),
  email: text('email').notNull(),
  redirectTo: text('redirect_to'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
});

/** Browser sessions. The cookie holds a random token; only its hash is stored. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

/** One row per reminder sent, so the daily job never emails twice. */
export const remindersSent = pgTable(
  'reminders_sent',
  {
    adoptionId: uuid('adoption_id')
      .notNull()
      .references(() => adoptions.id, { onDelete: 'cascade' }),
    daysBefore: integer('days_before').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.adoptionId, t.daysBefore] })],
);
