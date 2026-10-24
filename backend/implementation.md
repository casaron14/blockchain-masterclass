# Implementation Plan: Blockchain Masterclass Booking Website

**Status:** Draft
**Companion document:** BlockchainMasterClass.md
**Last updated:** August 30, 2026

> **Current-state note (added October 2026).** The product has moved past this
> draft in several places, and this document is kept as the architectural
> reference rather than a live specification. The current facts are:
>
> - **Live payment methods are Lipa Namba (offline, admin-reviewed) and USDT
>   BEP20 only.** AzamPesa is retired (`AZAMPESA_PAYMENTS_ENABLED = false` in
>   `shared/eventConfig.js`); its code and tables remain for reconciling
>   historical rows. Sections describing the AzamPesa flow are historical.
> - The live event is 150 seats at TZS 10,000 (USDT equivalent in
>   `shared/eventConfig.js`), not the 300-seat/TZS 30,000 figures below.
> - The admin dashboard exists, as do the Next.js frontend, ticket/receipt PDFs
>   and the on-chain listener.
> - Production runs on Vercel plus managed PostgreSQL. Read `../DEPLOYMENT.md`
>   for the deployment model, environment variables and serverless constraints,
>   and `handover.md` for the as-built backend.
>
> Where this document and the code disagree, the code and the two documents
> above win.

## 1. Purpose

This document translates the product requirements in BlockchainMasterClass.md into an implementation plan for the actual booking system. It focuses on the live booking flow, data model, payment handling, seat-cap enforcement, ticket delivery, security, and the delivery milestones required before launch.

The implementation should stay intentionally simple and production-focused. The product is a single-event booking site for a broad public audience, with a fixed ticket price, a 300-seat cap, and a clear payment flow that works for attendees who may not be familiar with crypto or mobile money.

> **Note on current direction (updated August 30, 2026):** The decision has been made to first stabilize the **pure Express + PostgreSQL backend** that already exists in this repository before adding the Next.js public frontend. Section 3.5 records the actual as-built state of the repo and the discrepancies found, which drive the concrete next steps. This keeps the earlier high-level framework sections intact while documenting what is really implemented today.

## 2. Scope and Product Constraints

The implementation is limited to the following realities from the PRD:

- Single event only, no multi-event logic
- One ticket type: TZS 30,000 per ticket
- Capacity: 300 seats total
- Payment methods: AzamPesa STK push, USDT on BEP20, and Lipa Namba with receipt review
- Seat hold window: 60 minutes while payment is pending
- Ticket delivery: email with QR code and booking reference
- Public-facing site, mobile-first, in English and Swahili
- No admin dashboard in v1 unless explicitly added later
- No user account system required for public attendees

This means the implementation should prioritize reliability over feature breadth, especially around seat capacity, status transitions, and payment confirmations.

## 3. Technology Stack

The project already contains the core backend foundation in the repository and should continue with that direction.

### 3.1 Full-stack framework
- Next.js for the complete web application, including the public frontend and API routes
- React components for the booking, payment, and success states
- Express.js remains as the backend service only if a separate API layer is needed, but the preferred architecture is a Next.js app with server-side routes and API endpoints inside the same project

### 3.2 Backend logic
- Node.js + Express.js or Next.js API routes for booking, payment, and webhook handling
- PostgreSQL for transactional state and seat enforcement
- Joi for request validation
- dotenv for environment configuration
- Ethers.js for blockchain verification of BEP20 USDT transfers

### 3.3 Frontend
- Next.js App Router or Pages Router for the public-facing site
- mobile-first pages for homepage, booking, payment, and confirmation states
- reusable components for language switcher, pricing display, seat availability, and payment method selector
- no login or account system required for public attendees

### 3.3 Supporting services
- Email delivery for tickets
- Optional QR code generation library
- AzamPesa API integration for STK push and confirmation callbacks
- Optional blockchain RPC or explorer endpoint for USDT verification on BNB Smart Chain

### 3.4 Current repo alignment
The repository already contains a backend foundation, but the implementation should now be framed as a Next.js application that can still use Express-like API modules internally when needed.

Recommended structure:

- app/
  - page.js
  - booking/page.js
  - payment/page.js
  - success/page.js
  - globals.css
- components/
  - Header.js
  - LanguageSwitcher.js
  - BookingForm.js
  - PaymentMethodSelector.js
  - SeatAvailabilityBanner.js
- lib/
  - api.js
  - validation.js
  - bookingHelpers.js
