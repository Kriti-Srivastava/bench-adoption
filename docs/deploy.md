# Putting it online (free)

About 20 minutes. Three free accounts: **Neon** (database), **Render**
(hosting) and **Resend** (email). You will end up with:

- `https://bench-web.onrender.com` — the site
- `https://bench-api-mp8e.onrender.com` — the API (the site calls it through `/api`)

## 1. Database: Neon

1. Sign up at [neon.tech](https://neon.tech) and create a project.
2. Copy the **pooled** connection string (it contains `-pooler`). That is
   `DATABASE_URL`.
3. From your laptop, set up the schema and the sample park:

   ```sh
   DATABASE_URL='paste-it-here' npm run db:migrate
   DATABASE_URL='paste-it-here' npm run db:seed
   ```

   Skip `db:seed` if you are going to import the park's real spreadsheet
   instead.

## 2. Email: Resend

1. Sign up at [resend.com](https://resend.com) and create an API key
   (`RESEND_API_KEY`).
2. Until you verify a domain, Resend only delivers to your own address. That
   is fine for testing; verify a domain before donors use it.
3. `MAIL_FROM` must use a domain you have verified, e.g.
   `Van Cortlandt Benches <benches@your-domain.org>`.

## 3. Hosting: Render

1. Sign up at [render.com](https://render.com) and connect your GitHub
   account.
2. **New → Blueprint**, pick this repository. Render reads `render.yaml` and
   creates two services: `bench-api` and `bench-web`.
3. On **bench-api → Environment**, fill in the values Render asked for:

   | Setting | Value |
   |---|---|
   | `DATABASE_URL` | the Neon pooled string |
   | `WEB_URL` | `https://bench-web.onrender.com` |
   | `RESEND_API_KEY` | from Resend |
   | `MAIL_FROM` | your verified sender |
   | `JOBS_TOKEN` | any long random string (keep a copy) |

4. Deploy. `bench-api` runs migrations and starts; `bench-web` builds the
   site. Check `https://bench-api.onrender.com/api/health/ready` reports
   `"status":"ok"`.

If you renamed the services, update the `/api/*` rewrite in `render.yaml` to
match your API's address.

## 4. The daily job

In GitHub: **Settings → Secrets and variables → Actions**, add

- `API_URL` = `https://bench-api-mp8e.onrender.com`
- `JOBS_TOKEN` = the same token as above

The workflow in `.github/workflows/daily-job.yml` then runs every morning,
and you can trigger it by hand from the Actions tab.

## 5. Make yourself staff

```sh
DATABASE_URL='paste-it-here' npm run make-admin -w @bench/api -- you@example.org
```

Then sign in on the site with that address.

## What the free plan means

- **The API sleeps after 15 minutes idle.** The first visit afterwards takes
  up to a minute to wake it. Paid plans (from $7/month) stay awake.
- **No always-on worker**, so the API sends queued email itself
  (`SEND_MAIL_FROM_API=true`) and the daily job catches anything missed. To
  split it out later, run `npm run worker -w @bench/api` as its own service
  and set `SEND_MAIL_FROM_API=false`.
- **The database is Neon's free tier**, which is permanent but small. Plenty
  for one park.

## Other hosts

Nothing here is Render-specific: the API is one Node process, the site is
static files, and both read their settings from the environment
(see [operations.md](operations.md)). Fly.io, Railway, a small VPS or a
container platform all work the same way.
