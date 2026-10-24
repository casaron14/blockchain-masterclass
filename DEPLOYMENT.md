# Deployment

The production architecture is **Vercel for the app and API, Supabase for
Postgres and private object storage**. Supabase is not the host for this
Next.js/Express application. The repository ships as one Vercel project: the
Next.js app in `frontend/` also serves the Express API.
`frontend/pages/api/[...all].js` forwards every `/api/*` request to the same
Express application that `backend/server.js` serves locally.

```text
Vercel project (Root Directory: frontend)
├── app/, components/, lib/          Next.js pages
├── pages/api/[...all].js            single serverless function → Express
└── ../backend, ../shared            imported at build time (outside root)
```

`backend/` and `shared/` sit outside the project root, so on Vercel you **must**
enable **Include source files outside of the Root Directory in the Build Step**
in the project's Build & Development settings. Without it the build cannot see
`backend/app.js` and `shared/eventConfig.js`.

The API runtime dependencies (`express`, `pg`, `pdfkit`, `ethers`, …) are listed
in both `backend/package.json` (for the standalone server, tests and scripts) and
`frontend/package.json` (the deployed function resolves them from
`frontend/node_modules`). **Keep the two lists in sync when adding a runtime
dependency**; `next.config.mjs` keeps them out of the webpack bundle through
`serverExternalPackages` and traces them into the function instead.

## 1. Database (Supabase)

The API uses standard PostgreSQL. Supabase is the recommended managed host:
create a project, then copy its connection string into Vercel. No code change
is needed per environment: `DATABASE_URL` is read first, and the five `DB_*`
values remain the fallback for local development.

### 1.1 Create and connect the Supabase project

1. Create the project in the Supabase dashboard and wait for the database to
   finish provisioning.
2. Open **Project Settings → Database → Connection string** and copy **two**
   URLs:
   - **Transaction pooler** (`...pooler.supabase.com:6543`) → `DATABASE_URL`
     on Vercel. Serverless functions are short-lived and many instances open
     at once, so the transaction pooler is required; the direct connection
     exhausts the project's client limit.
   - **Session pooler** (`...pooler.supabase.com:5432`) → use it locally as
     `DATABASE_URL` when running migrations. Session mode supports the
     multi-statement `schema.sql` and advisory-lock-friendly sessions.
3. If the Vercel project is connected to Supabase through the Vercel
   Marketplace integration, it may inject `POSTGRES_URL` instead of
   `DATABASE_URL`. Both are accepted, plus `SUPABASE_DB_URL`.

TLS is required. When `DB_SSL` is unset, a `*.supabase.com` host defaults to
`no-verify`: the connection is encrypted, but the provider CA is not pinned.
Set `DB_SSL=require` only after confirming the runtime trusts the CA.

Supabase's pooler rejects PostgreSQL's `options` startup parameter. When
`DATABASE_URL` is used, the pool omits it automatically. Apply the same limits
once in the Supabase SQL editor so a stuck booking still cannot hold the seat
counter forever:

```sql
ALTER ROLE CURRENT_USER SET statement_timeout = '30s';
ALTER ROLE CURRENT_USER SET idle_in_transaction_session_timeout = '15s';
```

### 1.2 Apply the schema

Run the migration once from your machine (or CI) against the **session** URL.
The schema is idempotent and replays safely on every release:

```bash
cd backend
DATABASE_URL='postgresql://...session-pooler...:5432/postgres' npm run db:migrate
```

`npm run db:migrate` replays `backend/config/schema.sql` and then applies every
pending file in `backend/migrations/`. CI does not run migrations; run them as
an explicit release step before the deploy that needs the new columns.

### 1.3 Supabase security notes

- The API connects as the database owner over the pooler. Supabase Row Level
  Security is therefore **not** the access-control layer for this server
  connection; the Express API and its admin bearer token are. The browser does
  not query Postgres through Supabase's Data API. Disable the Data API if the
  project does not need it, or ensure every exposed table has appropriate RLS
  policies and grants. Supabase Storage remains available through its own API.
