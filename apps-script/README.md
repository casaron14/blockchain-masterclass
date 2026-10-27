# Google Apps Script email delivery and booking mirror

This is the simplest setup for ticket emails: no Gmail app password and no SMTP
server. The booking backend keeps using PostgreSQL, and posts each confirmed
booking to a Google Apps Script web app. The script:

1. checks a shared secret,
2. sends the ticket email (PNG attached) with `GmailApp`,
3. writes one row per delivery into the bound Google Sheet.

The Sheet is a **delivery log and booking mirror**, not the database. The
admin dashboard and PostgreSQL remain the source of truth.

## 1. Create the Sheet

1. Go to <https://sheets.new> and name the file, for example
   `Blockchain Masterclass tickets`.
2. Leave it empty. The script creates the `Ticket deliveries` tab and its header
   row on the first request.

## 2. Add the script

1. In the Sheet, open **Extensions → Apps Script**.
2. Delete the placeholder `Code.gs` content and paste the contents of
   [`Code.gs`](./Code.gs).
3. Open **Project Settings**, tick **Show "appsscript.json" manifest file in
   editor**, then open `appsscript.json` and paste the contents of
   [`appsscript.json`](./appsscript.json).
4. In **Project Settings → Script Properties**, add one property:

   | Property | Value |
   | --- | --- |
   | `SHARED_SECRET` | A long random string, for example the output of `openssl rand -hex 32` |

   Use the same value as `APPS_SCRIPT_SHARED_SECRET` in the backend. The script
   refuses every request when this property is missing.

## 3. Authorize and test sending

1. In the editor, select `sendTestEmailToScriptOwner` and click **Run**.
2. Approve the permission screen. The email arrives at the Google account that
   owns the Sheet.
3. If you do not receive it, run `diagnoseTicketEmailDelivery` and check
   **Executions**. It reports whether the secret, Sheet, Gmail quota (when
   readable), and a live Gmail send all work. A null quota is reported as
   unknown, not as a failure; the live send is the real test.
4. Open the `/exec` URL in a private window. It should return
   `{"ok":true,"service":"ticket-email-and-sheet-sync"}`. A Google sign-in page
   means the deployment is not anonymous yet.

## 4. Deploy the web app

1. Click **Deploy → New deployment**.
2. Select **Web app**.
3. Set:
   - **Execute as:** `Me`
   - **Who has access:** `Anyone`
4. Deploy and copy the URL that ends in `/exec`.

The URL plus the shared secret is what the backend needs. Treat both as
secrets: anybody with both can send mail from your account.

### Updating an existing deployment

After pasting a newer [`Code.gs`](./Code.gs) into the editor, open **Deploy →
Manage deployments**, edit the active deployment, choose **Version: New version**,
set **Execute as: Me** and **Who has access: Anyone**, and deploy. Editing the
code alone does not update the `/exec` URL. Do not use the `/dev` test URL: it
requires a Google sign-in, so the backend receives `401`. An old version answers
`delivery_metadata_missing` to the booking sync because it only understands
ticket and receipt email requests.

## 5. Configure the backend

Add these server-side variables (locally in `.env.local`, in production in
Vercel or your host):

```bash
EMAIL_PROVIDER=apps_script
APPS_SCRIPT_TICKET_WEBHOOK_URL=https://script.google.com/macros/s/REPLACE_WITH_DEPLOYMENT_ID/exec
APPS_SCRIPT_SHARED_SECRET=the-same-value-as-the-SHARED_SECRET-script-property
# Optional, defaults to 15000.
APPS_SCRIPT_REQUEST_TIMEOUT_MS=15000
# Optional, defaults to 200 bookings per sync request (maximum 500).
GOOGLE_SHEET_SYNC_BATCH_SIZE=200
```

`EMAIL_PROVIDER` must be set explicitly. A placeholder URL alone never switches
the provider.

You can now remove `GMAIL_USER`, `GMAIL_APP_PASSWORD` and the SMTP variables;
they are no longer used when the provider is `apps_script`.

## 6. Verify end to end

```bash
cd backend
DEV_TEST_TICKET_RECIPIENT_EMAIL='you@gmail.com' npm run test:ticket-email
```

