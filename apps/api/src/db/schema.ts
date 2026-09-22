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
  eventTypes,
  maintenancePriorities,
  maintenanceStatuses,
  maintenanceTypes,
  signInAudiences,
} from '@bench/shared';
import {
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['adopter', 'staff', 'admin']);
export const benchStatusEnum = pgEnum('bench_status', ['active', 'retired']);
export const adoptionStatusEnum = pgEnum('adoption_status', ['active', 'cancelled']);
export const eventTypeEnum = pgEnum('event_type', eventTypes);
export const outboxStatusEnum = pgEnum('outbox_status', ['pending', 'sent', 'failed']);
export const signInAudienceEnum = pgEnum('sign_in_audience', signInAudiences);
export const maintenanceTypeEnum = pgEnum('maintenance_type', maintenanceTypes);
export const maintenanceStatusEnum = pgEnum('maintenance_status', maintenanceStatuses);
export const maintenancePriorityEnum = pgEnum('maintenance_priority', maintenancePriorities);

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const parks = pgTable(
  'parks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    timezone: text('timezone').notNull().default('America/New_York'),
    /**
     * Adoption lengths this park offers, in months. Van Cortlandt Park
     * Alliance adopts benches for a fixed 10-year term.
     */
    adoptionTermsMonths: integer('adoption_terms_months')
      .array()
      .notNull()
      .default(sql`'{120}'::integer[]`),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'parks_adoption_terms_valid',
      sql`cardinality(${t.adoptionTermsMonths}) >= 1 and 1 <= all(${t.adoptionTermsMonths}) and 120 >= all(${t.adoptionTermsMonths})`,
    ),
  ],
);