- Keep the database password only in Vercel and your password manager.
- Supabase's free plan pauses an idle project. A paused database makes
  `/api/health` return `503`; resume the project or upgrade before the event.
- `DB_POOL_MAX=3` is the right value on Vercel. Each warm serverless instance
  keeps its own pool, and the transaction pooler multiplexes them.

### 1.4 Store attendee receipts in Supabase Storage (optional)

The default receipt flow stores file bytes in PostgreSQL. To use Supabase
Storage instead:

1. In Supabase **Storage → New bucket**, create
   `offline-payment-receipts`. Keep it **private** (Public bucket off), set the
   file size limit to **4 MB**, and allow only `application/pdf`, `image/jpeg`,
   `image/png`, and `image/webp`.
2. Before deploying the updated API, run the database migration against the
   Supabase **Session pooler** URL:
   ```bash
   cd backend
   DATABASE_URL='postgresql://...session-pooler...:5432/postgres' npm run db:migrate
   ```
   This adds the object-path column while preserving existing receipt rows.
3. Add these Vercel **server-side** environment variables to Production:
   - `OFFLINE_PAYMENT_RECEIPT_STORAGE=supabase`
   - `SUPABASE_URL` — the project URL copied from Supabase's **Connect** dialog
   - `SUPABASE_SECRET_KEY` — a Supabase secret key (`sb_secret_...`). The
     legacy `service_role` key is also accepted as
     `SUPABASE_SERVICE_ROLE_KEY`.
   - `SUPABASE_RECEIPT_BUCKET=offline-payment-receipts` (optional when using
     this default bucket name)
4. Redeploy. The backend uploads objects under `receipts/`, records each
   object's path in `offline_payment_receipts`, and streams files back through
   the authenticated admin API. The secret key must never use a `NEXT_PUBLIC_`
   variable and must not be sent to browsers.

The bucket stays private and needs no public access policy: the backend uses
the server-only secret key, which bypasses Storage RLS. The app does not create
the bucket automatically; create it in the Supabase dashboard first. Existing
receipts stored in PostgreSQL remain downloadable after enabling Storage.
Legacy disk-only receipts remain accessible only where their original files
still exist. New receipts use the bucket; removing the bucket or its key will
make those new receipts unavailable.

### Required database environment variables

| Variable | Value on Vercel |
| --- | --- |
| `DATABASE_URL` | Supabase **transaction pooler** URL (port `6543`) |
| `DB_SSL` | optional; `require` to verify the CA, otherwise defaults per host |
| `DB_POOL_MAX` | `3` for serverless, `10` for a long-lived server |
| `DB_STATEMENT_TIMEOUT_MS` | `30000` |

Without a connection URL the pool sets `statement_timeout` and
`idle_in_transaction_session_timeout` on every connection through the `options`
startup parameter. With `DATABASE_URL` that parameter is omitted for pooler
compatibility, so the role-level `ALTER ROLE` statements above provide the same
protection.