- backend/
  - server.js
  - api/
    - bookingRouter.js
    - paymentRouter.js
  - controller/
    - bookingController.js
    - paymentController.js
  - config/
    - db.js
    - schema.sql
  - middleware/
    - authmiddleware.js
    - errorHandler.js
  - services/
    - bookingService.js
    - paymentService.js

This keeps the project as a Next.js-based product while preserving the database and logic modules already present in the codebase.

## 3.5 Actual Current State of the Repository

This section records what is actually implemented in the repository today, based on an audit of the code and the live PostgreSQL database. Use it as the source of truth for what exists versus what is still missing, and as the basis for the concrete next steps in Section 12.

### 3.5.1 What is implemented and working
- **Express server** (`server.js`) with mounted routes at `/api/payments`, `/auth`, and `/book`.
- **Database connection** (`config/db.js`) using `pg`, reading credentials from `.env`.
- **PostgreSQL database** `masterclass` is live. It currently contains only four tables: `bookings`, `payments`, `seat_capacity`, and `users` (the rest of `schema.sql` was never applied).
- **Booking controller** (`controller/bookingController.js`) — basic CRUD over the `bookings` table, including reference-code generation.
- **Payment controller** (`controller/paymentController.js`) — basic CRUD over the `payments` table.
- **Auth controller / routes / middleware** (`authController.js`, `authRoutes.js`, `authmiddleware.js`) — JWT-based register/login/logout. These are out of scope for the public flow (see Section 4.1) but present.
- **Middleware** — `authmiddleware.js`, `errorHandler.js`, request validators, and rate limiters exist.

### 3.5.2 What is missing or incomplete
- **`services/bookingService.js` and `services/paymentService.js` are empty stubs.** All the core business logic they should hold (seat-cap enforcement, 15-minute hold/expiry, payment verification) is unimplemented.
- **No seat-cap enforcement in application logic.** The schema has a sync trigger, but no code performs the `FOR UPDATE` row lock / capacity check described in Section 5.3.
- **No 15-minute hold / expiry logic.** The schema defaults `bookings.expires_at` to 30 minutes and no job/query expires stale holds.
- **The `bookings` table has no `email` column**, which the PRD requires for ticket delivery.
- **No AzamPesa STK integration** (no initiation call, no callback webhook, no authentication).
- **USDT/BEP20 verification is implemented** in `usdtPaymentService.js` and the monitor/settlement services.
- **No ticket delivery** — no email sending (`nodemailer` is not installed) and no QR generation (`qrcode` is not installed).

### 3.5.3 Known problems found during the audit
- **`config/schema.sql` will not re-run cleanly.** It declares `CREATE TYPE payment_method` twice (lines 37 and 86) and `CREATE TYPE payment_status` twice (lines 39 and 87). Because the script aborts on the second declaration, the webhook / blockchain / azampesa support tables defined later in the file were never created.
- **The live database enums are out of sync with `schema.sql` and with the PRD.** The database currently uses `azampesa_stk`, `lipanamba`, `usdt_bep20` for `payment_method` and `pending`, `confirmed`, `failed` for `payment_status`. This matches neither the current file nor the PRD, which requires only `azampesa` and `usdt_bep20`.
- **Fragile dependency setup.** `express`, `cors`, `pg`, `bcrypt`, and `jsonwebtoken` are imported by the code but are **not declared in `package.json`**. They currently resolve only because they happen to be hoisted in a parent `/home/xiv/node_modules` directory. This will break on a clean install or another machine. `nodemailer` and `qrcode` are missing entirely, and `bcrypt`/`jsonwebtoken` are used in `authController.js` but absent from `package.json`.
- **`middleware/errorHandler.js` is broken** — it uses CommonJS `module.exports` inside a project that runs as ES modules (`"type": "module"`). It must be converted to an `export default` before use.
- **Secrets are tracked in git.** `.env` (which contains `JWT_SECRET`, `ALCHEMY_API_KEY`, and `WALLET_MNEMONIC`) is under version control and the `.gitignore` does not cover `.env` itself (only `.env.local` variants). This is a security risk and must be fixed before launch.
- **The `bookings` and `users` representations of the actual DB differ from `schema.sql`** (e.g. `booking_status` enum in the DB already includes `cancelled`; code in `authController.js` reads `hashedpassword` lowercase). Schema and code must be reconciled against one canonical `schema.sql`.

