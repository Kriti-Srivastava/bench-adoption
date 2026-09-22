# Bench Adoption · Van Cortlandt Park

One place to see which of the park's 500+ benches are adopted, by whom and
until when, and to adopt one yourself.

Van Cortlandt Park runs a bench adoption program: donors adopt a bench for a
term and get a plaque with their dedication. Until now there was no single
record of which benches were taken. This is that record, plus the public map
donors use and the tools the park's crew use to look after the benches.

## What it does

**For visitors and donors**

- **Map and list of every bench**, colour-coded: 🟢 available, 🔴 adopted,
  🟡 ending soon, ⚪ retired. Zoom to a bench, search by plaque number, or
  follow one of the park's trails.
- **Bench pages** with the dedication, the dates, and a nature or history
  note about that part of the park. Each page has a permanent address meant
  for a QR code on the plaque.
- **Adopt in a few steps**: pick a bench, choose a name and dedication, and
  sign in by email. No passwords, no separate sign-up.
- **My account**: your benches, one-click renewal, and the problems you have
  reported.
- **Report a problem** on any bench (damage, graffiti, cleaning, plaque).

**For park staff**

- **Dashboard**: urgent jobs, benches due their yearly inspection, plaques to
  install, adoptions ending soon.
- **Maintenance**: inspections, repairs, painting, cleaning, graffiti, plaque
  and relocation jobs, each with priority, assignee, schedule and notes.
- **Retire a bench** and choose what happens to the donor: keep the adoption
  until it ends, end it now, or move it (and the plaque) to another bench.
  The donor is emailed either way.
- **Adoptions**: ending-soon list, CSV export, cancellations.
- **Benches**: add one, or import the park's spreadsheet.
- **Users**: search accounts and manage roles (admins only).

## Live demo

Not deployed yet. **[docs/deploy.md](docs/deploy.md)** puts it online in about
20 minutes on free hosting (Neon + Render + Resend), or run it locally with
the steps below.

## Quick start

Requires Node 22+ and Docker.

```sh
cp .env.example .env
npm install
npm run db:up        # Postgres (port 5442) + Mailpit (a local inbox)
npm run db:migrate
npm run db:seed      # ~520 sample benches, trails, demo adoptions and jobs
npm run dev          # API on :3000, web on :5173
```

Then open:

| | |
|---|---|
| The site | http://localhost:5173 |
| Emails, including sign-in links | http://localhost:8025 |
| API reference | http://localhost:3000/api/docs |

No real email is sent in development: every message appears in Mailpit. To
give yourself staff access, run
`npm run make-admin -w @bench/api -- you@example.org` and sign in with that
address.

Two background pieces run separately:

```sh
npm run worker -w @bench/api      # sends queued email, retries failures
npm run jobs:daily -w @bench/api  # renewal reminders and clean-up (run daily)
```

## How it is built

```
packages/shared   the API contract: schemas, types, date helpers
apps/api          Fastify + Drizzle + PostgreSQL
apps/web          React + Vite + Leaflet
```

The database is the source of truth and the API is the only way in, so the
website, the staff tools and any future mobile app all use the same rules.
The park's real constraints are enforced by PostgreSQL itself: a bench can't
be adopted twice for overlapping dates, an adoption can't be created on a
retired bench, and a renewal can't outlive the adoption it continues.

More detail: **[docs/architecture.md](docs/architecture.md)**.

## Testing

```sh
npm test                          # 111 unit and integration tests
npm run test:chaos -w @bench/api  # chaos suite (Netflix Chaos Monkey style)
```

The chaos suite kills database connections, breaks the mail provider, leaps
the clock and sends crowds at a single bench, then checks the data rules
still hold and the system recovers. See **[docs/testing.md](docs/testing.md)**.

## Running it for real

- **[docs/deploy.md](docs/deploy.md)** — putting it online, step by step.
- **[docs/operations.md](docs/operations.md)** — configuration, health
  checks, performance figures and scaling notes.

## Status and next steps

Working today: browsing, adopting, renewing, reminders, the staff area,
maintenance tracking and problem reports.

Not built yet:

- **Payments.** Adoption is free in the app; the park handles donations
  separately for now.
- **Photos** of each bench or area.
- **A mobile app.** The API is ready for one.

The sample content (trail routes, bench positions, nature facts in
`apps/api/src/scripts/seed-data.ts`) is approximate and should be reviewed by
park staff before launch. Real bench data comes in through the CSV import.