The fallback variables (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`,
`DB_DATABASE`) are only read when no connection URL is present.

## 2. Vercel project

1. Create **one** Vercel project from this repository.
2. Set **Root Directory** to `frontend`.
3. Enable **Include source files outside of the Root Directory in the Build
   Step**.
4. Add the environment variables from the repository-root `.env.example`
   (the universal template for this project) to the Production and Preview
   targets.
5. Deploy, then verify `GET https://<domain>/api/health` returns
   `{"status":"ok","database":"connected"}`.

`frontend/vercel.json` declares the daily cron. `next.config.mjs` sets
`outputFileTracingRoot` to the repository root so `backend/` and `shared/` are
included in the deployed function, and traces the PDFKit font data and bcrypt
native bindings that are loaded at runtime rather than through `require`.

### Environment variables

Required for the current production setup:

- `NODE_ENV=production`
- `DATABASE_URL` (Supabase transaction pooler URL)
- `JWT_SECRET` (long random value)
- `CRON_SECRET` (long random value; Vercel Cron sends it as a bearer token)
- `TRUST_PROXY_HOPS=1` so rate limiting sees the real client IP behind Vercel.
- An admin account, either `ADMIN_USERNAME` plus `ADMIN_PASSWORD_HASH`, or a
  database-backed account created with `npm run admin:create`.
- `EMAIL_DELIVERY_ENABLED=false` when the deployment does not send email at
  all (see "Running without email" below). Otherwise the SMTP transport
  variables and `MAIL_FROM` are required.
- `TURNSTILE_SECRET_KEY` in production: booking and login are rejected without
  it.

The current checkout accepts offline Lipa Namba payments only. Blockchain
signing, RPC, and wallet variables are not needed unless a crypto payment flow
is explicitly re-enabled.

### Admin sign-in from environment variables

The deployed admin account does not need a row in the `users` table. Set:

```text
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH='$2b$12$...'   # preferred
# or ADMIN_PASSWORD=...             # plain text, still supported
ADMIN_NAME=Event Administrator      # optional
ADMIN_EMAIL=admin@example.com       # optional
ADMIN_TOTP_SECRET=...               # optional base32 authenticator secret
```

Generate the hash locally:

```bash
cd backend && npm run admin:hash-password -- 'your-password'
```

The script prints the `ADMIN_PASSWORD_HASH='...'` line to paste into Vercel.
Run it without an argument to generate a strong random password as well.

Behaviour:

- With any `ADMIN_*` credential configured, the API signs in **only** the
  environment admin. It deliberately does not fall back to `users`, so a
  forgotten database account cannot become a hidden second entrance.
- Without `ADMIN_TOTP_SECRET` the password is the only factor and login
  returns the admin token in one step. With it, the normal 6-digit
  authenticator step is required. `/api/auth/totp/setup` and
  `/api/auth/totp/confirm` answer `409 TOTP_MANAGED_BY_ENVIRONMENT`.
- Removing every `ADMIN_*` value restores the database-backed login used by
  local development (`npm run admin:create`).
- Keep `ADMIN_PASSWORD_HASH` in single quotes when setting it from a shell:
  the `$` characters are part of the hash and would otherwise be expanded.

`CORS_ALLOWED_ORIGINS` is **not** needed for the normal setup: the browser calls
`/api/*` on the same origin, and `frontend/middleware.js` removes the browser
`Origin` header on that internal hop. Only set it if a separately hosted client
calls this API directly.

Do **not** set `ENABLE_JOBS=true` on Vercel: the process is frozen between
requests and has no timers. Leave `ENABLE_SWEEP_JOB=false` everywhere in
production; use the offline `npm run sweep:prepare/sign/submit` flow.

### Scheduled work on Vercel

`frontend/vercel.json` declares one daily cron (`0 2 * * *`) because the Vercel
Hobby plan does not allow sub-daily schedules. It calls `GET /api/cron/tick`; the
endpoint runs every job whose `ENABLE_<NAME>_JOB` flag is true and whose
schedule is due, and returns a per-job outcome list.

Set these on the project so the cron has work to do:

```text
ENABLE_PAYMENT_MONITOR_JOB=true
ENABLE_SEAT_HOLDS_JOB=true
ENABLE_ORDER_EXPIRY_JOB=true
ENABLE_TICKET_DELIVERY_RETRY_JOB=true
ENABLE_LISTENER_HEALTH_JOB=true
ENABLE_GAS_WALLET_MONITOR_JOB=true
ENABLE_RECONCILIATION_JOB=true
ENABLE_SWEEP_JOB=false
ENABLE_JOBS=false
```

`ENABLE_JOBS` must stay false on Vercel (it starts in-process timers); the
individual flags are read by the cron endpoint.

For minute-level payment monitoring (Vercel Pro) change the schedule to
`* * * * *`. On Hobby, point an external scheduler (cron-job.org, GitHub
Actions schedule, …) at `https://<domain>/api/cron/tick` with
`Authorization: Bearer $CRON_SECRET` once per minute.

The attendee payment page no longer polls the API. It tells the attendee that
the ticket will be emailed within one hour, so USDT confirmation depends on the
payment monitor job running on this schedule rather than on a visitor keeping
the page open. Lipa Namba receipts are confirmed by an admin and do not need the
monitor.

The cron endpoint fails closed with `503 CRON_NOT_CONFIGURED` when `CRON_SECRET`
is missing and returns `401 CRON_UNAUTHORIZED` for a wrong secret.

The `/api/[...all]` route exports `maxDuration = 60` so the cron tick, which
runs the due jobs sequentially, can use the plan maximum.

## 3. Local development

Copy the repository-root `.env.example` to `.env` and set the values you need.
Both the frontend and backend load that same root file; environment variables
already supplied by the shell or hosting platform take precedence.

```bash
# Terminal 1 — Next.js + the Express API through /api/* (one process)
cd frontend && npm install && npm run dev

# Optional: run the API on its own port (for API-only work)
cd backend && npm install && npm run dev
```

`NEXT_PUBLIC_API_BASE_URL` is unset by default, so the browser calls the API on
the same origin. Set it only to point a browser at a separately hosted API.

### Running without email

Tickets do not depend on email. The PDF is generated on demand from the booking
record by `GET /api/tickets/:bookingRef/download`, so every confirmed attendee
can download it from **Look up your booking** with their reference code.

Set `EMAIL_DELIVERY_ENABLED=false` on a deployment that should not send mail.
With that flag:

- confirming a booking writes no `ticket_deliveries` row and makes no SMTP
  call;
- the daily retry job returns immediately, so old failed deliveries are not
  retried either;
- the admin "resend ticket" endpoint answers `409` with
  `reason: email_delivery_disabled`;
- the admin confirmation message points the operator to the booking lookup
  instead of claiming the ticket was emailed.

The flag is unset by default, which keeps email enabled for existing
deployments. A confirmed booking always shows a download button in the lookup
and on the success page, with or without email.

## 4. Docker (alternative to Vercel)

Both images are built from the repository root because they copy `shared/` (and,
for the web image, `backend/`):

```bash
docker build -f backend/Dockerfile -t dienacademy-api .
docker build -f frontend/Dockerfile -t dienacademy-web .
```

The backend image creates `backend/out/receipts` and `backend/out/tickets` and
runs as the unprivileged `node` user. Set `DOCUMENT_STORAGE_MODE=local` there if
you want PDFs kept on disk; email attachments are generated in memory either
way.

## 5. Payments: what is live

- **Lipa Namba (offline):** the only selectable method. Attendee uploads a
  receipt; an admin confirms the booking after reviewing it. By default, the
  uploaded file is stored in PostgreSQL (`offline_payment_receipts.file_data`).
  When `OFFLINE_PAYMENT_RECEIPT_STORAGE=supabase` is configured, new files go
  to the private Supabase bucket and the database stores their object paths.
  The booking form caps uploads at 4 MB and the API enforces the same Vercel
  ceiling (self-hosted installs default to 5 MB via
  `MAX_OFFLINE_PAYMENT_RECEIPT_FILE_SIZE_BYTES`).
- **Instant Payment (AzamPesa STK push): coming soon.** The checkout renders it
  as a muted, non-selectable card. `AZAMPESA_PAYMENTS_ENABLED` is `false` in
  `shared/eventConfig.js`, the initiation route rejects new payments with
  `409 PAYMENT_METHOD_NOT_AVAILABLE`, and `/webhook/azampay` is not mounted. The
  integration code remains for when it is completed.
- **USDT (BEP20): muted / coming soon.** The checkout renders it as a muted card
  and new bookings cannot select it. The listener, sweep and reconciliation
  services are unchanged, so USDT invoices created before the rail was muted
  still settle. `CONFIGURED_PAYMENT_METHODS` in `shared/eventConfig.js` therefore
  stays wider than `SELLABLE_PAYMENT_METHODS` on purpose.
- Historical AzamPesa and USDT rows remain visible in the admin transaction view
  for reconciliation.

## 6. Operational checks after deploying

1. `GET /api/health` → `200` with `database: connected`.
2. `GET /api/events/blockchain-masterclass` → `paymentMethods` is
   `["lipanamba"]` and `comingSoonPaymentMethods` is
   `["azampesa","usdt_bep20"]`.
3. The booking form shows Lipa Namba as the only selectable method and the other
   two as "Coming soon".
4. Create a test booking, confirm it in the admin, then open **Look up your
   booking** with its reference: the ticket PDF must download. Repeat on the
   success page. With email enabled, the ticket and receipt emails must arrive
   as well.
5. Call `/api/cron/tick` with the wrong bearer token → `401`; with the right one
   → `200` and a job outcome list.
6. Confirm `POST /api/payments/<id>/initiate-azampesa` returns `409`.
7. Sign in at `/admin/login` with `ADMIN_USERNAME` / password. If
   `ADMIN_TOTP_SECRET` is set, the authenticator step must appear; otherwise the
   dashboard opens directly.
8. Open `/admin/referrals`, create a test referrer, visit the generated invite
   link in a private window and book. The booking must appear under that code.
9. Download the referrer CSV and the bookings CSV; both must open in a
   spreadsheet with the expected headers.

## 7. Referral campaigns and CSV exports

A referral link is the event URL plus the referrer's code as `utm_source`:

```text
https://<domain>/?utm_source=ref_neema_x7k2
```

`ref=` and `referrer=` are accepted as aliases. The event is served from the
bare domain, so the landing page stores the valid value from the URL in
`localStorage` for the event slug, and the booking form sends it as
`utm_source`; it is stored on `bookings.utm_source`. A later tracked link
replaces the stored value, so the most recent campaign touch wins. The value is
also editable on an admin booking and in the admin "Create a booking" form.
Old `https://<domain>/blockchain-masterclass?...` links permanently redirect to
the same page on the bare domain, so already-printed QR codes and campaigns keep
working.

Admin → **Referrals** is the campaign screen:

- **Create a referral link** registers a referrer and shows the shareable URL.
- Each row shows the referrer, code, phone, referred/confirmed/pending counts
  and the latest referral.
- **View clients** lists every booking attributed to that code.
- **Download CSV** downloads that referrer's clients, ready to send to them.
- **Export all referrals** downloads the per-referrer summary.

The dashboard's **Download CSV** exports bookings (respecting the status
filter). CSV files are UTF-8 with a BOM and CRLF line endings so Excel opens
them correctly, and any cell that starts with `=`, `+`, `-` or `@` is prefixed
with an apostrophe so an attendee cannot inject a spreadsheet formula.