### 3.5.4 Consequences for implementation
- The schema must be fixed and the `masterclass` database rebuilt so that code, database, and PRD all agree (see Section 5).
- The required runtime dependencies must be added to `package.json` and installed inside the project so it runs reproducibly (see Section 12, Phase 0).
- The backend-first build order in Section 12 should have the core booking flow completed before any payment integrations or frontend work.

## 3.6 Multi-event backend contract (frontend-first)

The public frontend has been refactored to be **multi-event and reusable**: all pages live under `/masters/:slug`, and event details (name, date, location, local price, crypto price, seat cap, contact/brand) are fetched per event with a frontend default fallback. The backend is currently **single-event**, so the frontend falls back to a default `Blockchain Masterclass` config until the contract below is implemented.

The following contract is what the frontend (`lib/api.js`, `context/EventContext.jsx`, `lib/eventConfig.js`) expects the backend to provide. Implementing it resolves the temporary fallback.

### 3.6.1 `GET /events/:slug`
Returns the full event configuration for a single event. Frontend shape consumed by `buildEventConfigFromPayload`:

```jsonc
{
  "slug": "blockchain-masterclass",
  "name": "Blockchain Masterclass",
  "event": {
    "date": "to be announced",
    "location": "Dar es Salaam, Tanzania"
  },
  "price": {
    "localCurrency": "TZS",
    "localAmount": 30000,
    "cryptoCurrency": "USDT",
    "cryptoNetwork": "BEP20",
    "cryptoAmount": 12
  },
  "seatCapacity": 300,
  "contact": {
    "supportEmail": "support@example.com",
    "supportPhone": "+255 000 000 000",
    "addressLine1": "Address Line 1",
    "addressLine2": "Dar es Salaam, Tanzania",
    "platformName": "Blockchain"
  },
  "paymentMethods": ["azampesa", "usdt_bep20"]
}
```

Notes:
- `paymentMethods` is expected to remain the two fixed methods `azampesa` and `usdt_bep20` (only labels/amounts are dynamic currently). Keep future expansion backward-compatible.
- The endpoint should return `404` for an unknown slug so the frontend can fall back to `defaultEventConfig`.

### 3.6.2 Query scoping on booking/payment endpoints
The frontend passes the event slug as a query param to scope records per event. The backend should scope by this value where relevant:
- `GET /book/availability?event=<slug>`
- `POST /book?event=<slug>`
- `GET /book/ref/:ref?event=<slug>`

Records should store the event slug so availability and reporting are event-specific rather than global.

### 3.6.3 Current state
- Frontend already consumes the above shape via `fetchEventConfigurationBySlug` and `buildEventConfigFromPayload`, falling back to `defaultEventConfig` (`slug='blockchain-masterclass'`) on failure or `404`.
- Booking/availability payment-endpoint calls already pass the `event` query param.
- Backend `GET /events/:slug` **is implemented** (`services/eventConfigService.js`,
  `controller/eventController.js`, `api/eventRouter.js`, mounted at `/events` in
  `server.js`). The frontend parser handles the documented nested shape (with
  flat-key fallback) and normalizes `paymentMethods` into `{ key, labelKey }`.
  Per-event query scoping (§3.6.2) is still pending.

## 4. Project Structure

The application should be organized around a Next.js app architecture, with the backend utilities retained as supporting services.

- app/
  - layout.js
  - page.js
  - booking/page.js
  - payment/page.js
  - api/
    - bookings/route.js
    - payments/route.js
    - webhooks/azampesa/route.js
- components/
  - Header
  - Footer
  - EventSummary
  - LanguageSwitcher
  - BookingForm
  - PaymentMethodSelector
- backend/
  - server.js
  - api/
    - bookingRouter.js
    - paymentRouter.js
    - authRoutes.js
  - controller/
    - bookingController.js
    - paymentController.js
    - authController.js
  - config/
    - db.js
    - schema.sql
  - middleware/
    - authmiddleware.js
    - errorHandler.js
  - services/
    - bookingService.js
    - paymentService.js
  - utils/
    - tokenUtils.js
    - responseHelpers.js

### 4.1 Recommended module responsibilities
- app pages: render the homepage, booking, payment, and confirmation screens
- app API routes: handle booking creation, payment initiation, and webhook callbacks within the Next.js app if using app router
- bookingController.js: server-side booking logic for the existing backend modules
- paymentController.js: payment initiation and confirmation logic
- bookingService.js: seat checks, hold logic, expiry process, and booking status transitions
- paymentService.js: AzamPesa and USDT validation logic
- schema.sql: event booking schema, payment state, seat capacity, and retry records

