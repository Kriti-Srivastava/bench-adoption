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

/**
 * Outer bounds for any adoption term, in months. Each park then offers its
 * own specific terms (`Park.adoptionTermsMonths`); Van Cortlandt: 10 years.
 */
export const ADOPTION_TERM_MONTHS = { min: 1, max: 120 } as const;

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
/**
 * A bench's state as shown to the public:
 * - available:   can be adopted today
 * - adopted:     adopted, and not ending soon (or already renewed)
 * - ending_soon: adoption ends within ENDING_SOON_DAYS and hasn't been renewed
 * - retired:     no longer part of the program
 */
export const benchAvailabilities = ['available', 'adopted', 'ending_soon', 'retired'] as const;
export const availability = z.enum(benchAvailabilities);
export type BenchAvailability = z.infer<typeof availability>;

/** An unrenewed adoption ending within this many days counts as "ending soon". */
export const ENDING_SOON_DAYS = 60;

// ---------------------------------------------------------------- errors

export const errorResponse = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ErrorResponse = z.infer<typeof errorResponse>;

// ---------------------------------------------------------------- parks

/** A named part of a park. Every bench is in exactly one. */
export const area = z.object({
  name: z.string(),
  description: z.string().nullable(),
  /** Nature and history notes about the area, shown on bench popups. */
  facts: z.array(z.string()),
});
export type Area = z.infer<typeof area>;

export const latLng = z.tuple([z.number(), z.number()]);

export const trail = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  lengthMiles: z.number().nullable(),
  facts: z.array(z.string()),
  /** The route as [lat, lng] points, in walking order. */
  path: z.array(latLng),
});
export type Trail = z.infer<typeof trail>;