The corresponding API routes all require the admin bearer token:

```text
GET  /api/admin/bookings/export.csv          (optional ?status=confirmed)
GET  /api/admin/referrals
GET  /api/admin/referrals/export.csv
POST /api/admin/referrals
GET  /api/admin/referrals/:referrerCode/clients
GET  /api/admin/referrals/:referrerCode/export.csv
```

## 8. Reviewing flagged payments

Money that arrives but cannot be settled automatically (an overpayment, a deposit
after the hold expired, a sweep that raced confirmation) is stored in
`payment_review_flags`. Admins can list and close those flags through the API:

```bash
# List the flags that still need a decision
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://<domain>/api/admin/payment-review-flags

# Record the decision
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"resolution_note":"Refunded the overpayment."}' \
  https://<domain>/api/admin/payment-review-flags/<flag-id>/resolve
```

Pass `?include_resolved=true` to review the decision history.

## 9. Known gaps after this change

- Rotating `ADMIN_PASSWORD_HASH` / `ADMIN_PASSWORD` requires a Vercel env
  change and redeploy. Tokens issued before the rotation stay valid until their
  `JWT_EXPIRES_IN` window ends (8h by default).
- Admin JWTs are still stored in `localStorage` (the API accepts them as bearer
  tokens). A CSP is set on the frontend, but moving to httpOnly cookies is still
  the stronger option.
- Rate limiting uses in-process memory, so on serverless it is per instance, not
  global. Turnstile and the strict per-endpoint limits remain the primary
  defences.
- The payment-review flags have an API but no admin screen yet; use the calls
  above until the transactions page grows a review panel.