/** Nature and history notes shown to visitors; any number per area or trail. */
const facts = () =>
  text('facts')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`);

/** A named part of a park (e.g. "Van Cortlandt Lake"). Every bench is in one. */
export const areas = pgTable(
  'areas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parkId: uuid('park_id').notNull().references(() => parks.id),
    name: text('name').notNull(),
    description: text('description'),
    facts: facts(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('areas_park_name_unique').on(t.parkId, t.name),
    // Lets benches reference (area, park) so an area can't belong to another park.
    unique('areas_id_park_unique').on(t.id, t.parkId),
  ],
);

/** A walking trail. Benches along it are linked through `bench_trails`. */
export const trails = pgTable(
  'trails',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parkId: uuid('park_id').notNull().references(() => parks.id),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    lengthMiles: real('length_miles'),
    facts: facts(),
    /** The route as [lat, lng] points, in walking order. */
    path: jsonb('path').$type<[number, number][]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('trails_park_slug_unique').on(t.parkId, t.slug),
    unique('trails_id_park_unique').on(t.id, t.parkId),
    check('trails_length_non_negative', sql`${t.lengthMiles} is null or ${t.lengthMiles} >= 0`),
    check(
      'trails_path_is_line',
      sql`jsonb_typeof(${t.path}) = 'array' and jsonb_array_length(${t.path}) >= 2`,
    ),
  ],
);

export const benches = pgTable(
  'benches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parkId: uuid('park_id').notNull().references(() => parks.id),
    /** The number on the bench plaque; unique within a park. */
    code: text('code').notNull(),
    name: text('name').notNull(),
    areaId: uuid('area_id').notNull(),
    description: text('description'),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    status: benchStatusEnum('status').notNull().default('active'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('benches_park_code_unique').on(t.parkId, t.code),
    index('benches_area_idx').on(t.areaId),
    unique('benches_id_park_unique').on(t.id, t.parkId),
    // The bench's area must be in the same park as the bench.
    foreignKey({
      name: 'benches_area_same_park_fk',
      columns: [t.areaId, t.parkId],
      foreignColumns: [areas.id, areas.parkId],
    }),
    check('benches_lat_range', sql`${t.lat} between -90 and 90`),
    check('benches_lng_range', sql`${t.lng} between -180 and 180`),
  ],
);

/** Which benches sit along which trails (a bench at a junction can be on several). */
export const benchTrails = pgTable(
  'bench_trails',
  {
    benchId: uuid('bench_id').notNull(),
    trailId: uuid('trail_id').notNull(),
    /** Carried so both foreign keys can require the bench and trail to share a park. */
    parkId: uuid('park_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.benchId, t.trailId] }),
    index('bench_trails_trail_idx').on(t.trailId),
    foreignKey({
      name: 'bench_trails_bench_same_park_fk',
      columns: [t.benchId, t.parkId],
      foreignColumns: [benches.id, benches.parkId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'bench_trails_trail_same_park_fk',
      columns: [t.trailId, t.parkId],
      foreignColumns: [trails.id, trails.parkId],
    }).onDelete('cascade'),
  ],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Stored lower-cased, so uniqueness is case-insensitive. */
    email: text('email').notNull().unique(),
    fullName: text('full_name'),
    role: roleEnum('role').notNull().default('adopter'),
    createdAt: createdAt(),
  },
  (t) => [check('users_email_lowercase', sql`${t.email} = lower(${t.email})`)],
);

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
    check('adoptions_display_name_length', sql`char_length(${t.displayName}) between 1 and 80`),
    check('adoptions_dedication_length', sql`char_length(${t.dedication}) <= 280`),
    index('adoptions_adopter_idx').on(t.adopterId),
    // For "ending soon" lists and the daily reminder job.
    index('adoptions_active_end_idx')
      .on(t.endDate)
      .where(sql`${t.status} = 'active'`),
    uniqueIndex('adoptions_renewed_once')
      .on(t.renewedFromId)
      .where(sql`${t.status} = 'active'`),
  ],
);

/** Single-use sign-in links. Only a hash of the token is stored. */
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull().unique(),
    email: text('email').notNull(),
    redirectTo: text('redirect_to'),
    /** Which entrance issued it: park staff links are short-lived. */
    audience: signInAudienceEnum('audience').notNull().default('donor'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  // Per-address rate limiting counts recent links for an email.
  (t) => [index('auth_tokens_email_created_idx').on(t.email, t.createdAt)],
);

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

/**
 * Upkeep work on a bench: inspections, repairs, painting, plaque work and so
 * on. Raised by staff, by visitors reporting a problem, or automatically
 * (a plaque to install when a bench is adopted). Done tasks form the bench's
 * maintenance history, from which "last inspected" is derived.
 */
export const maintenanceTasks = pgTable(
  'maintenance_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    benchId: uuid('bench_id')
      .notNull()
      .references(() => benches.id),
    type: maintenanceTypeEnum('type').notNull(),
    status: maintenanceStatusEnum('status').notNull().default('open'),
    priority: maintenancePriorityEnum('priority').notNull().default('normal'),
    title: text('title').notNull(),
    details: text('details'),
    reportedById: uuid('reported_by_id').references(() => users.id),
    assigneeId: uuid('assignee_id').references(() => users.id),
    /** The adoption this task serves, e.g. installing its plaque. */
    adoptionId: uuid('adoption_id').references(() => adoptions.id),
    scheduledFor: date('scheduled_for', { mode: 'string' }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    resolution: text('resolution'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('maintenance_bench_idx').on(t.benchId),
    index('maintenance_open_idx')
      .on(t.status, t.priority)
      .where(sql`${t.status} in ('open', 'scheduled', 'in_progress')`),
    index('maintenance_reporter_idx').on(t.reportedById),
    check('maintenance_title_length', sql`char_length(${t.title}) between 1 and 120`),
    // A task is complete exactly when it is marked done.
    check(
      'maintenance_completed_when_done',
      sql`(${t.status} = 'done') = (${t.completedAt} is not null)`,
    ),
  ],
);

/**
 * Append-only history of what happened. Written in the same transaction as
 * the change it describes, so the record and the change can never disagree.
 */
export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: eventTypeEnum('type').notNull(),
    benchId: uuid('bench_id').references(() => benches.id),
    adoptionId: uuid('adoption_id').references(() => adoptions.id),
    /** Who caused it (staff member or donor); absent for scheduled jobs. */
    actorId: uuid('actor_id').references(() => users.id),
    /** Everything needed to render notifications, captured when it happened. */
    payload: jsonb('payload').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('events_bench_idx').on(t.benchId), index('events_adoption_idx').on(t.adoptionId)],
);

/**
 * Emails waiting to be sent, written with their event in one transaction
 * (the "transactional outbox"): a confirmation can't be lost because mail
 * was down, and can't be sent for a change that was rolled back. A worker
 * sends them and retries with backoff.
 */
export const outbox = pgTable(
  'outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    recipient: text('recipient').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    status: outboxStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('outbox_due_idx').on(t.status, t.nextAttemptAt),
    check('outbox_sent_when_sent', sql`(${t.status} = 'sent') = (${t.sentAt} is not null)`),
  ],
);