The current auth routes are not part of the public booking flow and should be treated as optional future admin tooling unless there is a confirmed need for staff login.

## 5. Data Model

The database should support the booking lifecycle end-to-end. `config/schema.sql` models the essentials (bookings, payments, seat_capacity, webhook/blockchain records) but, as recorded in Section 3.5.3, the file is currently broken and out of sync with the live database. The schema must be cleaned up and the `masterclass` database rebuilt so that the two match and both agree with the PRD.

### 5.0 Schema reconciliation checklist (before any code work)
- Remove the duplicate `CREATE TYPE payment_method` and `CREATE TYPE payment_status` declarations from `config/schema.sql`.
- Restrict `payment_method` to **`azampesa`** and **`usdt_bep20`** only (drop `lipanamba`, `bank_transfer`, `mpesa`, `tigopesa`, `airtelmoney`).
- Align `payment_status` and `booking_status` enums to the PRD values used by the code.
- Add the missing `email` column to `bookings` (required for ticket delivery).
- Set the booking hold window to **60 minutes** (`expires_at` default).
- Apply the remaining webhook / blockchain / azampesa support tables that never ran.
- Drop and recreate the `masterclass` database from the corrected `schema.sql`, and remove the stale `users` auth table or isolate it to the optional admin path.

### 5.1 Booking table
A booking record should store:
- booking id
- booking reference code
- attendee full name
- phone number
- email address (currently missing from the schema — must be added)
- booking status: pending, confirmed, cancelled, expired
- created_at
- updated_at
- expires_at (defaults to the 60-minute hold window)

The event booking process should not rely on a user account. All required attendee information should be captured at the time of booking.

### 5.2 Payment table
A payment record should store:
- booking_id
- payment_method
- amount_expected
- status
- reference_id
- wallet_address
- tx_hash
- initiated_at
- confirmed_at

For this project, payment_method should be restricted to:
- azampesa
- usdt_bep20

The current schema and live database still carry wider value sets (`lipanamba`, `bank_transfer`, `mpesa`, `tigopesa`, `airtelmoney`). As part of the schema reconciliation in Section 5.0, the enum must be reduced to only `azampesa` and `usdt_bep20` to match the PRD.

### 5.3 Seat capacity
The system must enforce a hard cap of 300 confirmed tickets.

Recommended implementation:
- maintain a single-row seat_capacity table with confirmed_count and cap
- enforce seat capacity during booking creation under a database transaction
- lock the seat_capacity row when confirming or creating payment transitions
- reject additional bookings once confirmed_count >= 300

The schema includes a trigger to sync `seat_capacity`, but the application logic that performs the capacity check with a row lock is **not yet implemented** (see Section 3.5.2). The core booking service must add the `FOR UPDATE` lock before confirming a new booking.

### 5.4 Payment and webhook tables
The schema defines `payment_webhooks`, `payment_webhook_errors`, `blockchain_transactions`, `blockchain_transaction_errors`, `blockchain_transaction_webhooks`, and `azampesa` as operational support tables for AzamPesa callbacks and crypto verification. None of these tables currently exist in the live database (the schema aborted before creating them). They must be applied during the schema rebuild and retained as operational support tables even if v1 does not expose them to the public.

## 6. Booking and Payment Flow

### 6.1 Homepage and availability check
When the user visits the homepage:
- the site displays the event title, date or “date to be announced”, location, and price
- the site shows remaining seat availability or sold-out status
- the user is given a clear CTA to start booking

The backend should expose an endpoint that returns:
- event status
- seats remaining
- sold-out flag

### 6.2 Booking submission
When the user submits booking details:
- validate name, email, and phone number
- check seat availability in a transaction
- create a booking with status pending
- create a payment record with status pending or initiating
- return a booking reference and payment session information to the frontend

Important: the seat must be treated as reserved for a short hold period, even before payment is confirmed.

### 6.3 Temporary hold logic
Once the payment step begins:
- the booking moves into a temporary hold state
- the hold expires after 60 minutes if payment is not completed
- expired holds do not delete the record; they remain visible for audit/debugging and reporting
- when the hold expires, the seat becomes available again

This is a critical requirement from the PRD and should be implemented explicitly rather than left implied.