The script prints the delivery id and writes a copy of the PNG to
`backend/out/tickets/`. The same delivery must also appear in the Sheet with
`Delivery status = sent`. The throwaway booking is deleted from PostgreSQL
afterwards, but its Sheet row remains as a log entry; delete that row by hand if
you want a clean Sheet.

Then open **Admin → Bookings** and press **Sync to Google Sheet**. Every booking
in PostgreSQL, including pending and cancelled ones, is upserted into the
`Bookings` tab by booking reference. Pressing the button twice must leave the
same row count; the second press is an update, not a duplicate.

## What the Sheet contains

### `Ticket deliveries`

One row per delivery attempt:

| Column | Meaning |
| --- | --- |
| `Delivery key` | `ticket:<REF>` or `receipt:<REF>`; the duplicate-protection key |
| `Email kind` | `ticket` or `receipt` |
| `Booking reference` | The `EVT-<REF>` reference code |
| `Attendee name`, `Email address`, `Phone number` | Contact details from the booking |
| `Booking status` | `confirmed` when the email was sent |
| `Event`, `Event date`, `Event time`, `Venue` | Event details shown on the ticket |
| `Ticket type`, `Amount`, `Currency` | Ticket details |
| `Delivery status` | `sending`, `sent` or `failed` |
| `Delivery id` | A UUID generated for the send |
| `Error` | The failure reason, truncated to 500 characters |
| `Attempt count` | How many times this delivery key was attempted |
| `First attempted at`, `Last attempted at` | ISO 8601 UTC timestamps |

A `sent` row is final: the same delivery key is never sent again, even if the
backend retries after a timeout. A `failed` row is updated on the next attempt.
A `sending` row is a short-lived reservation. If the script dies after Gmail
accepted the message but before it could write `sent`, the row stays `sending`
for **15 minutes** and the script answers `delivery_in_progress` instead of
sending again. After the lease expires, a retry is allowed. This is the same
claim pattern the PostgreSQL ticket delivery uses.

### `Bookings`

The **Sync to Google Sheet** button in the admin bookings screen mirrors the
whole PostgreSQL booking list into this tab. It is an upsert keyed by
`Booking reference`, so repeated syncs update existing rows instead of adding
duplicates. This tab is a recovery view: it includes bookings that never
received an email because they were created before delivery was enabled, their
payment is still pending, or their send failed.

| Column | Meaning |
| --- | --- |
| `Booking reference` | The `EVT-<REF>` reference code; the upsert key |
| `Attendee name`, `Email address`, `Phone number` | Contact details from the booking |
| `Booking status`, `Payment status`, `Payment method` | Current PostgreSQL state |
| `Amount`, `Currency` | Expected ticket amount; `TZS` for Lipa Namba/AzamPesa, `USDT` for USDT (BEP20) |
| `Referral` | Referrer name, or the UTM source when there was no referrer |
| `Ticket sent at` | When the ticket email succeeded; empty means **Not sent** |
| `Booking created at` | When the booking was created |
| `Last synced at` | When the sync button last wrote this row |

The tab is written in one request per `GOOGLE_SHEET_SYNC_BATCH_SIZE` bookings.
If one batch fails, the backend reports how many bookings synced and how many
did not; pressing the button again retries every row.

## Limits and behaviour

- **Free `@gmail.com`:** Apps Script allows about **100 recipients per day**.
  The backend's own daily guard defaults to **90** when the provider is
  `apps_script`, leaving headroom for a manual resend. A Google Workspace
  account raises the Apps Script limit to about 1,500/day.
- The script asks `MailApp.getRemainingDailyQuota()` before sending and records
  `daily_quota_exhausted` when the quota is explicitly zero. `GmailApp` does not
  expose that method in every runtime, so the script falls back to the
  `GmailApp` method only if it exists, then to “unknown”. If the quota cannot be
  read, it logs the failure and still attempts the send, so Gmail returns the
  real permission or rate-limit error instead of a misleading quota error.
- `GmailApp` needs one authorization run after the script is pasted or the
  deployment is moved to a new version. Run `sendTestEmailToScriptOwner` once.
- Delivery is serialized with `LockService`, so two concurrent confirmations
  cannot both send the same delivery key.
- The data range is formatted as plain text, so an attendee name starting with
  `=` is stored literally and never evaluated as a spreadsheet formula.