export const park = z.object({
  id,
  slug: z.string(),
  name: z.string(),
  timezone: z.string(),
  /** The adoption lengths this park offers, in months. */
  adoptionTermsMonths: z.array(z.number().int()),
  areas: z.array(area),
  trails: z.array(trail),
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
  availability,
  /** Slugs of the trails this bench sits along. */
  trails: z.array(z.string()),
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
  /** Only benches along this trail (slug). */
  trail: z.string().optional(),
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
  /** Trail slugs; omit to leave a bench's trails unchanged on update/import. */
  trails: z.array(z.string()).optional(),
};

export const createBenchInput = z.object(benchFields);
export type CreateBenchInput = z.input<typeof createBenchInput>;

/** Retiring and restoring go through their own actions, which handle adoptions. */
export const updateBenchInput = z.object(benchFields).partial();
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

// ---------------------------------------------------------------- maintenance

/** Kinds of upkeep work, modelled on how park conservancies care for benches. */
export const maintenanceTypes = [
  'inspection',
  'repair',
  'painting',
  'cleaning',
  'graffiti',
  'plaque',
  'relocation',
  'other',
] as const;
export const maintenanceType = z.enum(maintenanceTypes);
export type MaintenanceType = z.infer<typeof maintenanceType>;

export const maintenanceStatuses = ['open', 'scheduled', 'in_progress', 'done', 'cancelled'] as const;
export const maintenanceStatus = z.enum(maintenanceStatuses);
export type MaintenanceStatus = z.infer<typeof maintenanceStatus>;

export const maintenancePriorities = ['low', 'normal', 'urgent'] as const;
export const maintenancePriority = z.enum(maintenancePriorities);
export type MaintenancePriority = z.infer<typeof maintenancePriority>;

/** Benches are due a condition check at least this often (an annual survey). */
export const INSPECTION_INTERVAL_DAYS = 365;

const personRef = z.object({ id, name: z.string().nullable(), email: z.string() });

export const maintenanceTask = z.object({
  id,
  benchId: id,
  benchCode: z.string(),
  benchName: z.string(),
  type: maintenanceType,
  status: maintenanceStatus,
  priority: maintenancePriority,
  title: z.string(),
  details: z.string().nullable(),
  reportedBy: personRef.nullable(),
  assignee: personRef.nullable(),
  scheduledFor: isoDate.nullable(),
  completedAt: z.string().nullable(),
  resolution: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MaintenanceTask = z.infer<typeof maintenanceTask>;
export const maintenanceTaskList = z.object({ items: z.array(maintenanceTask) });

export const maintenanceQuery = z.object({
  status: maintenanceStatus.optional(),
  type: maintenanceType.optional(),
  priority: maintenancePriority.optional(),
  /** Only tasks that still need doing (open, scheduled or in progress). */
  openOnly: z.stringbool().default(false),
});
export type MaintenanceQuery = Partial<z.infer<typeof maintenanceQuery>>;

const taskTitle = z.string().trim().min(1).max(120);
const taskDetails = z.string().trim().max(2000);

export const createTaskInput = z.object({
  type: maintenanceType,
  priority: maintenancePriority.default('normal'),
  title: taskTitle,
  details: taskDetails.nullable().default(null),
  scheduledFor: isoDate.nullable().default(null),
});
export type CreateTaskInput = z.input<typeof createTaskInput>;

export const updateTaskInput = z
  .object({
    status: maintenanceStatus,
    priority: maintenancePriority,
    title: taskTitle,
    details: taskDetails.nullable(),
    assigneeId: id.nullable(),
    scheduledFor: isoDate.nullable(),
    resolution: taskDetails.nullable(),
  })
  .partial();
export type UpdateTaskInput = z.input<typeof updateTaskInput>;

/** What a visitor can report about a bench. */
export const problemKinds = ['damaged', 'graffiti', 'dirty', 'plaque', 'other'] as const;
export const reportProblemInput = z.object({
  kind: z.enum(problemKinds),
  details: z.string().trim().min(1).max(1000),
});
export type ReportProblemInput = z.input<typeof reportProblemInput>;

/** A visitor's own report, without staff-only details. */
export const userReport = z.object({
  id,
  parkSlug: z.string(),
  benchCode: z.string(),
  benchName: z.string(),
  type: maintenanceType,
  status: maintenanceStatus,
  details: z.string().nullable(),
  resolution: z.string().nullable(),
  createdAt: z.string(),
});
export type UserReport = z.infer<typeof userReport>;
export const userReportList = z.object({ items: z.array(userReport) });

// ---------------------------------------------------------------- bench lifecycle

/**
 * What happens to a bench's current adoption when it is retired:
 * keep it until it ends, end it now, or move it (and its plaque) to
 * another bench, as park programs do when a bench has to be removed.
 */
export const retireBenchInput = z
  .object({
    adoption: z.enum(['keep', 'end', 'relocate']),
    /** Plaque code of the bench to move the adoption to, for "relocate". */
    relocateTo: z.string().trim().min(1).optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.adoption !== 'relocate' || v.relocateTo, {
    message: 'Choose a bench to move the adoption to',
    path: ['relocateTo'],
  });
export type RetireBenchInput = z.input<typeof retireBenchInput>;

// ---------------------------------------------------------------- admin views

export const adminBench = benchSummary.extend({
  openTasks: z.number().int(),
  lastInspectedOn: isoDate.nullable(),
  lastMaintainedOn: isoDate.nullable(),
  needsInspection: z.boolean(),
});
export type AdminBench = z.infer<typeof adminBench>;
export const adminBenchList = z.object({ items: z.array(adminBench) });

export const adminSummary = z.object({
  benches: z.record(availability, z.number().int()),
  needsInspection: z.number().int(),
  openTasks: z.number().int(),
  urgentTasks: z.number().int(),
  plaquesToInstall: z.number().int(),
  endingSoon: z.number().int(),
});
export type AdminSummary = z.infer<typeof adminSummary>;

export const adminUser = me.extend({
  createdAt: z.string(),
  activeAdoptions: z.number().int(),
});
export type AdminUser = z.infer<typeof adminUser>;
export const adminUserList = z.object({ items: z.array(adminUser) });
export const adminUsersQuery = z.object({
  q: z.string().trim().min(1).optional(),
  role: role.optional(),
});