### 6.4 AzamPesa flow
For AzamPesa STK push:
- backend starts the payment request
- payment is associated with the booking
- a reference is stored in the payment record
- frontend shows a waiting state while the payment is pending
- backend waits for an AzamPesa callback or polling result
- once payment is confirmed, booking and payment are marked confirmed
- ticket delivery begins

This flow should not rely on the frontend alone to mark payment complete. The server must verify payment before issuing the ticket.

### 6.5 USDT flow
For USDT on BEP20:
- backend displays a fixed wallet address and a fixed amount of 12 USDT
- the payment record is created as pending
- the user sends the exact amount from their wallet
- the backend checks blockchain confirmations using ethers.js or a provider API
- once the transaction matches the configured wallet and amount, the payment is marked confirmed
- the system issues the ticket only after confirmation

The flow should clearly show a pending state so users know the ticket is not confirmed until the blockchain confirms the transfer.

### 6.6 Lipa Namba offline flow
For Lipa Namba:
- the payment page shows the configured Lipa Namba number, account name, and exact ticket price
- the attendee pays through their mobile-money wallet and uploads a receipt (PDF, JPEG, PNG, or WebP, max 5 MB)
- the backend verifies the file signature, stores the receipt outside the public web root, and records it as `submitted`
- uploading a receipt extends the seat hold to the offline review window (24 hours by default)
- the admin opens the receipt from the booking detail page, checks it against the Lipa Namba statement, and confirms the payment
- confirming the payment approves the receipt, confirms the booking seat, and sends the ticket email
- if the payment is marked failed, the receipt is marked rejected so the attendee can upload a corrected one

A receipt upload never confirms a payment by itself. Only an admin action can move a Lipa Namba payment to `confirmed`.

### 6.7 Ticket delivery
After confirmation:
- generate a ticket reference or QR payload
- send the ticket by email when email delivery is enabled
- include attendee name, ticket ID, event details, and QR code
- store a record of email delivery state for retries or support follow-up
- always expose the ticket as a PDF from the booking lookup, so the attendee can
  download it without email

If email sending fails, the booking should be flagged for retry or manual recovery instead of silently disappearing from the system. A deployment that does not send email sets `EMAIL_DELIVERY_ENABLED=false`: no delivery record is written and the retry job stays idle, while the booking lookup remains the ticket delivery path.

## 7. Payment Integration Details

### 7.1 AzamPesa
Implementation should use the AzamPesa API with:
- payment initiation endpoint
- callback webhook endpoint
- payment reference tracking
- signature or token verification for inbound webhook authenticity

The webhook must validate request authenticity before changing any booking state.

### 7.2 USDT on BEP20
The crypto payment path should use the BEP20 network and a fixed amount of 12 USDT per ticket.

Implementation requirements:
- known receiving wallet address
- blockchain polling or event monitoring
- exact amount validation
- minimum confirmation threshold before confirming payment
- strict source/destination address verification

This should never trust a frontend-only claim that a transaction was sent.

### 7.3 Lipa Namba
The offline payment path accepts a payer-uploaded receipt and requires an admin decision before the payment can confirm.

Implementation requirements:
- `POST /api/payments/:id/lipanamba-receipt` accepts one multipart file in the `receipt` field plus the booking reference in `booking_ref`
- the backend checks the file signature, not only the declared MIME type
- receipts are stored under `backend/out/offline-payment-receipts` with generated file names and SHA-256 hashes
- the public API never serves the receipt file directly
- `GET /api/admin/bookings/:id/offline-receipt` is behind admin authentication and streams the receipt for review
- a re-upload replaces the current receipt and returns it to `submitted`
- the admin reviews the uploaded receipt inline on the booking detail page; no download is required
- `POST /api/admin/bookings/:id/confirm` is the single final step: it confirms the seat, marks the payment as received, approves the receipt and triggers ticket delivery
- the admin UI never confirms a payment separately from confirming the booking

### 7.4 Fixed-rate decision
The PRD states that crypto pricing is fixed at 12 USDT, not a live converted amount. The implementation should support this as a business rule and document how the amount is updated if market conditions change before launch.

This is an operational rule and should be reviewed before production release.

## 8. Validation and Quality Rules

All user input should be validated before writing to the database or connecting to third-party systems.

### Required validation
- full name must be present and not empty
- email format must be valid
- phone number format must be valid for Tanzanian mobile numbers or at minimum match expected pattern
- payment amount must match the configured event rate
- only valid payment methods are accepted

Use Joi or equivalent validation before database writes.

## 9. Security Requirements

