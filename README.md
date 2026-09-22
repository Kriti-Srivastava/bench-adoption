# Bench Adoption

A single source of truth for the Van Cortlandt Park bench adoption program.
Anyone can see which of the park's 500+ benches are adopted, by whom and
until when. Donors can adopt an available bench, or renew their own, in a few
clicks. There is no payment step yet (see [Extending](#extending)).

## Quick start

Requires Node 22+ and Docker.

```sh
cp .env.example .env
npm install
npm run db:up        # Postgres (port 5442) + Mailpit (local inbox)
npm run db:migrate
npm run db:seed      # ~520 sample benches + demo adoptions
npm run dev          # API on :3000, web on :5173
```

- Web app: http://localhost:5173
- API docs (OpenAPI / Swagger UI): http://localhost:3000/api/docs
- Emails, including sign-in links: http://localhost:8025

To make yourself staff: `npm run make-admin -w @bench/api -- you@example.org`,
then sign in with that email.

```sh
npm test             # unit + integration tests (needs the database running)
npm run typecheck
```

## How it works

```
packages/shared   API contract: zod schemas + types, date helpers
apps/api          Fastify + Drizzle + PostgreSQL
  routes/         HTTP only: validate → call a service → respond
  services/       business rules (adopt, renew, availability, reminders)
  repositories/   every SQL query lives here
  db/             schema.ts + migrations/
  scripts/        CLI tasks (migrate, seed, import, make-admin, reminders)
apps/web          React + Vite + TanStack Query + Leaflet
```

**The database is the source of truth. The API is the only way in.** The web
app, a future mobile app and staff tools all use the same versioned REST API
(`/api/v1`). Its shapes are defined once in `packages/shared` and checked at
compile time in every client.

Key design decisions:

- **"Adopted" is never stored.** A bench is adopted when an active adoption's
  `[start_date, end_date)` covers today in the park's timezone. Nothing can
  drift out of sync, and expiry needs no cleanup job.
- **Four states, one definition.** Each bench is `available` (green on the
  map), `adopted` (red), `ending_soon` (amber: its adoption ends within 60
  days and hasn't been renewed) or `retired` (grey). The state is computed by a
  single SQL expression that is used both to report it and to filter by it
  (`availabilitySql` in `repositories/benches.ts`).
- **No double-booking, enforced by Postgres.** An exclusion constraint
  (`adoptions_no_overlap`) rejects overlapping adoptions of the same bench.
  If two people click "Adopt" at the same instant, exactly one wins; the
  other gets `409 bench_unavailable`. This is covered by a test.
- **Renewals keep history.** A renewal is a new adoption that starts the day
  the previous one ends, linked by `renewed_from_id`. A unique index allows
  each adoption to be renewed only once, so renewals form a chain.
- **Privacy.** Public endpoints only return the donor's chosen display name,
  or "Anonymous donor". Response schemas strip everything else, so an email
  can't leak through the public endpoints. Staff endpoints include contact details.
- **Passwordless sign-in.** Magic links are single-use, expire after 15
  minutes and are stored hashed, as are session tokens. The account is
  created on first sign-in, so there is no separate sign-up step.
- **Sign-in rate limits, in two layers.** *Per address:* at most one link a
  minute and five an hour to the same email. This is counted in Postgres
  under a per-address advisory lock, so it holds across any number of API
  instances and concurrent requests can't slip past it. *Per IP:* a short
  burst limit. It is in memory by default, or shared across instances when
  `REDIS_URL` is set. Set `TRUST_PROXY_HOPS` behind a load balancer.
- **Contention is retried, not surfaced.** Postgres may abort one of several
  simultaneous conflicting inserts as a deadlock. Those writes are retried,
  so every loser of a race gets a clean `409`, never a `500`.
- **Areas and trails are data.** Every bench is in one *area* (for example
  Van Cortlandt Lake). A bench can sit along any number of *trails*, which
  are linked through `bench_trails` because a bench at a junction is on
  several. Areas and trails carry descriptions and nature and history
  *facts*. Bench popups show one fact from the bench's area, and neighbouring
  benches show different ones.
- **Multi-park from day one.** Benches belong to a `park`, and each park has
  its own timezone. Adding another park is data, not code.

## Onboarding and renewals

1. **Discover.** Each bench page has a permanent URL,
   `/parks/van-cortlandt/benches/VC-042`, meant to be printed as a QR code on
   the plaque.
2. **Adopt.** Van Cortlandt Park adopts benches for a fixed **10-year term**,
   matching the Van Cortlandt Park Alliance's program. Terms are a per-park
   setting (`parks.adoption_terms_months`), so another park can offer
   different ones. Donors choose a display name and an optional dedication. If not signed in, the visitor enters an email right there and
   the link brings them back to the same form.
3. **Confirm.** A confirmation email explains the period and how to renew.
4. **Renew.** Run `npm run jobs:daily -w @bench/api` daily (cron, a
   scheduled container, etc.). It emails adopters 60, 30 and 7 days before
   their adoption ends, with a link that opens the renew form. Each reminder
   is recorded, so the job is safe to re-run. Failed sends are retried the next day.

## Upkeep and the admin area

The admin area (`/parks/:slug/admin`, for staff and admins) follows how park
conservancies actually care for adopted benches: a yearly condition survey,
repairs and repainting as needed, plaques fitted a few weeks after adoption,
and plaques moved to a new bench if the old one has to go.

- **Overview:** open and urgent tasks, benches due their yearly inspection,
  plaques to install or move, and adoptions ending soon.
- **Benches:** every bench with its last inspection and open tasks. Each
  bench has a page with its maintenance history.
- **Maintenance:** tasks (`maintenance_tasks`) for inspection, repair,
  painting, cleaning, graffiti, plaques and relocation. Each has a status,
  priority, assignee, scheduled date and notes. "Last inspected" is derived
  from completed inspections, never stored. Every new adoption automatically
  opens a *plaque* task.
- **Retiring a bench** asks what happens to its adoption: *keep* it until it
  ends, *end* it now, or *relocate* it (and its plaque) to an available bench.
  The donor is emailed when their adoption changes, and the event is recorded
  in the bench's history.
- **Users:** search accounts. Admins change roles, but can't change their own.
- **Visitors** can "Report a problem" on any bench page. Reports join the
  crew's queue, and the reporter can follow them on **My account**.

Staff can also export adoptions as CSV, cancel adoptions, add benches, and
bulk-import the park's existing spreadsheet:

```sh
npm run import-benches -w @bench/api -- van-cortlandt benches.csv
# columns: code,name,zone,lat,lng[,description][,trails]
# zone = area name (created if new); trails = trail slugs separated by ";"
# re-importing updates by code
```

## API overview

| Method | Path | Who |
|---|---|---|
| GET | `/api/v1/parks/:slug` | public |
| GET | `/api/v1/parks/:slug/benches?availability=&zone=&trail=&q=&cursor=&limit=` | public |
| GET | `/api/v1/parks/:slug/benches/:code` | public |
| POST | `/api/v1/auth/magic-link`, `/auth/verify`, `/auth/logout` | anyone |
| GET/PATCH | `/api/v1/me` | signed in |
| POST | `/api/v1/adoptions` | signed in |
| POST | `/api/v1/adoptions/:id/renew` | owner |
| GET | `/api/v1/me/adoptions` | signed in |
| POST/PATCH | `/api/v1/parks/:slug/benches`, `/benches/:id`, `/parks/:slug/benches/import` | staff |
| GET | `/api/v1/parks/:slug/adoptions` (`.csv`) | staff |
| POST | `/api/v1/adoptions/:id/cancel` | staff |
| PUT | `/api/v1/users/role` | admin |

Errors are always `{ "error": { "code", "message" } }`. The full schema is
at `/api/docs`.

## Deploying

- **Database:** any managed Postgres 14+ (Neon, Supabase, RDS…). Run
  `npm run db:migrate` on deploy.
- **API:** stateless, so run as many instances as needed. Set `DATABASE_URL`,
  `WEB_URL`, the SMTP settings (or swap `createSmtpMailer` for Resend/SES; the
  `Mailer` interface is one method) and `COOKIE_SECURE=true`.
- **Web:** `npm run build` produces static files in `apps/web/dist`. Serve them
  from a CDN on the same domain as the API, routing `/api/*` to the API so the
  session cookie stays first-party.
- **Daily job:** schedule `npm run jobs:daily -w @bench/api` (renewal reminders and clean-up of expired sign-in links and sessions).

## Scaling and performance

Measured on a development laptop: one API process, local Postgres, 20
concurrent clients.

| Endpoint | Throughput | Median latency | Notes |
|---|---|---|---|
| `GET /api/health` (one DB round trip) | ~930 req/s | 20 ms | baseline |
| `GET /parks/:slug`, `GET …/benches/:code` | ~200 req/s | ~100 ms | |
| `GET …/benches?limit=1000` (the full map) | ~50 req/s | ~370 ms | ~15 ms of work each |

For the full map, about 13 ms of the ~15 ms is the database query and
turning 520 rows into objects. Writing the JSON takes under 1 ms (with
fast-json-stringify). The map response is 139 KB, or 25 KB with gzip.

How it scales:

1. **Public reads are cacheable, and a CDN is the main lever.** Public
   endpoints send `Cache-Control: max-age=0, must-revalidate, s-maxage=15,
   stale-while-revalidate=60` and a weak `ETag`. Browsers always revalidate
   (a cheap `304`), so nobody sees a stale map after adopting. A CDN
   (Cloudflare, CloudFront, Fastly…) serves the map from its edge and asks
   the origin only a few times a minute, however many visitors there are.
2. **The API is stateless.** Run more instances behind a load balancer.
   Sessions and the per-address sign-in limit live in Postgres. Per-IP limits
   are shared through Redis when `REDIS_URL` is set. Set `TRUST_PROXY_HOPS`.
3. **Postgres connections:** each instance opens up to `DB_POOL_MAX`.
   Beyond a few instances, put PgBouncer or the host's pooler in front.
4. **Integrity rules hold at any scale** because the database enforces them:
   no double-booking, same-park links, one renewal per adoption. Contention
   deadlocks are retried into clean `409`s.
5. **The data is small.** Hundreds of benches per park and a few thousand
   adoptions fit comfortably in a single Postgres. Indexes cover every
   foreign key and hot filter. Read replicas are the next step only if many
   parks are added.

Recommended next steps, in order of value:

- **Put a CDN in front** of both the web app (static files) and `/api`.
  This is the biggest gain, and needs configuration rather than code.
- **Build for production** instead of running TypeScript through `tsx`:
  bundle the API to JavaScript (esbuild) and ship it in a small container
  image. This gives faster cold starts, less memory, and no compiler at runtime.
- **Send emails from a queue (an "outbox").** Today confirmation emails go
  out inside the request, and a failure is only logged. Writing them to an
  `outbox` table and sending from a worker makes delivery retryable and
  keeps the mail server's latency out of requests.
- **Add monitoring:** request metrics (latency and error rate per route),
  database pool saturation, and alerts on the daily job.
- **Trim the map query** if it ever matters. Replacing the per-bench trail
  and renewal subqueries with pre-aggregated joins would roughly halve its
  ~13 ms.

## Chaos testing

`npm run test:chaos -w @bench/api` runs a separate, deliberately destructive
suite in the spirit of Netflix's Chaos Monkey. It breaks things while the
system is busy, then checks that every request got an answer, that the
data rules still hold, and that the system recovers.

- **Monkeys** (`apps/api/chaos/monkey.ts`): one kills random Postgres
  connections mid-request, one makes the mail provider fail and stall, and
  the tests also leap the clock forward and send crowds of simultaneous
  requests at one bench.
- **Workload** (`chaos/workload.ts`): random mixes of adopt, renew, cancel,
  retire (keep, end or relocate), restore, report and close-task, fired in
  concurrent waves through the real HTTP API.
- **Invariants** (`chaos/invariants.ts`): SQL checks for rules that must
  always hold. Examples: no overlapping adoptions, renewals continue their
  predecessor, nothing adopted after retirement, and no plaque work left for
  cancelled adoptions.
- **Reproducible:** each run prints its seed. `CHAOS_SEED=<seed>` replays it
  exactly.

Some scenarios fail by design until the race-condition fixes in the bug
list land. The suite exists to prove those fixes.

## Sample content

`apps/api/src/scripts/seed-data.ts` holds the park's areas, trails and facts.
Trail routes and bench positions are approximate, and the facts were drafted
from general knowledge of the park. **Have park staff or naturalists review
them before launch.** Photos of each area could be added the same way once
the park has images it is licensed to use.

## Extending

- **Payments:** add a `pending_payment` adoption status and confirm the
  adoption from the payment webhook. The overlap constraint already covers
  `active` rows only.
- **Mobile app:** build a React Native or Expo client on `packages/shared` and the same API.
- **Right of first refusal:** e.g. hold a bench for its current adopter for N
  days after it ends. This is one rule in `services/adoptions.ts`.
- **Configurable terms or prices:** move `ADOPTION_TERM_MONTHS` into a table.
