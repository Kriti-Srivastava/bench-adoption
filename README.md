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
- **Multi-park from day one.** Benches belong to a `park`, and each park has
  its own timezone. Adding another park is data, not code.

## Onboarding and renewals

1. **Discover.** Each bench page has a permanent URL,
   `/parks/van-cortlandt/benches/VC-042`, meant to be printed as a QR code on
   the plaque.
2. **Adopt.** Choose a term (1–60 months), a display name and an optional
   dedication. If not signed in, the visitor enters an email right there and
   the link brings them back to the same form.
3. **Confirm.** A confirmation email explains the period and how to renew.
4. **Renew.** Run `npm run jobs:reminders -w @bench/api` daily (cron, a
   scheduled container, etc.). It emails adopters 60, 30 and 7 days before
   their adoption ends, with a link that opens the renew form. Each reminder
   is recorded, so the job is safe to re-run. Failed sends are retried the next day.

**Staff** (the `/parks/:slug/staff` dashboard) can list adoptions ending
soon, export them as CSV, cancel adoptions, add or retire benches, and
bulk-import the park's existing spreadsheet:

```sh
npm run import-benches -w @bench/api -- van-cortlandt benches.csv
# columns: code,name,zone,lat,lng[,description]; re-importing updates by code
```

## API overview

| Method | Path | Who |
|---|---|---|
| GET | `/api/v1/parks/:slug` | public |
| GET | `/api/v1/parks/:slug/benches?availability=&zone=&q=&cursor=&limit=` | public |
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
- **Reminders:** schedule `npm run jobs:reminders -w @bench/api` daily.

## Extending

- **Payments:** add a `pending_payment` adoption status and confirm the
  adoption from the payment webhook. The overlap constraint already covers
  `active` rows only.
- **Mobile app:** build a React Native or Expo client on `packages/shared` and the same API.
- **Right of first refusal:** e.g. hold a bench for its current adopter for N
  days after it ends. This is one rule in `services/adoptions.ts`.
- **Configurable terms or prices:** move `ADOPTION_TERM_MONTHS` into a table.