Security is especially important because the system handles personal data and payment state.

### 9.1 Secrets
- store database credentials in environment variables
- store AzamPesa credentials in environment variables
- store ticket email provider credentials in environment variables
- store wallet configuration in environment variables
- never commit secrets to source control

### 9.2 Webhook safety
All webhook handlers should verify:
- source authenticity
- expected payload structure
- request signature or secret if the provider supports it

### 9.3 Payment integrity
Never mark a booking as paid based on unchecked client-side input.

### 9.4 Data retention
The PRD states attendee data should be retained indefinitely. The implementation should therefore avoid automatic deletion logic unless required by future policy changes.

## 10. Deployment Plan

For a first release, deployment should be structured as a Next.js application with a managed production build.

- deploy the Next.js app to a VPS or hosting provider that supports Node.js
- expose only the required public HTTP/HTTPS routes for the booking flow
- run PostgreSQL on the same host or a managed service if easier
- use Next.js API routes or a dedicated backend service for booking and payment endpoints
- enable TLS for secure access
- manage environment variables centrally and securely

This project does not require a large-scale microservice system. A Next.js app is a suitable fit for the requirement because it supports a public mobile-first frontend, server routes, and secure API handling in one project.

## 11. Risks and Open Questions

The PRD still leaves a few decisions unresolved. These items should be confirmed before production launch:

- final event date
- exact support/contact mechanism for the help placeholder
- ticket check-in method for venue staff
- procedure for handling underpaid or delayed USDT payments
- duplicate booking policy
- whether the 12 USDT rate needs periodic review before the event

Until these are confirmed, the engineering team should implement the safest default behavior: accept one valid booking per user session, mark incomplete holds as expired after 15 minutes, and require explicit server-side verification for every payment.

## 12. Delivery Priorities

The audit in Section 3.5 identified that the repository is a backend foundation with several blockers. The build order below has been adjusted to a **backend-first** sequence: Phase 0 (stabilize) must finish before the booking flow can work reliably, and the frontend work is deferred until the backend API is sound.

### Phase 0: Backend stabilization (blockers, prerequisite for everything else)
- Fix `config/schema.sql` (duplicate `CREATE TYPE`, enum alignment, add `email`, 15-minute hold) and rebuild the `masterclass` database so code, DB, and PRD agree.
- Add all required runtime dependencies to `package.json` and install them inside the project: `express`, `cors`, `pg`, `bcrypt`, `jsonwebtoken`, `nodemailer`, `qrcode` (keep `dotenv`, `ethers`, `joi`, `nodemon`).
- Convert `middleware/errorHandler.js` from CommonJS to ESM.
- Put `.env` in `.gitignore` and remove the tracked `.env` from version control; keep all secrets out of the repo.
- Implement the core `services/bookingService.js` and `services/paymentService.js` (currently empty stubs).

### Phase 1: Core booking flow
- booking creation endpoint with validation (name, email, phone)
- seat-cap check with `FOR UPDATE` row lock under a transaction
- temporary hold reservation and 15-minute hold expiry logic (expired holds retained, not deleted)
- payment selection / session endpoint (availability + sold-out status)

### Phase 2: Payment handling
- AzamPesa STK integration (initiation + authenticated callback webhook)
- USDT/BEP20 confirmation logic via ethers (exact 12 USDT, receiving wallet, confirmation threshold, source/destination checks)
- secure payment callback handling
- payment status update endpoints

### Phase 3: Ticketing and reliability
- email ticket generation (Nodemailer)
- QR code creation (qrcode)
- confirmation retry / re-delivery logic
- sold-out handling

### Phase 4: Frontend and launch readiness
- Next.js public app: homepage, booking, payment, success pages
- language switcher (English/Swahili), mobile-first
- deployment config, monitoring and logs, support placeholder
- final QA for mobile flow and payment edges

## 13. Final Implementation Guidance

The implementation should remain aligned to the PRD rather than adding unnecessary complexity. The product is a mobile-first, public event booking flow with a fixed price, a hard seat cap, and a simple but reliable payment process. For this project, correctness and clarity matter more than feature breadth.

The best path forward is to first stabilize the existing Express + PostgreSQL backend — resolve the schema/dependency blockers recorded in Section 3.5, enforce the 15-minute hold and 300-seat cap correctly in `bookingService.js`, and implement payment verification in `paymentService.js` — then build the Next.js frontend and remaining integrations on top of that foundation without expanding beyond the event requirements.
