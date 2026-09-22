/**
 * The API contract. Every request body, query string and response is
 * described here once and shared by the server (validation + OpenAPI docs)
 * and every client (web today, mobile later).
 */
import { z } from 'zod';

// ---------------------------------------------------------------- primitives

export const isoDate = z.iso.date();
export const id = z.uuid();

export const email = z.string().trim().toLowerCase().pipe(z.email());

/** Adoption terms are whole months within this range. */
export const ADOPTION_TERM_MONTHS = { min: 1, max: 60 } as const;
/** Terms offered as quick choices in the UI (any value in range is accepted). */
export const SUGGESTED_TERMS_MONTHS = [6, 12, 24, 36] as const;

export const termMonths = z
  .number()
  .int()
  .min(ADOPTION_TERM_MONTHS.min)
  .max(ADOPTION_TERM_MONTHS.max);

export const roles = ['adopter', 'staff', 'admin'] as const;
export const role = z.enum(roles);
export type Role = z.infer<typeof role>;

export const benchStatus = z.enum(['active', 'retired']);
export const adoptionStatus = z.enum(['active', 'cancelled']);
export const availability = z.enum(['available', 'adopted']);

// ---------------------------------------------------------------- errors

export const errorResponse = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ErrorResponse = z.infer<typeof errorResponse>;

// ---------------------------------------------------------------- parks

export const park = z.object({
  id,
  slug: z.string(),
  name: z.string(),
  timezone: z.string(),
  zones: z.array(z.string()),
});
export type Park = z.infer<typeof park>;

// ---------------------------------------------------------------- benches

/** What the public may see about an adoption: never the adopter's email. */
export const publicAdoption = z.object({
  displayName: z.string(),
  dedication: z.string().nullable(),
  startDate: isoDate,
  endDate: isoDate,
});
export type PublicAdoption = z.infer<typeof publicAdoption>;

export const benchSummary = z.object({
  id,
  code: z.string(),
  name: z.string(),
  zone: z.string(),
  lat: z.number(),
  lng: z.number(),
  status: benchStatus,
  currentAdoption: publicAdoption.nullable(),
});
export type BenchSummary = z.infer<typeof benchSummary>;

export const benchDetail = benchSummary.extend({
  description: z.string().nullable(),
  /** First date the bench is free, after the current adoption and any renewals. */
  availableFrom: isoDate,
});
export type BenchDetail = z.infer<typeof benchDetail>;

export const listBenchesQuery = z.object({
  availability: availability.optional(),
  zone: z.string().optional(),
  q: z.string().trim().min(1).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});
/** What a client may send: every field optional, with its parsed type. */
export type ListBenchesQuery = Partial<z.infer<typeof listBenchesQuery>>;

export const benchList = z.object({
  items: z.array(benchSummary),
  nextCursor: z.string().nullable(),
});
export type BenchList = z.infer<typeof benchList>;

const benchFields = {
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(120),
  zone: z.string().trim().min(1).max(80),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  description: z.string().trim().max(1000).nullable().default(null),
};

export const createBenchInput = z.object(benchFields);
export type CreateBenchInput = z.input<typeof createBenchInput>;

export const updateBenchInput = z
  .object({ ...benchFields, status: benchStatus })
  .partial();
export type UpdateBenchInput = z.input<typeof updateBenchInput>;

export const importBenchesInput = z.object({ csv: z.string().min(1) });
export const importBenchesResult = z.object({
  created: z.number(),
  updated: z.number(),
});
export type ImportBenchesResult = z.infer<typeof importBenchesResult>;

// ---------------------------------------------------------------- auth

/** Relative in-app path only; prevents the magic link being an open redirect. */
export const redirectPath = z
  .string()
  .regex(/^\/(?!\/)[^\s]*$/, 'Must be a path within this site');

export const requestMagicLinkInput = z.object({
  email,
  redirectTo: redirectPath.optional(),
});

export const verifyMagicLinkInput = z.object({ token: z.string().min(1) });

export const me = z.object({
  id,
  email: z.string(),
  fullName: z.string().nullable(),
  role,
});
export type Me = z.infer<typeof me>;

export const verifyMagicLinkResult = z.object({
  user: me,
  redirectTo: z.string().nullable(),
});

export const updateMeInput = z.object({
  fullName: z.string().trim().min(1).max(120),
});

// ---------------------------------------------------------------- adoptions

export const createAdoptionInput = z.object({
  benchId: id,
  months: termMonths,
  displayName: z.string().trim().min(1).max(80),
  dedication: z.string().trim().max(280).nullable().default(null),
  isAnonymous: z.boolean().default(false),
});
export type CreateAdoptionInput = z.input<typeof createAdoptionInput>;

export const renewAdoptionInput = z.object({ months: termMonths });

export const adoption = z.object({
  id,
  benchId: id,
  parkSlug: z.string(),
  benchCode: z.string(),
  benchName: z.string(),
  displayName: z.string(),
  dedication: z.string().nullable(),
  isAnonymous: z.boolean(),
  startDate: isoDate,
  endDate: isoDate,
  status: adoptionStatus,
  renewedFromId: id.nullable(),
  /** True when a later adoption continues this one. */
  isRenewed: z.boolean(),
  /** Days until `endDate` in the park's timezone; 0 once it has ended. */
  daysRemaining: z.number().int(),
});
export type Adoption = z.infer<typeof adoption>;

export const adoptionList = z.object({ items: z.array(adoption) });

// ---------------------------------------------------------------- admin

export const adminAdoptionsQuery = z.object({
  expiringWithinDays: z.coerce.number().int().min(0).max(3650).optional(),
  // Query strings are text: stringbool reads "false" as false (coerce would not).
  includeEnded: z.stringbool().default(false),
});

export const adminAdoption = adoption.extend({
  adopterEmail: z.string(),
  adopterName: z.string().nullable(),
});
export type AdminAdoption = z.infer<typeof adminAdoption>;

export const adminAdoptionList = z.object({ items: z.array(adminAdoption) });

export const setRoleInput = z.object({ email, role });
