# Dien Academy Blockchain Masterclass

Booking website and administration tools for the Blockchain Masterclass event.

## Production architecture

- **Vercel** hosts the Next.js site and Express API. The API is split into
  serverless functions by route group under `frontend/pages/api/`; deploy this
  repository as one Vercel project with `frontend/` as its Root Directory.
- **Supabase** provides managed PostgreSQL and private Storage for attendee
  payment receipts. The backend connects to Postgres with `pg` and to Storage
  server-side with `@supabase/supabase-js`.
- The browser calls the same-origin `/api/*` routes on Vercel. Do not expose
  database credentials or Supabase secret keys to frontend code.

Supabase is the data and storage platform for this setup, not the host for the
existing Next.js and Express servers.

## Local development

Install dependencies in both applications, then start the frontend:

```bash
cd backend && npm install
cd ../frontend && npm install && npm run dev
```

The frontend serves the API in-process. Create a private `.env` file in the
repository root and configure the required local values described in
[DEPLOYMENT.md](./DEPLOYMENT.md). Environment files are intentionally ignored
by Git. Backend scripts and the frontend load the same repository-root `.env`.

## Deploying

See [DEPLOYMENT.md](./DEPLOYMENT.md) for Supabase project setup, database
migrations, Vercel configuration, environment variables, private receipt
storage, and production verification.

The authoritative PostgreSQL bootstrap schema is
[`backend/config/schema.sql`](./backend/config/schema.sql). Add later schema
changes as new files in [`backend/migrations/`](./backend/migrations/), then
apply them with `npm run db:migrate` from `backend/` before deploying code that
requires them.