- The `Ticket deliveries` tab mirrors a booking when the ticket flow runs. A
  booking with an invalid attendee email is rejected before the web app is
  called, so correct the email in the admin and resend. The separate `Bookings`
  tab is not affected by that rejection; the **Sync to Google Sheet** button
  mirrors it directly from PostgreSQL.
- The booking sync does not send email and does not use the Gmail quota. Only
  the `Ticket deliveries` tab consumes recipients.
- Apps Script normally answers in one to three seconds. The backend times out
  after `APPS_SCRIPT_REQUEST_TIMEOUT_MS` and records a retryable failure.
- Mail is always sent from the Google account that deployed the script. The
  visible sender name comes from `MAIL_FROM_NAME`; the address is shown as the
  account address.

## Troubleshooting

| Response | Cause | Fix |
| --- | --- | --- |
| `unauthorized` | `APPS_SCRIPT_SHARED_SECRET` does not match `SHARED_SECRET` | Copy the script property again, redeploy if needed |
| `apps_script_secret_not_configured` | `SHARED_SECRET` script property is missing | Add it in Project Settings → Script Properties |
| `daily_quota_exhausted` | The Google account hit its daily send limit | Wait for the quota reset, or use a Workspace account |
| `mail_send_failed` | `GmailApp` rejected the message: missing Gmail authorization, an invalid attendee address, a rate limit, or an attachment problem | Read the exact text in the `Ticket deliveries` tab, `Error` column, or **Apps Script → Executions**. Run `diagnoseTicketEmailDelivery`, confirm **Execute as: Me**, correct the attendee email, then resend |
| `gmail_quota_check_failed` | An older deployment blocked the send because `GmailApp.getRemainingDailyQuota()` is not a function in that runtime | Redeploy the current `Code.gs`; it uses `MailApp` for the quota read when available, treats an unreadable quota as unknown, and attempts the send so Gmail returns the real error |
| `delivery_in_progress` | A previous execution reserved this delivery key and did not finish | Wait up to 15 minutes; the backend retry then sends normally |
| `script_busy` | Another delivery held the lock for 30 seconds | Retry; the backend records a retryable failure |
| `spreadsheet_not_available` | The script is not bound to a Sheet | Create the script from **Extensions → Apps Script** inside the Sheet |
| Backend says `APPS_SCRIPT_RESPONSE_NOT_JSON` | The deployment is not public, the URL is wrong, or you copied a `/dev` URL | Redeploy with **Who has access: Anyone** and copy the `/exec` URL again |
| Backend says `APPS_SCRIPT_HTTP_401` | Google requires sign-in for the URL. You are probably using the `/dev` test URL, or access is **Anyone with a Google account** / **Only myself** | Use the `/exec` URL from **Manage deployments** and set **Who has access: Anyone** (anonymous) |
| Backend says `APPS_SCRIPT_HTTP_403` | Google or a Workspace policy refused anonymous access | Set **Who has access: Anyone**; if the option is unavailable, the Workspace admin must allow anonymous web apps or use a personal Google account |
| Backend says `APPS_SCRIPT_HTTP_404` | The `/exec` URL no longer matches a deployment | Open **Manage deployments**, copy the current `/exec` URL, and update the backend variable |
| Backend says `APPS_SCRIPT_WEBHOOK_URL_INVALID` | The URL is not a `script.google.com/macros/s/.../exec` URL | Copy the deployment URL exactly |
| Admin sync says the webhook is not configured | `APPS_SCRIPT_TICKET_WEBHOOK_URL` or `APPS_SCRIPT_SHARED_SECRET` is missing on the server | Add both, then redeploy the backend |
| Admin sync says every batch failed | The deployment is not public, the secret rotated, or Apps Script is down | Open the `/exec` URL in a browser, then check the secret and deployment access |

## Rotating the secret

1. Change `SHARED_SECRET` in the script properties.
2. Update `APPS_SCRIPT_SHARED_SECRET` in the backend and redeploy.
3. If the URL leaked, create a new deployment and replace
   `APPS_SCRIPT_TICKET_WEBHOOK_URL` as well.

## Rows are not editable state

Do not edit `Delivery key`, `Delivery status` or `Delivery id` by hand. Changing
`Delivery status` from `sent` to `failed` would allow a second email for the
same booking.
