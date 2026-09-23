# How it works

```
packages/shared   API contract: zod schemas + types, date helpers
apps/api          Fastify + Drizzle + PostgreSQL
  routes/         HTTP only: validate → call a service → respond
  services/       business rules (adopt, renew, retire, reminders, events)
  repositories/   every SQL query lives here
  db/             schema.ts + migrations/
  scripts/        CLI tasks (migrate, seed, import, make-admin, worker, daily)
  chaos/          the chaos-testing suite
apps/web          React + Vite + TanStack Query + Leaflet
```

**The database is the source of truth. The API is the only way in.** The web
app, a future mobile app and staff tools all use the same versioned REST API
(`/api/v1`). Its shapes are defined once in `packages/shared` and checked at
compile time in every client.

## Design decisions

### The data

- **"Adopted" is never stored.** A bench is adopted when an active adoption's
  `[start_date, end_date)` covers today in the park's timezone. Nothing can
  drift out of sync, and expiry needs no cleanup job.
- **Four states, one definition.** Each bench is `available` (green on the
  map), `adopted` (red), `ending_soon` (amber: its adoption ends within 60
  days and hasn't been renewed) or `retired` (grey). One SQL expression
  (`availabilitySql` in `repositories/benches.ts`) both reports the state and
  filters by it, so the two can never disagree.
- **Renewals keep history.** A renewal is a new adoption that starts the day
  the previous one ends, linked by `renewed_from_id`. A unique index allows
  each adoption to be renewed only once, so renewals form a chain.
- **Areas and trails are data.** Every bench is in one *area* (for example
  Van Cortlandt Lake). A bench can sit along any number of *trails*, linked
  through `bench_trails`, because a bench at a junction is on several. Areas
  and trails carry descriptions and nature and history *facts*; bench popups
  show one fact from the bench's area, and neighbouring benches show
  different ones.
- **Multi-park from day one.** Benches belong to a `park` with its own
  timezone and adoption terms. Adding another park is data, not code.
- **Adoption terms are per park.** Van Cortlandt follows the Van Cortlandt
  Park Alliance's real program: a fixed 10-year term
  (`parks.adoption_terms_months`). Any other length is refused.

### Rules the database enforces

Application code can't be the only guard for rules that matter, so PostgreSQL
enforces them directly:

- **No double-booking.** An exclusion constraint (`adoptions_no_overlap`)
  rejects overlapping adoptions of the same bench. If two people click
  "Adopt" at the same instant, exactly one wins; the other gets
  `409 bench_unavailable`.
- **Nothing adopted on a retired bench**, and **no active renewal of an
  inactive adoption** (triggers in migration `0007_adoption_guards`). Each
  check reads the row it depends on `FOR SHARE`, so it is race-free by itself.
- **Same-park integrity.** Composite foreign keys mean a bench's area and its
  trails must belong to the bench's park.
- **Value checks** for coordinates, email case, text lengths and trail shape,
  so imports and scripts can't store nonsense.

### Consistency under concurrency

The **bench is the consistency boundary**. Every command that changes who
holds a bench (adopt, renew, cancel, retire, relocate, restore) runs through
`withBenchesLocked` in `services/consistency.ts`: one transaction that locks
the bench rows (in id order, so two commands can't deadlock), reads
everything the decision depends on under that lock, then writes all of its
consequences together. An adoption and its plaque job are created atomically.

Postgres may still abort one of several simultaneous conflicting writes as a
deadlock; those are retried, so the loser of a race gets a clean `409`, never
a `500`.

### Events and notifications

Every change records a **domain event** in the same transaction as the change
itself, and queues the emails that event calls for in an **outbox** table.
Nothing is sent for work that rolled back, and nothing is lost because mail
was down. A separate worker delivers the queue with backoff and parks
messages that keep failing.

One exhaustive policy (`services/notifications.ts`) maps events to emails, so
a new event type can't be added without deciding who is told.

### Privacy and safety

- **Private by default.** Every route declares who its responses are for
  (`config: { cache: 'public' }`). Everything else gets `Cache-Control:
  private, no-store`, and errors are never cached, so a new endpoint can't
  leak one person's data through a CDN. A test pins the exact list of public
  routes.
- **Public endpoints show only** the donor's chosen display name (or
  "Anonymous donor") and dedication. Response schemas strip everything else,
  so an email can't slip through.
- **Safe exports.** All CSV goes through one module that neutralises
  spreadsheet formulas in donor-written text (OWASP CSV injection). This is
  output encoding: stored data is never altered.
- **Passwordless sign-in.** Magic links are single-use, expire after 15
  minutes, and are stored hashed, as are session tokens. The account is
  created on first sign-in.
- **Park staff sign in separately.** The staff entrance (`/staff`, linked in
  the footer) issues 5-minute links, and only to accounts that already have
  staff access; anyone else is told so by email, so the API's reply gives
  nothing away. A link records which entrance asked for it and is refused at
  the other one, which also catches access granted or revoked in between.
  Staff accounts cannot adopt or renew, and an address that still holds a
  bench cannot be made staff, so no account is ever both.
- **One renewal rule.** `services/renewal.ts` answers "can this be renewed?"
  once: the command turns the answer into its error, the adoption the API
  returns carries it as `canRenew`, and the reminder job asks the same
  questions in SQL. No client re-derives it, so a Renew button is never
  offered for a retired bench or an adoption that already has a renewal
  queued.
- **Sign-in rate limits, in two layers.** *Per address:* at most one link a
  minute and five an hour, counted in Postgres under a per-address advisory
  lock, so the limit holds across any number of API instances. *Per IP:* a
  burst limit, in memory by default or shared through Redis when `REDIS_URL`
  is set.

## API overview

| Method | Path | Who |
|---|---|---|
| GET | `/api/v1/parks/:slug` | public |
| GET | `/api/v1/parks/:slug/benches?availability=&zone=&trail=&q=&cursor=&limit=` | public |
| GET | `/api/v1/parks/:slug/benches/:code` | public |
| POST | `/api/v1/auth/magic-link`, `/auth/verify`, `/auth/logout` | anyone |
| GET | `/api/v1/session` | anyone (`{ user \| null }`) |
| GET/PATCH | `/api/v1/me` | signed in |
| POST | `/api/v1/adoptions`, `/adoptions/:id/renew` | signed in / owner |
| GET | `/api/v1/me/adoptions`, `/me/reports` | signed in |
| POST | `/api/v1/benches/:id/reports` | signed in |
| GET | `/api/v1/parks/:slug/admin/summary`, `/admin/benches` | staff |
| GET/POST/PATCH | `/api/v1/parks/:slug/maintenance`, `/benches/:id/maintenance`, `/maintenance/:id` | staff |
| POST | `/api/v1/benches/:id/retire`, `/benches/:id/restore` | staff |
| GET | `/api/v1/parks/:slug/adoptions` (`.csv`) | staff |
| POST | `/api/v1/adoptions/:id/cancel` | staff |
| POST/PATCH | `/api/v1/parks/:slug/benches`, `/benches/:id`, `/parks/:slug/benches/import` | staff |
| GET | `/api/v1/admin/users` | staff |
| PUT | `/api/v1/users/role` | admin |

Errors are always `{ "error": { "code", "message" } }`. The full schema is at
`/api/docs`.

## How the park's program maps onto the app

1. **Discover.** Each bench page has a permanent URL,
   `/parks/van-cortlandt/benches/VC-042`, meant to be printed as a QR code on
   the plaque.
2. **Adopt.** A fixed 10-year term, a display name and an optional
   dedication. Visitors who aren't signed in enter their email on the same
   form and the link brings them back to it.
3. **Confirm.** A confirmation email explains the period and how to renew,
   and a plaque job is queued for the crew (plaques typically take 6–8 weeks).
4. **Look after it.** The admin area follows how park conservancies work: a
   yearly condition survey, repairs and repainting as needed, and plaques
   moved to another bench if one has to be removed. A moved adoption keeps
   its end date but starts on the new bench the day it moves, because that
   bench's own record before then belongs to whoever had it.
5. **Renew.** The daily job queues reminders 60, 30 and 7 days before an
   adoption ends, each with a one-click renewal link.

Importing the park's existing spreadsheet:

```sh
npm run import-benches -w @bench/api -- van-cortlandt benches.csv
# columns: code,name,zone,lat,lng[,description][,trails]
# zone = area name (created if new); trails = trail slugs separated by ";"
# re-importing updates existing benches by code
```

## Extending

- **Payments:** add a `pending_payment` adoption status and confirm from the
  payment webhook. The overlap constraint already covers `active` rows only.
- **Mobile app:** build a React Native or Expo client on `packages/shared`.
- **Right of first refusal:** hold a bench for its previous adopter for N
  days after it ends. One rule in `services/adoptions.ts`.
- **Photos** of areas and benches, once the park has images it can license.
