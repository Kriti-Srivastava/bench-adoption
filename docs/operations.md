# Running it for real

## Pieces to deploy

| Piece | What it is | Notes |
|---|---|---|
| **Database** | PostgreSQL 14+ | Any managed host (Neon, Supabase, RDS…). Run `npm run db:migrate` on each deploy. |
| **API** | `npm start -w @bench/api` | Stateless: run as many instances as you like. |
| **Web** | `npm run build` → `apps/web/dist` | Static files. Serve from a CDN on the same domain as the API, routing `/api/*` to the API so the session cookie stays first-party. |
| **Worker** | `npm run worker -w @bench/api` | Sends queued email with retries. Several may run at once. Optional: with `SEND_MAIL_FROM_API=true` (the default) the API sends queued mail itself, which suits hosts without an always-on worker. |
| **Daily job** | `npm run jobs:daily -w @bench/api` | Renewal reminders plus clean-up. Schedule once a day. |

## Configuration

Set `NODE_ENV=production`. The API then defaults to secure cookies and
**refuses to start** without `DATABASE_URL`, an `https://` `WEB_URL` and
`MAIL_FROM` (plus `RESEND_API_KEY` when `MAIL_PROVIDER=resend`), listing
every problem it finds.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `WEB_URL` | Public address of the site; used in email links |
| `MAIL_PROVIDER` | `smtp` (a mail server or Mailpit) or `resend` (HTTP API) |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Outgoing email for `smtp` |
| `RESEND_API_KEY` | Required when `MAIL_PROVIDER=resend` |
| `SEND_MAIL_FROM_API` | API sends queued email itself (default true) |
| `JOBS_TOKEN` | Lets a scheduler POST `/api/v1/internal/jobs/daily` |
| `COOKIE_SECURE` | Defaults to true in production |
| `TRUST_PROXY_HOPS` | Number of proxies in front, so per-IP limits see the real visitor |
| `REDIS_URL` | Optional: shares per-IP rate limits across instances |
| `DB_POOL_MAX` | Database connections per instance (default 10) |

A scheduler that can't run shell commands (GitHub Actions, cron-job.org, a
cloud scheduler) can run the daily job over HTTP instead:

```sh
curl -X POST "$API_URL/api/v1/internal/jobs/daily" -H "authorization: Bearer $JOBS_TOKEN"
```

## Health checks

- `/api/health/live` — the process is up. Restart it if this fails.
- `/api/health/ready` — it can serve traffic. Route traffic by this one.

Postgres is critical: without it an instance reports `unavailable` (503).
Redis is optional: without it the API reports `degraded` and keeps serving,
per-IP limits pause, and the per-address sign-in limit (in Postgres) still
applies.

## Performance

Measured on a development laptop: one API process, local Postgres, 20
concurrent clients.

| Endpoint | Throughput | Median latency | Notes |
|---|---|---|---|
| `GET /api/health` (one DB round trip) | ~930 req/s | 20 ms | baseline |
| `GET /parks/:slug`, `GET …/benches/:code` | ~200 req/s | ~100 ms | |
| `GET …/benches?limit=1000` (the full map) | ~50 req/s | ~370 ms | ~15 ms of work each |

For the full map, about 13 ms of the ~15 ms is the database query and turning
520 rows into objects; writing the JSON takes under 1 ms. The response is
139 KB, or 25 KB compressed.

## How it scales

1. **Public reads are cacheable, and a CDN is the main lever.** Public
   endpoints send `Cache-Control: max-age=0, must-revalidate, s-maxage=15,
   stale-while-revalidate=60` and a weak `ETag`. Browsers always revalidate
   (a cheap `304`), so nobody sees a stale map after adopting, while a CDN
   serves the map from its edge and asks the origin only a few times a
   minute, however many visitors there are.
2. **The API is stateless.** Run more instances behind a load balancer.
   Sessions and the per-address sign-in limit live in Postgres; per-IP limits
   are shared through Redis when configured.
3. **Postgres connections:** each instance opens up to `DB_POOL_MAX`. Beyond
   a few instances, put PgBouncer or the host's pooler in front.
4. **Integrity holds at any scale**, because the database enforces it.
5. **The data is small.** Hundreds of benches per park and a few thousand
   adoptions fit comfortably in one Postgres. Read replicas only become
   interesting with many parks.
6. **No unbounded response.** The public bench list is cursor-paginated. The
   staff lists (tasks, accounts) read one page of `LIST_LIMIT` rows and
   return `total` alongside, so the admin area can say what it isn't showing
   rather than quietly dropping rows; dashboard counts are tallied by the
   database, never by counting a truncated list. Cursor pagination is the
   next step there if a park's lists outgrow a page.

## Recommended next steps

- **Put a CDN in front** of both the web app and `/api`. The biggest gain,
  and configuration rather than code.
- **Build for production** instead of running TypeScript through `tsx`:
  bundle the API to JavaScript (esbuild) in a small container image, for
  faster starts and less memory.
- **Add monitoring:** latency and error rate per route, database pool
  saturation, outbox backlog (`failed` messages need a human), and an alert
  if the daily job doesn't run.
- **Trim the map query** if it ever matters: pre-aggregated joins instead of
  the per-bench trail and renewal subqueries would roughly halve its ~13 ms.
