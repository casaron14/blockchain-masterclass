# Blockchain Masterclass — Backend Handover

> **Deployment update.** The production target is Vercel plus a managed
> PostgreSQL instance. Read `../DEPLOYMENT.md` first: it defines the single
> Vercel project (the Next.js app serves `/api/*` through
> `frontend/pages/api/[...all].js`), the serverless constraints (no in-process
> jobs, in-memory PDF storage), the cron endpoint and the required environment
> variables.
>
> **Payments update.** Only Lipa Namba (offline, admin-reviewed) is sold.
> AzamPesa STK push is advertised as "Instant Payment — coming soon" and
> `AZAMPESA_PAYMENTS_ENABLED` stays `false`; USDT/BEP20 is muted in the checkout
> as "coming soon" but its listener, sweep and reconciliation paths are intact so
> older USDT invoices still settle. The AzamPesa service code and admin read
> paths remain so historical rows can be reconciled.

This document records the current state of the backend for the Blockchain Masterclass
booking project. It is intended for any developer (or agent) who picks up this codebase
after the work described below, so they can understand what exists, how it behaves, and
what remains.

> Source of truth for intended architecture: `implementation.md`.
> Behaviour/conventions to follow: `AGENTS.md`.

---

## 1. What is implemented

### Phase 0 — Backend stabilization
- Rebuilt authoritative schema in `config/schema.sql` (11 tables, enums, triggers).
- Recreated the `masterclass` PostgreSQL database from that schema.
- Installed all declared dependencies; the backend is now self-contained.
- Converted the error middleware to ESM (`middleware/errorHandler.js`).
- `.env` is untracked and covered by `.gitignore`; template lives in `.env.example`.

### Phase 1 — Core booking flow (public, no login required)
- `POST /book` — create a booking with a 60-minute seat hold (Joi validated).
- `GET /book/availability` — live seat availability snapshot.
- `POST /book/:id/confirm` — confirm a booking within the 300-seat cap using
  `FOR UPDATE` row locking to prevent overselling.
- `POST /book/expire-holds` — revoke all expired seat holds (releases capacity).
- `GET /book/ref/:ref` and `GET /book/:id` — lookup bookings.
- `POST /api/payments` and `PUT /api/payments/:id` — create / update payment records.

### Phase 2 (part 1) — AzamPesa mobile-money payment
- `services/azamPayClient.js` — AzamPay gateway client (token, STK push, Tanzanian
  phone formatting `2557XXXXXXXX`).
- `paymentService.js` extended: initiate AzamPesa payment, process the webhook
  (idempotent, verifies the paid amount = 30,000 TZS), store the inbound webhook,
  record the transaction, reject expired holds, and map payment status to booking.
- `controller/azamPayWebhookController.js` + `api/azamPayWebhookRouter.js`.
- Webhook mounted at `/webhook/azampay` in `server.js`.
- Verified end-to-end against a local AzamPay stub (full HTTP happy path).

### Phase 2 (part 2) — USDT on BEP20 on-chain verification
- `services/usdtPaymentService.js` — reads USDT BEP20 `Transfer` events from a
  transaction receipt for the configured contract
  (`parseAllUsdtTransfersFromReceipt` returns every matching log, because one
  transaction can pay several addresses).
- `services/usdtPaymentClaimService.js` — `verifyClaimedUsdtTransferForBooking`
  is the manual, transaction-hash-driven path:
  - It resolves the receipt to *this* booking's deposit address (active or
    superseded), records the transfer in `deposits_observed`, and then hands the
    decision to `confirmUsdtOrderPaymentFromObservedDeposits` — the same
    settlement function the listener uses.
  - Finality, amount, seat capacity, receipt issuance and review flags are
    therefore decided by one code path. A hash that pays an unrelated address is
    reported as `TRANSFER_NOT_FOR_THIS_BOOKING` and never marks the payment failed;
    it simply is not this booking's payment.
  - The chain reads and the delivery callbacks are dependency-injectable for
    testing.
- Endpoints wired in `controller/paymentController.js` + `api/paymentRouter.js`:
  - `POST /api/payments/:id/initiate-usdt` — returns the order's deposit address and
    the expected amount the customer should pay.
  - `POST /api/payments/:id/verify-usdt` — body `{ "tx_hash": "0x..." }`; records the
    transfer and confirms the payment + booking once the settlement rules allow it.
- Config added to `.env` / `.env.example`: `USDT_RECEIVING_WALLET`,
  `USDT_CONTRACT_ADDRESS`, `BSC_RPC_URL` (optional override), plus the settlement
  settings (`SETTLEMENT_FINALITY_MODE`, `SETTLEMENT_MIN_CONFIRMATIONS`).

### Phase 3 — Ticketing and reliability
- `services/ticketDeliveryService.js` — ticket generation and email delivery:
  - `buildTicketQrPayload` / `renderTicketQrDataUrl` build a JSON QR payload
    (ticket id, booking ref, attendee name, event details) and render a PNG data URL
    via the `qrcode` package.
  - `sendTicketEmailToAttendee` composes an HTML ticket email (attendee, ticket id,
    event details, inline QR) and sends via Nodemailer (SMTP configured from env;
    defaults target a local MailHog on port 1025).
  - `deliverTicketForConfirmedBooking(bookingId, sendTicketEmail?)` — only delivers
    for `confirmed` bookings; upserts a `ticket_deliveries` row and, on success, marks
    it `sent` (records `sent_at`), or on failure marks it `failed` with the error and
    increments `attempt_count`. Never throws on a send failure — it records it for
    retry. The sender is injectable for deterministic tests; default is real Nodemailer.
  - `redeliverFailedTicketEmail(bookingId, ...)` — retries a previously failed delivery
    (flips `failed` → `sent`).
- Wired into both confirmation flows so a ticket is generated right after a seat is
  confirmed and paid:
  - `processAzamPayWebhook` (AzamPesa success) calls `deliverTicketForConfirmedBooking`.
  - `confirmUsdtOrderPaymentFromObservedDeposits` (USDT, used by both the listener
    and `verify-usdt`) calls the same.
  - Both accept an optional injectable delivery function so tests stay hermetic.
- `controller/ticketController.js` + `api/ticketRouter.js`, mounted in `server.js`:
  - `POST /api/tickets/redeliver/:bookingId` — re-sends the ticket email for a
    confirmed booking (404 if unknown, 502 if the send fails, redelivery recorded).
- Config added to `.env` / `.env.example`: `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`,
  `MAIL_PASS`, `MAIL_FROM`, `EVENT_TITLE`, `EVENT_DATE`, `EVENT_LOCATION`.

### Phase 4b — Multi-event contract (`GET /events/:slug`)
- `services/eventConfigService.js` holds the single-event catalogue in the shape
  documented in `implementation.md` §3.6.1 (`event`, `price`, `contact`,
  `paymentMethods`) and `fetchEventConfigurationBySlug(slug)` (returns `null` for
  unknown slugs).
- `controller/eventController.js` + `api/eventRouter.js`, mounted at `/events` in
  `server.js`: `GET /events/:slug` returns the config, `404` for unknown slugs so
  the frontend can fall back to `defaultEventConfig`.
- Frontend `lib/eventConfig.js` now parses the documented nested contract shape
  (with flat-key fallback) and normalizes `paymentMethods` (string or object) into
  `{ key, labelKey }` options used by `BookingForm`.

### Phase 4 — Frontend and launch readiness
A Next.js 15 (App Router) public app lives in the **repo root** (`/home/xiv/Desktop/Diena/Blockchain Masterclass/`), independent of the Express backend in `backend/`.

- `package.json` (next 15.2.4, react 19.1.0), `next.config.mjs`, `jsconfig.json`
  (path alias `@/*`).
- `app/` pages:
  - `/` — homepage: event summary, live seat availability banner, "Book now" CTA.
  - `/book` — two-step booking: `BookingForm` (name, email, phone; matches the
    backend Joi rules) → `PaymentMethodSelector` (AzamPesa / USDT BEP20) → creates
    the payment record and navigates to `/pay/:paymentId`.
  - `/pay/[paymentId]` — `PaymentFlow`: AzamPesa (initiate payment) or USDT
    (shows receiving wallet + 12 USDT instructions, transaction-hash input,
    `verify-usdt` call). The page does not poll: it tells the attendee the
    ticket will be emailed within one hour.
  - `/success/[ref]` — `SuccessCard`: booking reference, attendee, ticket-email note,
    and a support placeholder.
- `components/`: `Header`, `Footer` (support email placeholder), `LanguageSwitcher`,
  `EventSummary`, `SeatAvailabilityBanner`, `BookingForm`, `PaymentMethodSelector`,
  `PaymentFlow`, `SuccessCard`.
- `context/LanguageContext.jsx` — EN/Swahili switcher (localStorage-persisted),
  hydration-safe (defaults to EN on first render, applies stored language in an
  effect). Dictionary and `translate` helper in `lib/translations.js`.
- `lib/api.js` — typed client for the backend endpoints; base URL from
  `NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:3001`); correctly unwraps
  `{ payment: ... }` responses.
- Mobile-first CSS in `app/globals.css` (no UI framework, CSS variables).
- Design system (applied via `frontend-design` skill): deep navy background (`#0B1120`), amber-gold accent (`#E8913A`), coral for urgency (`#FF6F61`), seafoam for success (`#16A085`), warm sand for text (`#F2E8DC`). Typography: Outfit (display/headings, 800/700/600) and DM Sans (body, 400/500) loaded via Google Fonts `<link>` (runtime load, fallback to system-ui). Signature element: a progress bar on the homepage showing seats filled (0→300) in amber-gold with coral when ≥80% full. Includes `focus-visible` outlines, `prefers-reduced-motion`, and `::selection` styling.
- Deployment config: `Dockerfile` + `.dockerignore` at the root (Next.js, multi-stage,
  `NEXT_PUBLIC_API_BASE_URL` build arg) and `backend/Dockerfile` + `.dockerignore`
  (Express API). Docker images not built locally (daemon unavailable in this env),
  but they follow standard multi-stage patterns. `.env.local.example` documents the
  one frontend env var.
- The backend already enables CORS (`app.use(cors())`), so the browser can call it
  from a different origin/port.

### Phase 5 — USDT BEP20 on-chain collection (per-order derived deposit addresses)
Implements the "USDT collection gateway" described in `blockchain.md`: instead of a
single shared receiving wallet, every booking gets its own deterministic BIP44
deposit address derived from an **account xpub** (no spending key on the server),
a monitor watches for qualifying transfers, and a fund-then-sweep flow moves USDT
into a treasury wallet.

- **Schema** (`config/schema.sql`): new `orders`, `deposit_addresses`,
  `deposits_observed`, `sweeps`, `treasury_ledger` tables + `order_status` /
  `sweep_status` enums + `customer_derivation_seq` monotonic sequence. Applied
  live to the `masterclass` database.
- **`services/rpcEndpointResolver.js`** — single source of truth for RPC selection:
  `resolveBscRpcUrl()` prefers `BSC_RPC_URL`, else the first public endpoint for
  the network implied by `ALCHEMY_RPC_URL` (testnet-looking or mainnet).
  `resolvePublicBscRpcUrlCandidates()` builds the ordered failover list used by
  the listener (`BSC_RPC_URL` → `BSC_RPC_URL_FALLBACK_URLS` → built-in public
  endpoints). Binance's own seed endpoints are deliberately excluded because they
  reject `eth_getLogs`. This guarantees verify/sweep/gas-wallet and the listener
  all point at the **same network** by default.
- **`services/depositAddressDerivationService.js`** — the online derivation
  boundary. In production it derives `xpub.deriveChild(index)` from
  `WALLET_ACCOUNT_XPUB` (the external-chain node `m/44'/60'/0'/0`), so the API
  process holds public material only. Without an xpub it falls back to the
  mnemonic **only outside production**; `config/productionSigningGuard.js`
  refuses to boot a live server that still has `WALLET_MNEMONIC`.
- **`services/signingService.js`** — offline signing boundary. It lazily loads
  the mnemonic, derives `m/44'/60'/0'/0/{index}` and signs prepared transactions.
  Only the offline signing machine and the development/test sweep path import it.
- **`services/orderService.js`** — `createOrderWithDepositAddressForBooking`
  (transactional: allocates a never-reused sequence index, inserts the order +
  derived address), `reissueDepositAddressForOrder` (a fresh address for a lapsed
  unpaid hold, superseding rather than deleting the previous one), the fetch
  functions, `updateOrderStatus`, `revokeExpiredOrderHolds`,
  `fetchWatchableDepositAddressRecords` / `fetchConfirmableDepositAddressRecords`
  (the listener's watch set — includes `expired` orders and superseded addresses),
  `fetchPaidOrdersAwaitingSweep`, `OrderAlreadyExistsError`.
- **`controller/paymentController.js`** — `POST /api/payments/:id/initiate-usdt`
  creates an order + derived deposit address, reuses the active one while the hold
  is live, and issues a **fresh** address when the hold lapsed unpaid
  (`holdRenewed: true`); it returns `receivingWallet`, `expectedAmountUsdt`,
  `orderId` instead of the single shared wallet, and `409`s when money was
  already seen on the current address. `GET /api/payments/:id` returns a
  `settlement` summary so the client can follow progress without submitting a
  hash. `verify-usdt` is the manual fallback: it records the transfer and lets the
  shared settlement path decide whether the payment is complete.
- **`services/usdtPaymentService.js`** — `USDT_BEP20_ABI` extended with `balanceOf`
  and `transfer`; `getTreasuryWalletAddress()`;
  `confirmUsdtOrderPaymentFromObservedDeposits` is the single settlement function
  used by both the listener and `verify-usdt`. It confirms the seat within capacity
  and marks the order `paid` on success.
- **`services/usdtPaymentClaimService.js`** — `verifyClaimedUsdtTransferForBooking`
  turns a payer-supplied hash into an observed deposit for the booking's own
  deposit address, then delegates to the settlement function above. It never marks
  a payment failed; an unrelated or unknown transaction is reported as a pending
  reason. Tests: `tests/usdtPaymentClaimService.test.js`.
- **`services/monitorService.js`** — the payment listener. `runUsdtTransferListenerTick`
  reads the settlement frontier once, reads the token's `Transfer` logs for the
  whole scan window in ONE `eth_getLogs`, attributes them to deposit addresses in
  SQL, records new transfers into `deposits_observed`, drops deposits a reorg
  invalidated, and then settles each complete order in its own transaction.
  **Incremental scans:** the cursor is one global row
  (`usdt_transfer_scan_state`), not one per address; it is a high-water mark
  re-read with `MONITOR_SCAN_OVERLAP_BLOCKS` of overlap, and `tx_hash` de-dup
  makes a re-read harmless. A failed scan leaves the cursor untouched so the next
  tick retries the same window. All chain calls are dependency-injectable so
  tests are hermetic. **See 9e for the full tick sequence and the operator view.**
- **`services/gasWalletService.js`** — gas wallet signing/balances, BNB fee
  estimation (`computeSweepGasFeeWei` with buffer, `computeBumpedGasPriceWei`),
  funding `BNB` from the gas wallet to a deposit address, and USDT/BNB balance
  reads.
- **`services/sweepService.js`** — the shared preparation half plus the
  development/test in-process sweep. `sweepSingleOrder`: a confirmed payment that
  settled longer ago than `SWEEP_MINIMUM_AGE_HOURS` is collectable (the
  `SWEEP_MIN_THRESHOLD_USDT` threshold only guards *premature* collection), a
  `pending` sweep record is created, BNB is topped up in the deposit address up
  to the estimated fee, the USDT `transfer` to the treasury is signed +
  broadcast, and the sweep + `treasury_ledger` entry + order transition are
  written in one transaction (`completeSweepRecordWithTreasuryMovement`, ledger
  keyed on `tx_hash`). **Gas-price bump retry:** the nonce is read once, each
  attempt bumps the gas price by `SWEEP_GAS_PRICE_BUMP_PERCENT`, and the receipt
  is checked before retrying (`broadcastSweepTransactionWithGasBumpRetry`). The
  broadcast hash is persisted before waiting, so a crash is repaired by
  `recoverUnfinishedSweepForOrder` from the mined receipt instead of a second
  transfer. `runSweepCycle` loops the eligible orders, refuses funding that
  exceeds the sponsorship budget, marks failures with `failure_reason`, alerts via
  Telegram, and finalizes completed sweeps against the listener's settlement
  frontier. `jobs/sweepJob.js` gates the pass to once per `SWEEP_INTERVAL_HOURS`,
  using the newest `sweeps` row as the durable last-run timestamp so a restart
  cannot collect twice in one window. `prepareSweepRecordWithFundedGas` is the
  shared first half (recover/abandon, readiness, sweep row, gas funding) used by
  both this path and the offline flow.
- **`services/sweepBatchPreparationService.js`** — online prepare step for
  production. It runs the shared preparation for every settled order, builds one
  unsigned USDT transfer per gas-price attempt (same nonce), and returns a JSON
  batch. Nothing is broadcast and the deposit seed is not used.
- **`services/offlineSweepSigningService.js`** — air-gapped sign step. It checks
  each unsigned attempt against the batch (USDT contract, treasury, amount,
  chain, nonce, gas price) and the derived key against the deposit address, then
  signs the whole retry ladder. It never touches the database or the network.
- **`services/sweepBatchSubmissionService.js`** — online submit step. It
  validates the whole signed batch against `sweeps` before broadcasting anything
  (including recovering the signer and checking it equals the deposit address),
  rejects stale nonces, broadcasts with the same nonce and receipt-first retry
  semantics, and completes the sweep + ledger atomically. Re-submitting a
  completed batch is a no-op.
- **`services/gasSponsorshipPolicyService.js`** — bounds what the hot gas wallet
  can spend: `GAS_SPONSORSHIP_MAX_BNB_PER_SWEEP`, `..._PER_CYCLE`,
  `..._PER_DAY` and `GAS_SPONSORSHIP_SPEND_WINDOW_HOURS`. Spent BNB is summed
  from the exact `sweeps.bnb_funded_wei` (the `NUMERIC(14,2)` `bnb_funded`
  column cannot represent ~0.0005 BNB). A refused sweep is marked failed and
  alerted, never funded.
- **`services/listenerHealthService.js`** + `jobs/listenerHealthCheckJob.js` —
  alerts when the payment listener has not completed a scan for
  `MONITOR_STALL_ALERT_POLL_INTERVALS` poll intervals or has
  `MONITOR_STALL_ALERT_FAILURE_LIMIT` consecutive failures, using the durable
  `usdt_transfer_scan_state` row. A stall episode alerts once and is re-sent at
  most every `MONITOR_STALL_ALERT_REALERT_MS`; recovery resets it.
- **`services/reconciliationService.js`** — daily cross-check of
  `deposits_observed` vs `treasury_ledger` vs the on-chain treasury USDT balance
  (`runReconciliationCheck`), with every run persisted to `reconciliation_runs`
  (`balanced` / `mismatch` / `failed`, the three totals, `mismatch_usdt` and the
  full detail blob), plus `generateAdminSummaryReport`.
- **`services/telegramAlertService.js`** — webhook alerts for sweep failures,
  reconciliation mismatches and low gas-wallet balance.
- **`jobs/`** — `paymentMonitorJob`, `listenerHealthCheckJob`, `expireOrdersJob`,
  `expireSeatHoldsJob`, `sweepJob`, `reconciliationJob`, `gasWalletMonitorJob`,
  `ticketDeliveryRetryJob` + `index.js` runner. Started in
  `server.js` only when `ENABLE_JOBS=true`. Each job can be toggled via its own
  `ENABLE_<NAME>_JOB` flag and has an interval from env.
- **Admin visibility** — `controller/adminController.js` + `api/adminRouter.js`
  `GET /api/admin/report` (pending/paid/awaiting-sweep counts, gas wallet + USDT
  treasury balances) and `scripts/adminReport.js` (`npm run report`) for the CLI.

---

## 1b. Project layout after Phase 4

```
/home/xiv/Desktop/Diena/Blockchain Masterclass/
├── app/                  # Next.js App Router pages (/, /book, /pay/[paymentId], /success/[ref])
├── components/           # React client components
├── context/              # LanguageContext (EN/SW)
├── lib/                  # api.js + translations.js
├── next.config.mjs, jsconfig.json, package.json, package-lock.json, Dockerfile
└── backend/              # Express + PostgreSQL API (Phases 0-5)
    ├── api/, controller/, services/, middleware/, utils/, config/
    ├── jobs/             # background workers (monitor, sweep, expiry, reconcile, gas)
    ├── scripts/          # adminReport.js CLI
    ├── tests/            # 52 passing
    └── Dockerfile, handover.md, implementation.md, BlockchainMasterClass.md, blockchain.md
```

## 2. Payment methods supported

| Method        | Type     | Flow                                                                |
| ------------- | -------- | ------------------------------------------------------------------- |
| `azampesa`    | Mobile   | User pays via AzamPay; server validates amount (30,000 TZS) in webhook |
| `usdt_bep20`  | Crypto   | User transfers the ticket price on BEP20 (3.8 USDT from `shared/eventConfig.js`) to their per-order derived address; the listener settles it automatically from the finalized block and the funds are swept to treasury daily |

Both confirmations confirm the booking seat under the 300-seat cap only after the
payment is verified server-side. Frontend-only claims are never trusted. After a
USDT order is paid, `runSweepCycle` funds the deposit address with BNB and moves
the USDT balance to the treasury wallet, recording each move in `treasury_ledger`.

---

## 3. Shared error class
`PaymentNotFoundError` is defined in `services/paymentService.js` and imported by
`controller/paymentController.js`, where it is used across the payment endpoints
(including the USDT initiate/verify paths).

`OrderAlreadyExistsError` is defined in `services/orderService.js` and mapped to a
`409` in `initiateUsdtPaymentEndpoint` when a booking already has an active order.

---

## 4. Configuration

All environment variables are in `.env` (untracked) with documented placeholders in
`.env.example`:

- `PORT`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_DATABASE`, `DB_PORT`
- `JWT_SECRET`, `JWT_EXPIRES_IN`
- `WALLET_ACCOUNT_XPUB` — **required in production**. The xpub of the
  external-chain account node `m/44'/60'/0'/0`; deposit addresses are its child
  addresses. The server cannot spend from it.
- `WALLET_MNEMONIC` — development/test and the offline signing machine only. The
  production startup guard refuses to boot while it is set; see 9e.8.
- `CHAIN_ID` (56 mainnet / 97 testnet; drives the receipt chain id and the
  explorer links), `BSC_EXPLORER_URL` (optional override)
- `USDT_RECEIVING_WALLET` (fallback only), `USDT_CONTRACT_ADDRESS`,
  `BSC_RPC_URL`, `BSC_RPC_URL_FALLBACK_URLS`
  (`USDT_EXPECTED_AMOUNT` was removed: the expected price is stored on
  `payments.amount_expected` from `shared/eventConfig.js`)
- Automatic settlement and listener (see 9e):
  - `SETTLEMENT_FINALITY_MODE=finalized` (`depth` is the local-node fallback),
    `SETTLEMENT_MIN_CONFIRMATIONS=15`
  - `UNDERPAYMENT_GRACE_PERIOD_MINUTES=0`
  - `MONITOR_SCAN_OVERLAP_BLOCKS=5`,
    `MONITOR_INITIAL_SCAN_LOOKBACK_BLOCKS=2000`,
    `MONITOR_LOG_SCAN_CHUNK_BLOCKS=0`
  - **No `ALCHEMY_*` value and no `MONITOR_TRANSFER_STRATEGY` is required or read
    by the payment path any more**; the listener uses `eth_getLogs` only.
- Phase 5 collection:
  - `GAS_WALLET_PRIVATE_KEY` — hot wallet that tops up deposit addresses with BNB
    for sweep fees
  - `TREASURY_WALLET_ADDRESS` — destination of every swept USDT balance
  - `SWEEP_MIN_THRESHOLD_USDT=10`, `SWEEP_ESTIMATED_GAS_UNITS=65000`,
    `SWEEP_GAS_BUFFER_PERCENT=20`, `SWEEP_MAX_RETRIES=2`,
    `SWEEP_GAS_PRICE_BUMP_PERCENT=20`
  - `SWEEP_INTERVAL_HOURS=24` and `SWEEP_MINIMUM_AGE_HOURS=24` — collection is
    daily by design, never immediate (see 9e.6)
  - sponsorship budget: `GAS_SPONSORSHIP_MAX_BNB_PER_SWEEP=0.005`,
    `GAS_SPONSORSHIP_MAX_BNB_PER_CYCLE=0.05`,
    `GAS_SPONSORSHIP_MAX_BNB_PER_DAY=0.2`,
    `GAS_SPONSORSHIP_SPEND_WINDOW_HOURS=24`
  - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`,
    `GAS_WALLET_LOW_BALANCE_ALERT_THRESHOLD_BNB=0.1`
  - `ENABLE_JOBS=false` master switch + per-job `ENABLE_PAYMENT_MONITOR_JOB`,
    `ENABLE_LISTENER_HEALTH_JOB`, `ENABLE_SEAT_HOLDS_JOB`,
    `ENABLE_ORDER_EXPIRY_JOB`, `ENABLE_SWEEP_JOB`,
    `ENABLE_RECONCILIATION_JOB`, `ENABLE_GAS_WALLET_MONITOR_JOB`,
    `ENABLE_TICKET_DELIVERY_RETRY_JOB`
  - interval tuning: `MONITOR_POLL_INTERVAL_MS` (5000),
    `LISTENER_HEALTH_CHECK_INTERVAL_MS`,
    `MONITOR_STALL_ALERT_POLL_INTERVALS`, `MONITOR_STALL_ALERT_FAILURE_LIMIT`,
    `MONITOR_STALL_ALERT_REALERT_MS`,
    `ORDER_EXPIRY_INTERVAL_MS`, `SWEEP_POLL_INTERVAL_MS`,
    `RECONCILIATION_INTERVAL_MS`, `GAS_WALLET_MONITOR_INTERVAL_MS`,
    `SEAT_HOLDS_INTERVAL_MS`, `TICKET_DELIVERY_RETRY_INTERVAL_MS`
  - `TICKET_DELIVERY_MAX_ATTEMPTS=5`
- `AZAMPAY_MODE`, `AZAMPAY_APP_NAME`, `AZAMPAY_CLIENT_ID`, `AZAMPAY_CLIENT_SECRET`
  (plus optional `AZAMPAY_AUTH_BASE_URL`, `AZAMPAY_CHECKOUT_BASE_URL` overrides)
- `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASS`, `MAIL_FROM`
- Event title/date/location/prices/capacity live in `shared/eventConfig.js`, not
  in the environment (`EVENT_TITLE` / `EVENT_DATE` / `EVENT_LOCATION` were removed)

> The deposit-address derivation uses `WALLET_ACCOUNT_XPUB` on the server (the
> BSC mainnet is the default). `GAS_WALLET_PRIVATE_KEY` and
> `TREASURY_WALLET_ADDRESS` are required to actually send sweeps. In production
> set `ENABLE_SWEEP_JOB=false` and collect through the offline flow in 9e.8; the
> startup guard rejects `ENABLE_SWEEP_JOB=true` because that job signs in-process.

Frontend (repo root, separate npm project, `.env.local`):
- `NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:3001`) — see `.env.local.example`.

> Note: `.env` historical commits contain secrets; history has not been rewritten
> (destructive — ask the repo owner before doing so).

---

## 5. Database schema

See `config/schema.sql` for the authoritative definition. Key enums:
- `payment_method`: `azampesa`, `usdt_bep20`, `lipanamba`
- `payment_status`: `initiating`, `pending`, `confirmed`, `failed`, `expired`
- `booking_status`: `pending`, `confirmed`, `cancelled`, `expired`
- `delivery_status`: `pending`, `sent`, `failed`
- `order_status`: `pending`, `paid`, `expired`, `swept` (Phase 5 collection order)
- `sweep_status`: `pending`, `funded`, `swept`, `failed`
- `receipt_status`: `pending`, `issued`, `failed`

Tables include `bookings`, `payments`, `users`, `seat_capacity` (with confirmed-count
trigger), `azampesa_transactions`, `blockchain_transactions`,
`blockchain_transaction_errors`, `blockchain_transaction_webhooks`,
`ticket_deliveries`, and `offline_payment_receipts` (Lipa Namba receipt metadata,
review status, and SHA-256).

Phase 5 collection tables:
- `customer_derivation_seq` — monotonic sequence backing `orders.customer_id`; the
  index is **never reused**, even if the owning order later expires unpaid.
- `orders` — one row per USDT collection; `customer_id` is the BIP44 index,
  `booking_id` FK, `amount_usdt`, `status`, `expires_at` (60-min default).
- `deposit_addresses` — `id` PK (surrogate, so one order can hold **several**
  addresses over its lifetime), `order_id` FK, `derivation_index` UNIQUE, derived
  `address` UNIQUE, `is_active` + `superseded_at` (partial unique index allows
  only one active address per order), `last_observed_at`. Superseded addresses
  stay scannable so a late payment to one is still attributed (see 9e.5).
- `deposits_observed` — every qualifying on-chain transfer seen by the listener
  (`tx_hash` UNIQUE, `amount` plus exact `amount_wei`, `block_number`,
  `block_hash` for the reorg guard, `confirmations`, `is_finalized` /
  `finality_confirmed_at` / `finalized_block_number`, `order_id` FK).
- `sweeps` — fund-then-sweep lifecycle (`status` pending → funded → swept/failed,
  `amount`, `amount_wei`, `block_number`, `block_hash`, `bnb_funded`, `gas_used`,
  `treasury_address`, `triggered_by`, `confirmed_at`, `failure_reason`). A
  success row with a `tx_hash` is evidence that money left the address (9e.6).
- `treasury_ledger` — audited record of every swept amount landing in the treasury
  wallet (`tx_hash` UNIQUE, `sweep_id` FK).

Automatic-confirmation tables (see 9e):
- `usdt_transfer_scan_state` — single-row global cursor for the listener
  (`last_scanned_block`, `last_finalized_block`, `last_scanned_at`, `last_error`,
  `consecutive_failures`). One row, not one per order, because a tick reads the
  token contract once and attributes the transfers in SQL.
- `payment_receipts` — the receipt an attendee gets (`payment_id` UNIQUE, booking /
  order / deposit address / payer, `tx_hash`, `block_number` + `block_hash`,
  `amount_paid` + exact `amount_wei`, a snapshot of `finalized_block_number` and
  `confirmations_at_issue`, `explorer_tx_url`, `pdf_path` + `pdf_sha256`, and a
  `receipt_status` of pending/issued/failed with `attempt_count` / `last_error`).
  The row is written **inside** the confirmation transaction; the PDF and the email
  happen afterwards.
- `payment_review_flags` — money that arrived but cannot be auto-settled, with a
  `payment_review_reason` enum (`hold_expired_no_seat`, `hold_expired_with_seat`,
  `overpayment`, `underpayment_after_window`, `swept_before_confirmation`),
  `details` JSONB, `auto_action`, `resolved_at` / `resolution_note`, and a unique
  index on `(COALESCE(tx_hash, deposit_address), reason)`.
- `reconciliation_runs` — durable history of every reconciliation pass
  (`status` balanced/mismatch/failed, `observed_total`, `ledger_total`,
  `onchain_treasury_total`, `mismatch_usdt`, full `details` blob).

---

## 6. How to run

```bash
npm install
cp .env.example .env   # then fill in real values
npm run dev            # nodemon server.js (development)
npm start              # production: sets NODE_ENV=production, so the signing guard runs
npm test               # node --test --test-concurrency=1 --test-force-exit
npm run report         # print the admin summary report (uses config/schema.sql DB)
```

The server boots on `PORT` (default 3001), connects to the DB, and mounts all routes.
Background jobs (monitor, sweep, expiry, reconciliation, gas-wallet monitor) only run
when `ENABLE_JOBS=true`; set the individual `ENABLE_*_JOB` flags to control each worker.
Production must keep `ENABLE_SWEEP_JOB=false` and collect through the offline
prepare/sign/submit flow (9e.8); the startup guard enforces this.

Frontend (separate npm project at the repo root):

```bash
cd "/home/xiv/Desktop/Diena/Blockchain Masterclass"
npm install
cp .env.local.example .env.local   # set NEXT_PUBLIC_API_BASE_URL if the API is not on :3001
npm run dev       # dev server on http://localhost:3000
npm run build     # production build
npm run start     # serve the production build
```

Run the backend first so the frontend has an API to call.

---

## 7. Tests

Tests live in `tests/`, use `node:test`, run with `--test-concurrency=1` and
`--test-force-exit`. Each test truncates `bookings CASCADE` and resets
`seat_capacity` in `beforeEach`.

`npm test` is the full suite: **355 tests, 351 pass, 4 skipped, 0 fail** at the
time of writing. The table below describes what each file covers.

| File                          | Covers                                        |
| ----------------------------- | --------------------------------------------- |
| `tests/bookingService.test.js` | Booking creation, hold, seat-cap confirm, expiry |
| `tests/paymentService.test.js` | Payment record creation / status update / AzamPesa initiation |
| `tests/azamPesaPayment.test.js`| AzamPay client + webhook processing           |
| `tests/usdtPaymentClaimService.test.js` | Manual `verify-usdt` claim: wrong address, not finalized, finalized confirmation through settlement, already confirmed, unknown hash |
| `tests/signingService.test.js` | BIP44 path building + development-only mnemonic derivation |
| `tests/depositAddressDerivationService.test.js` | xpub ↔ mnemonic parity, production refusal without an xpub, invalid xpub |
| `tests/productionSigningGuard.test.js` | Production startup: mnemonic refusal, xpub requirement, in-process sweep refusal |
| `tests/sweepBatchOfflineSigning.test.js` | Prepare → sign → submit, idempotent replay, wrong key, tampered amount, stale nonce |
| `tests/orderService.test.js`   | Order + deposit-address creation, uniqueness, monotonic index, status transitions, expiry, awaiting-sweep fetch |
| `tests/monitorService.test.js` | Transfer collection, matching/eligibility, observed-deposit recording, scan window, cumulative deposits |
| `tests/gasSponsorshipPolicyService.test.js` | Per-sweep / per-cycle / per-day BNB caps, refusal reasons, rolling-window spend |
| `tests/listenerHealthService.test.js` | Listener stall thresholds, repeated failures, never-scanned startup, alert de-duplication |
| `tests/sweepService.test.js`   | Threshold check, gas-fee estimate, fund-then-sweep, nonce reuse + receipt-first retry, idempotent completion, crash recovery, sponsorship caps, sweep finality, treasury ledger, sweep-cycle error handling |
| `tests/sweepJob.test.js`       | Daily sweep window: 24 h default, one pass per window, restart safety, minimum-age gate |
| `tests/sweepVerificationService.test.js` | Sweep-record evidence for an ambiguous payment (finality-aware), ambiguous-payment worklist |
| `tests/paymentReceiptService.test.js` | Receipt row written inside the confirmation transaction, delivery + failure + retry states |
| `tests/paymentReceiptPdfService.test.js` | Receipt PDF rendering |
| `tests/ticketDeliveryService.test.js` | QR payload/render, delivery success + failure, redelivery, confirmed-only guard, max attempts |
| `tests/ticketDeliveryRetryJob.test.js` | Retry job for both ticket and receipt deliveries |
| `tests/ticketPdfService.test.js` | Ticket PDF rendering |
| `tests/reconciliationService.test.js` | Ledger-vs-on-chain balance check, admin summary report, persisted `reconciliation_runs` |
| `tests/bscTestnetPaymentFlow.test.js` | **Opt-in live BSC testnet proof** (see 9d); skipped unless `RUN_BSC_TESTNET_INTEGRATION=true` |
| `tests/referrerService.test.js` | Referral/referrer resolution + attribution |
| `tests/eventConfigService.test.js` | Event config lookup by slug, unknown-slug `null`, documented contract shape |
| `tests/rpcEndpointResolver.test.js` | `resolveBscRpcUrl` ↔ `resolveAlchemyBscRpcUrl` network consistency, override preference |

---

## 8. Verified behaviour (manual HTTP)

USDT (`POST /api/payments/:id/...`):
1. `initiate-usdt` creates/reuses a booking order and returns the **per-order
   derived wallet** (`receivingWallet` from the HD chain), `expectedAmountUsdt`,
   plus `orderId` and `holdRenewed`.
2. A second `initiate-usdt` for the same booking returns the same deposit address
   (no duplicate order). After the hold lapsed it returns a **fresh** address with
   `holdRenewed: true`, or `409` when money was already seen on the current one.
3. `verify-usdt` with no `tx_hash` returns `400`.
4. `verify-usdt` with an unreachable blockchain RPC returns `502` cleanly (no crash).
5. `verify-usdt` on a non-existent payment returns `404`.
6. `GET /api/payments/:id` returns a `settlement` block (observed amount/count,
   `isObservedPaymentSettled`, latest observed block, receipt summary) so the pay
   page can show progress without the client submitting a transaction hash. The
   automatic listener is the confirmation path; `verify-usdt` is the manual
   fallback (see 9e).
7. `verify-usdt` with a hash that pays an unrelated address returns
   `confirmed: false, reason: "TRANSFER_NOT_FOR_THIS_BOOKING"` and leaves the
   payment pending; an unknown hash returns `TRANSACTION_NOT_FOUND`. Neither marks
   the payment failed.

Local Anvil end-to-end (verified live):
1. `initiate-usdt` returns the per-order deposit address on the local chain.
2. `local-dev/simulateUsdtPayment.mjs` mints + transfers the ticket price of mock
   USDT to the deposit address.
3. The listener scans `eth_getLogs`, records the deposit, and once the chain has
   settled it confirms payment + booking (`paid`) in one transaction with a
   `payment_receipts` row.
4. The daily sweep funds the deposit with BNB from the gas wallet and moves the
   USDT to the treasury (`treasuryUsdtBalance` reflects it).
- Bug fixed while testing locally: sweep transactions were signed with `chainId: 0`
  (the derived signing wallet has no provider), so Anvil rejected them with
  `invalid chain id for signer`. `buildUnsignedUsdtTransfer` now resolves the
  chain id from the provider (tests pass with a stub provider too).
- Bug fixed while testing locally: `fromBlock: "0"` as a string is rejected by
  ethers `eth_getLogs`; the event-logs strategy now passes a numeric block, and the
  scan start is clamped to `latestBlockNumber` when the persisted cursor exceeds
  the current chain height (fresh Anvil is far behind a real chain).
- Bug fixed while testing locally: two half-price payments to the same deposit
  address never confirmed, because each transfer was evaluated individually
  against the full expected amount. The listener now evaluates the
  **cumulative received amount per order** (exact wei sum over
  `deposits_observed`), settles once the total reaches the expected amount, and
  settles from the observed deposits in one transaction
  (`confirmUsdtOrderPaymentFromObservedDeposits`) instead of a single
  `verify-usdt` receipt check.

Phase 5 admin (`GET /api/admin/report`):
- Returns `treasuryWalletAddress`, `pendingOrderCount`, `paidOrderCount`,
  `ordersAwaitingSweep`, `gasWalletBnbBalance`, `treasuryUsdtBalance`.
- With `GAS_WALLET_PRIVATE_KEY` / `TREASURY_WALLET_ADDRESS` unset, balances come
  back `null` and the report still succeeds (wrapped in try/catch).

Tickets (`POST /api/tickets/redeliver/:bookingId`):
- Confirmed booking, no SMTP server running → returns `502` with the real reason
  (`connect ECONNREFUSED`), and a `ticket_deliveries` row is recorded as `failed`
  with the QR payload and error stored for later retry.
- Unknown booking → `404`.
- End-to-end: a `processAzamPayWebhook` success (matching `reference_id`) confirms
  the booking + payment and **auto-creates** the `ticket_deliveries` row (status
  `failed` only because no SMTP host is available; `attempt_count`/`last_error`
  recorded). With a real SMTP host this flips to `sent`.

Frontend (Next.js on :3000, backend on :3001):
- `npm run build` succeeds; routes statically/dynamically generate as expected
  (`/` and `/book` static, `/pay/[paymentId]` and `/success/[ref]` dynamic).
- Pages return `200`: `/`, `/book`, `/pay/:id`, `/success/:ref`.
- CORS allows the browser origin (`Access-Control-Allow-Origin: *`).
- Full API chain consumed by the UI verified over HTTP: availability → create
  booking → create payment → `initiate-usdt` (returns receiving wallet + 12 USDT)
  → `verify-usdt` guard (400 without `tx_hash`).
- Hydration-safe language switcher (client reads localStorage only in an effect).

---

## 9. Removed exploratory code

- `controller/blockchainController.js`, `utils/walletCreation.js`, `utils/prompt.js`,
  and `middleware/schemaValidator.js` were unused, and the first two read a private
  key interactively, hardcoded addresses, and would block or hang if imported. They
  have been removed from the repository.
- The USDT verification flow uses the real BEP20 USDT contract address and a
  configurable receiving wallet. No production wallet/seed is committed in the
  codebase (values live in `.env`).

---

## 9b. Local blockchain testing without a testnet (Anvil)

The backend can run the full USDT payment cycle against a **local Anvil** node
(Foundry), no BSC testnet and no RPC API key required. A mock USDT token is
deployed and the listener reads it with standard `eth_getLogs`.

Prerequisites: Foundry (`anvil`, `forge`), PostgreSQL running.

```bash
npm run local:setup   # starts anvil, deploys MockUsdt, writes .env.local
npm run dev           # backend now points at http://127.0.0.1:8545
```

`.env.local` (auto-generated, overrides `.env`, deletable to go back to the real
network) points `BSC_RPC_URL` at the local node, deploys
`USDT_CONTRACT_ADDRESS`, and enables the payment-monitor, sweep and order-expiry
jobs with fast polling. It also still writes the now-ignored
`ALCHEMY_RPC_URL` / `MONITOR_TRANSFER_STRATEGY` lines: there is no transfer
strategy switch any more (see 9e), the listener always uses `eth_getLogs`.

To drive a booking → deposit → confirm → sweep cycle:

1. Book a seat and initiate USDT payment (frontend, or the API). Note the
   `receivingWallet` deposit address returned.
2. Simulate an attendee paying from a funded account:

   ```bash
   npm run local:pay -- 0x<depositAddress>
   ```

3. Within a few seconds the listener records the deposit and, once the chain has
   settled it, confirms the payment + booking in one transaction and writes the
   receipt row. The daily sweep then funds the deposit with BNB from the gas
   wallet and moves the USDT to the treasury. Verify with
   `GET /api/admin/report`.

The listener has no strategy switch any more: it always queries `eth_getLogs`
for the token's `Transfer` event and attributes the results to deposit
addresses in SQL. That is the only RPC dependency, which is why the same code
path runs unchanged against Anvil, the BSC testnet and BSC mainnet.

---

## 9c. Local node + job configuration (for quick manual runs)

When testing against a local node set these in `.env.local` (the setup script
writes them) and restart the backend:

```env
BSC_RPC_URL=http://127.0.0.1:8545
ENABLE_JOBS=true
ENABLE_PAYMENT_MONITOR_JOB=true
ENABLE_SWEEP_JOB=true
ENABLE_ORDER_EXPIRY_JOB=true
MONITOR_POLL_INTERVAL_MS=3000
```

`MONITOR_TRANSFER_STRATEGY` is gone and `ALCHEMY_RPC_URL` is no longer needed;
both may still appear in an older `.env.local` and are simply ignored.

A local chain has no `finalized` block tag and moves faster than the
probabilistic depth, so point settlement at the depth mode while working
against Anvil (otherwise a confirmed payment waits for a 15-block depth that a
fresh local chain never reaches):

```env
SETTLEMENT_FINALITY_MODE=depth
SETTLEMENT_MIN_CONFIRMATIONS=1
```

---

## 9d. Local testing against the Binance Smart Chain TESTNET (chain id 97)

Anvil is enough for logic, but a real testnet run proves the flow against real
blocks, real gas and real confirmations. `local-dev/setupBscTestnet.sh` deploys
a mintable mock USDT to the testnet and writes the same kind of `.env.local`
override as the Anvil script, so nothing in `.env` changes.

Prerequisites: Foundry (`forge`), PostgreSQL running, and a testnet payer key
holding testnet BNB (from <https://www.bnbchain.org/faucet>).

```bash
npm run testnet:setup              # deploys MockUsdt on testnet, writes .env.local
npm run dev                        # backend points at the testnet
npm run testnet:pay -- 0x<depositAddress>   # mint + pay a booking's deposit address
```

The payer key is resolved from `BSC_TESTNET_PAYER_PRIVATE_KEY`, then from
`local-dev/bsc-testnet-payer.key` (generated on the first run and gitignored),
and doubles as the gas wallet and treasury so one testnet key is enough.

To deploy the token yourself first (Remix, Hardhat, `forge create`, …) use
`local-dev/MockUsdt.sol` — a plain BEP20 with an open `mint`, 18 decimals — and
point the setup at your deployment instead of a fresh one:

```bash
npm run testnet:setup -- <payerKey> <yourUsdtAddress>
```

Driving a full order → payment cycle without the frontend:

```bash
npm run testnet:order "Attendee Name"          # books a seat, prints the deposit address
npm run testnet:pay -- <depositAddress>         # mints + sends the ticket price on testnet
```

RPC notes, verified against live endpoints:

- Binance's own seed endpoint (`https://data-seed-prebsc-1-s1.bnbchain.org:8545`)
  answers `eth_chainId`/`eth_blockNumber` but returns `{"error":"limit exceeded"}`
  for **every** `eth_getLogs` call, so the event-log monitor cannot use it.
  `https://bsc-testnet-rpc.publicnode.com` serves logs and is the default. This
  is also why Binance's own endpoints are absent from
  `services/rpcEndpointResolver.js`'s default candidate list — the listener
  cannot work around them.
- The mainnet USDT address `0x55d3…7955` has **no bytecode** on the testnet. The
  real testnet USDT is `0x7ef95a0FEE0Dd31b22626fA2e10Ee6A223F8a684` (18 decimals),
  but nobody airdrops it, which is why a mintable mock is deployed instead.
- No public node implements Alchemy's `alchemy_getAssetTransfers`, and nothing
  needs it any more: the listener reads `eth_getLogs` on every network.
  `MONITOR_TRANSFER_STRATEGY` is no longer read by any code.
- Public nodes also refuse wide log queries and a scan from genesis, so the setup
  writes `MONITOR_LOG_SCAN_CHUNK_BLOCKS=10000` (publicnode caps a single
  `eth_getLogs` at 50 000 blocks) and `MONITOR_INITIAL_SCAN_LOOKBACK_BLOCKS=20000`
  (a brand new listener cursor otherwise asks the node for 134 M blocks).

`tests/bscTestnetPaymentFlow.test.js` is the opt-in end-to-end proof. It books a
seat, pays the deposit address with real testnet transactions, runs one real
`runUsdtTransferListenerTick()` and asserts against the database: exact price
confirmed with a receipt row, underpayment never confirmed, a payment to an
expired order still settled, and a second tick a no-op. It is skipped unless
enabled, and it must never point at the `masterclass` database.

```bash
RUN_BSC_TESTNET_INTEGRATION=true \
DB_DATABASE=masterclass_agent3 \
node --test --test-force-exit tests/bscTestnetPaymentFlow.test.js
```

See 9e for the behaviour it is proving.

---

## 9e. Automatic payment confirmation, receipts and daily collection

This is the behaviour a maintainer needs when a payment "did not go through".
Read this before touching `services/monitorService.js`,
`services/usdtPaymentService.js` or the confirmation path.

### 9e.1 The listener tick is one log query, not one query per order

`runUsdtTransferListenerTick()` in `services/monitorService.js` is one tick, and
it performs these steps in this order:

1. **Read the settlement frontier once.** `fetchChainSettlementFrontier`
   (`services/blockFinalityService.js`) returns the chain head *and* the head of
   the settled part of the chain. Reading it once per tick is deliberate: every
   deposit judged in the same tick is judged against the same settlement point,
   so two transfers cannot disagree about what "settled" means.
2. **Read the token's `Transfer` logs for the whole scan window in ONE
   `eth_getLogs`.** The query is `topics: [Transfer(address,address,uint256)]`
   on `USDT_CONTRACT_ADDRESS` only — it is not filtered per deposit address.
3. **Attribute the results in SQL.** `matchTransfersToWatchedDepositAddresses`
   takes the recipient addresses found in step 2 and resolves them against
   `deposit_addresses` in a single query. The watch set is
   `fetchConfirmableDepositAddressRecords` / `fetchWatchableDepositAddressRecords`.
4. **Record every new transfer** into `deposits_observed`
   (`ON CONFLICT (tx_hash) DO NOTHING`, so a re-read of the overlap window is
   harmless), then **drop any deposit a reorg invalidated** (see 9e.3).
5. **Settle each order whose payment is complete, one transaction per order.**

The whole tick costs a constant number of RPC calls — roughly two block-number
reads plus one `eth_getLogs` — no matter whether one order or a thousand are
open, and no matter how many deposit addresses are being watched. That is what
makes `MONITOR_POLL_INTERVAL_MS=5000` viable against a rate-limited public node.
The older per-order scan (one log query per open order, Alchemy
`alchemy_getAssetTransfers` by default) is gone; nothing in the payment path
needs an `ALCHEMY_*` value any more.

`MONITOR_LOG_SCAN_CHUNK_BLOCKS` is the one exception to "one call": a public node
caps the block width of a single `eth_getLogs`, so a wider window is walked in
chunks of that size. That is a node limit, not a design choice — with `0` (the
default) a tick is literally one call.

Failures are isolated two ways. A failed scan leaves the cursor untouched
(`updateTransferScanStateAfterFailedScan` records `last_error` and bumps
`consecutive_failures`) so the next tick retries the same window, and a failed
RPC parks the endpoint for a cool-down and rotates to the next candidate
(`services/bscProviderPool.js`). Inside the tick, each order is settled in its own
`try/catch`: one sold-out booking or one malformed deposit can no longer abort
the whole tick and strand every other pending payment.

### 9e.2 Settlement uses the finalized block tag, not a confirmation count

`SETTLEMENT_FINALITY_MODE=finalized` (the default) asks the node for the
`finalized` head (`safe` as an automatic second try). BNB Smart Chain reaches
deterministic finality in about a second through BEP-126 voting and exposes it,
so a deposit is settled the moment its block is at or below that head — faster
*and* safer than counting blocks, because the count was a pre-BEP-126 heuristic
that only ever added latency.

`SETTLEMENT_FINALITY_MODE=depth` is the fallback for a node that serves neither
tag (a local Anvil, most notably). It pulls the head back by
`SETTLEMENT_MIN_CONFIRMATIONS` (default 15) and compares against that instead.
Use it locally; there is no reason to use it against BSC.

A deposit is therefore recorded as observed immediately (the block exists), but
it is only *settled* — and only then can it confirm a payment — once the chain
says so. `deposits_observed.is_finalized` / `finality_confirmed_at` /
`finalized_block_number` record that moment, and the amount is compared as an
exact integer in `amount_wei`, never against the rounded `NUMERIC(14,2)`
`amount` column, so a split payment is never judged short by rounding. The
expected amount comes from `payments.amount_expected` (which is where an admin
price override lives), so an override is honoured without editing
`shared/eventConfig.js`.

An underpayment is never auto-confirmed. When the seat hold is still live it
simply waits. When the hold has expired it is parked:
`buildUnderpaymentExpiryDecision` decides, and
`UNDERPAYMENT_GRACE_PERIOD_MINUTES` (default `0`) is how much longer a short
deposit may still grow before a `payment_review_flags` row is written.

### 9e.3 The reorg guard

Every observed deposit stores the `block_hash` it was read from
(`deposits_observed.block_hash`). Before anything is confirmed,
`dropObservedDepositsFromReorgedBlocks` re-reads the canonical block for every
deposit that is not yet finalized and compares its hash; a mismatch means the
transfer we recorded is not on the chain any more, so the row is **deleted**
rather than flagged — a payer may legitimately try again, and the second attempt
needs its own row. Deposits at or below the finalized head are left alone,
because the chain will not replace them.

### 9e.4 Confirmation is a single transaction

`confirmUsdtOrderPaymentFromObservedDeposits` in `services/usdtPaymentService.js`
is the one place a USDT payment becomes a confirmed booking, and everything the
attendee and the business need to trust the payment is written in **one**
database transaction, in this order:

1. the observed transfers are marked finalized (`deposits_observed`);
2. the completing transfer is recorded (`blockchain_transactions`,
   `ON CONFLICT (tx_hash) DO NOTHING`);
3. the payment is confirmed (`payments.status='confirmed'`, `tx_hash`,
   `confirmed_at`);
4. the seat is granted inside the same transaction
   (`confirmBookingSeatWithinClientCapacity`, which locks `seat_capacity`
   `FOR UPDATE` and confirms a booking whose hold is `pending` *or* already
   `expired` — that is what makes a late payment worth honouring);
5. the order is marked `paid` (`orders.status='paid'`);
6. the receipt row is written (`payment_receipts`, `UNIQUE` on `payment_id`).

Either all of it exists or none of it does, so a crash can never leave a
confirmed payment without a seat, a receipt without a payment, or a paid order
without a receipt.

**The ticket and receipt emails are sent AFTER the commit.** The receipt row
already exists and is `pending`; `deliverTicketForConfirmedBooking` then attaches
the receipt PDF to the ticket email and sends the receipt on its own. A mail
failure is recorded (`ticket_deliveries.status='failed'` /
`payment_receipts.status='failed'` with `attempt_count` and `last_error`) and
never rolls the payment back. `jobs/ticketDeliveryRetryJob.js` retries both up
to `TICKET_DELIVERY_MAX_ATTEMPTS` every `TICKET_DELIVERY_RETRY_INTERVAL_MS`
(gated by `ENABLE_TICKET_DELIVERY_RETRY_JOB`).

The one deliberate exception inside that transaction: if the money is real but
**no seat can be granted** (sold out), the payment is still confirmed and the
money is still recorded — the booking is left closed and a
`payment_review_flags` row with `reason='hold_expired_no_seat'` and
`auto_action='payment_confirmed_without_seat'` hands the difference to a human
as a refund case. Losing the money is never an option.

### 9e.5 The stranded-payer fix

The failure this prevents: a booking's hold lapses, the client keeps the deposit
address it was given and pays it anyway, and the money becomes invisible because
the address is no longer watched.

- `reissueDepositAddressForOrder` (`services/orderService.js`) hands a **fresh**
  derived address to a lapsed unpaid hold, renews `orders.expires_at`, and marks
  the previous address `is_active = false, superseded_at = now()`. It refuses if
  the order is already `paid`/`swept` or if any transfer was already observed on
  the current address — replacing an address that has money on it would hide the
  payment. `POST /api/payments/:id/initiate-usdt` does this automatically and
  reports `holdRenewed: true`.
- **Superseded addresses stay watched.** `WATCHABLE_ORDER_STATUSES` is
  `['pending','paid','expired']` and `fetchConfirmableDepositAddressRecords`
  returns *every* address of an order, active or superseded. A payment to a
  superseded address is matched and settled normally.
- **An expired order is still confirmable.** The stranded payer pays an
  `expired` order, the listener settles it, and `confirmBookingSeatWithinClientCapacity`
  grants the seat as long as the booking hold itself is still `pending` or
  `expired` and a seat is free.
- **Money that genuinely cannot be auto-settled becomes a
  `payment_review_flags` row**, never disappears: underpayment after the grace
  window, or a confirmed payment with no seat. `reason` records which,
  `auto_action` records what the automatic path already did, and the unique index
  on `(COALESCE(tx_hash, deposit_address), reason)` keeps a single transaction
  from being flagged twice for the same reason.

`services/sweepVerificationService.js` answers the follow-up question: "did they
pay, and has it since been collected?" using only database evidence, so a payment
that was already swept can still be proven without trusting a live balance.
`fetchAmbiguousUnconfirmedPaymentRecords` lists exactly the payments that are not
confirmed but already carry money evidence — the reviewer's worklist.

### 9e.6 Daily sweeping, and a sweep record as evidence

Sweeping is deliberately **daily and never immediate**.
`SWEEP_INTERVAL_HOURS` (default 24) is the minimum gap between two collection
passes and `SWEEP_MINIMUM_AGE_HOURS` (default 24) is the minimum age of a settled
payment before its deposit address may be collected. Moving a deposit the moment
a payment is confirmed would destroy the evidence the confirmation and the
review path need, and an operator has to be able to answer "did they pay?" for a
while after the fact. `SWEEP_POLL_INTERVAL_MS` is only how often the worker wakes
up; it collects nothing until the daily window has elapsed, and the newest
`sweeps` row doubles as the durable last-run timestamp so a restart cannot
collect twice in one window.

`SWEEP_MIN_THRESHOLD_USDT` still governs *premature* collection only: a deposit
whose payment is confirmed and settled past the minimum age is always
collectable, otherwise a single 3.8 USDT ticket would never be swept at all.

Because a sweep can collect a deposit before the confirmation ran, a successful
`sweeps` row (`status` in `funded`/`swept` **and** a non-null `tx_hash`) is
durable proof that money arrived and left the address. `verifyPaymentAgainstSweepEvidence`
uses it to confirm an ambiguous payment, counting swept-but-not-yet-observed
funds so the same money is never counted twice. A row that has a `block_number`
is only trusted once `is_finalized` is true; `runSweepCycle` sets that from the
same settlement frontier the listener uses (`finalizeSettledSweepRecords`), so a
reorg cannot leave a collection recorded as proof.

The gas wallet's spend is bounded by `GAS_SPONSORSHIP_MAX_BNB_PER_SWEEP`,
`..._PER_CYCLE` and `..._PER_DAY` (rolling `GAS_SPONSORSHIP_SPEND_WINDOW_HOURS`).
The daily total is summed from `sweeps.bnb_funded_wei`; `bnb_funded`
(`NUMERIC(14,2)`) is display-only and rounds a real ~0.0005 BNB fee to zero. A
sweep that would exceed a cap is marked failed and alerted, and the deposit is
left untouched for an operator.

Listener stalls are reported by `jobs/listenerHealthCheckJob.js`: no successful
scan for `MONITOR_STALL_ALERT_POLL_INTERVALS` intervals, or
`MONITOR_STALL_ALERT_FAILURE_LIMIT` consecutive failures. This is the failure
mode where money arrives and is never confirmed, so the alert is deliberately
based on the durable scan cursor rather than on the job process being alive.

### 9e.7 Operator runbook

**Current suite state:** `npm test` is green (355 tests, 351 pass, 4 skipped at
the time of writing). The listener tests named in earlier revisions of this
document were merged into `tests/monitorService.test.js`; the booking seat-hold
count issue was fixed.

**Minimum production configuration:**

```env
CHAIN_ID=56                                  # or 97 on the testnet
BSC_RPC_URL=<your mainnet RPC>
BSC_RPC_URL_FALLBACK_URLS=<two or three more public endpoints, comma separated>
USDT_CONTRACT_ADDRESS=0x55d398326f99059fF775485246999027B3197955
WALLET_ACCOUNT_XPUB=<xpub for m/44'/60'/0'/0>
ENABLE_SWEEP_JOB=false                       # production collects through 9e.8
GAS_WALLET_PRIVATE_KEY=<hot wallet that funds sweeps>
TREASURY_WALLET_ADDRESS=0xYourTreasuryWalletAddress
SETTLEMENT_FINALITY_MODE=finalized           # the default; "depth" is the local-node fallback
ENABLE_JOBS=true
ENABLE_PAYMENT_MONITOR_JOB=true
ENABLE_LISTENER_HEALTH_JOB=true
ENABLE_TICKET_DELIVERY_RETRY_JOB=true
MONITOR_POLL_INTERVAL_MS=5000
SWEEP_INTERVAL_HOURS=24
SWEEP_MINIMUM_AGE_HOURS=24
GAS_SPONSORSHIP_MAX_BNB_PER_SWEEP=0.005
GAS_SPONSORSHIP_MAX_BNB_PER_CYCLE=0.05
GAS_SPONSORSHIP_MAX_BNB_PER_DAY=0.2
TICKET_DELIVERY_MAX_ATTEMPTS=5
```

**A payment is not confirmed — check in this order:**

1. `SELECT * FROM usdt_transfer_scan_state;` — is `last_scanned_at` advancing?
   Is `last_error` set and `consecutive_failures` climbing? A stale
   `last_scanned_at` means the listener is not running or every endpoint is
   failing; the error text says which. Compare `last_scanned_block` against the
   chain head: if it is far behind, the window is too wide for the node
   (`MONITOR_LOG_SCAN_CHUNK_BLOCKS`).
2. `SELECT * FROM deposits_observed WHERE order_id = <orderId>;` — nothing here
   means the transfer was never matched to a deposit address. Check that
   `USDT_CONTRACT_ADDRESS` is the token the attendee actually sent, that the
   address is on record (`deposit_addresses`, including any superseded one), and
   that the transfer is inside the scanned window.
   A row with `is_finalized = false` means the chain has not settled it yet —
   that is normal for a few seconds and it is why the confirmation has not
   happened.
3. `SELECT * FROM payment_review_flags WHERE resolved_at IS NULL ORDER BY created_at;`
   — money that arrived and needs a human. `reason` and `details` say which case
   it is and `auto_action` says what was already done.
4. `SELECT * FROM ticket_deliveries WHERE status <> 'sent';` and
   `SELECT * FROM payment_receipts WHERE status <> 'issued';` — the payment may
   well be confirmed while the mail failed. `attempt_count` and `last_error`
   explain it; `jobs/ticketDeliveryRetryJob.js` retries up to
   `TICKET_DELIVERY_MAX_ATTEMPTS`.
5. `SELECT * FROM reconciliation_runs ORDER BY started_at DESC;` — the daily
   cross-check of observed deposits vs `treasury_ledger` vs the on-chain treasury
   balance, with `status`, the three totals, `mismatch_usdt` and the full
   `details` blob. A `mismatch` row is the durable answer to "what was the
   operator told, when, and with which numbers".

**Endpoints added/changed with this behaviour:**

| Endpoint | Purpose |
| --- | --- |
| `GET /api/payments/:id` | Now returns a `settlement` block alongside the payment: `expectedAmountUsdt`, `observedTransferCount`, `observedAmountUsdt`, `isObservedPaymentSettled`, `latestObservedBlockNumber` and a `receipt` summary (`status`, `txHash`, `blockNumber`, `explorerTxUrl`, `issuedAt`). Enough for the pay page to say "we saw your payment" without exposing the transaction record. |
| `POST /api/payments/:id/initiate-usdt` | Issues a **fresh** deposit address and renews the hold when the previous one lapsed unpaid (`holdRenewed: true`); returns `409` with `paymentReceived: true` when money was already seen on the current address. |
| `GET /api/tickets/:bookingRef/receipt` | Downloads the **stored** receipt PDF (the one that was emailed), regenerating it only if the file is missing. 403 unless the booking is confirmed, 404 until the receipt row exists. |
| `POST /api/bookings/:id/reactivate` | Reactivates an expired seat hold so the client can retry, in coordination with the address re-issue above. |

### 9e.8 Production collection without the seed online

The API server derives deposit addresses from `WALLET_ACCOUNT_XPUB` and never
holds the mnemonic. Collection is a three-step hand-off:

1. **Prepare (online).** `sweep:prepare` performs the shared preparation
   (recovery, readiness, `sweeps` row, BNB funding from the gas wallet) and
   writes an unsigned JSON batch with one transaction per gas-price attempt.
2. **Sign (offline).** `sweep:sign` verifies every attempt against the batch
   (USDT contract, treasury, amount, chain, nonce, gas price), signs the whole
   retry ladder with the derived key, and recovers the sender to prove it equals
   the deposit address. It needs no network and no database.
3. **Submit (online).** `sweep:submit` validates the signed batch against
   `sweeps` and the expected sender before broadcasting anything, then records
   the `sweeps` row, the `treasury_ledger` entry and the order transition
   atomically. Re-running it on a completed batch is a no-op.

**One-time setup (before go-live):**

1. Generate a fresh production seed on the air-gapped machine. Do not reuse the
   development seed from `.env`.
2. Export the **xpub** of the external-chain account node (not the account-level
   key, and never the xprv):

   ```bash
   export SEED='<production seed phrase>'
   node --input-type=module -e "
     import { HDNodeWallet } from 'ethers';
     const master = HDNodeWallet.fromPhrase(process.env.SEED, undefined, 'm');
     console.log(master.derivePath(\"m/44'/60'/0'/0\").neuter().extendedKey);
   "
   unset SEED
   ```

3. Verify index 0 and 1 on both sides before trusting the key:

   ```bash
   # online, with WALLET_ACCOUNT_XPUB set
   npm run wallet:derive -- 0
   npm run wallet:derive -- 1

   # offline
   cast wallet address --mnemonic "$SEED" --mnemonic-index 0
   cast wallet address --mnemonic "$SEED" --mnemonic-index 1
   ```

   The pairs must match exactly. A mismatch means the xpub is at the wrong depth
   (for example `m/44'/60'/0'` instead of `m/44'/60'/0'/0`).
4. On the server set `WALLET_ACCOUNT_XPUB`, remove `WALLET_MNEMONIC`, set
   `NODE_ENV=production` (the `npm start` script already does this) and
   `ENABLE_SWEEP_JOB=false`. The startup guard will refuse to boot otherwise.
5. If the database still contains test orders, reset the derivation sequence
   (`ALTER SEQUENCE customer_derivation_seq RESTART WITH 1`) **only after
   deleting or archiving that test data**; never reuse an index that already has
   a deposit address in production.

**Daily collection:**

```bash
# online
npm run sweep:prepare -- sweep-batch-unsigned.json
# copy sweep-batch-unsigned.json to the offline machine

# offline (same repo checkout, node_modules installed, .env has WALLET_MNEMONIC)
npm run sweep:sign -- sweep-batch-unsigned.json sweep-batch-signed.json
# copy sweep-batch-signed.json back

# online
npm run sweep:submit -- sweep-batch-signed.json
```

The signed file is safe to delete after a successful submit; it contains only
broadcastable transactions, not keys. The unsigned batch can be discarded too.

**Failure handling:**

- `AWAITING_CONFIRMATION` means the node accepted the transaction but the receipt
  is not available yet. Wait and re-run `sweep:submit` with the same file; the
  row's `tx_hash` is recovered from the chain instead of sending a second
  transfer.
- `FAILED` (for example a stale nonce) aborts that item before broadcast, or
  records the failure when the node rejects it. Re-run `sweep:prepare` to build
  a fresh batch; the deposit balance is still on the address.
- Do **not** prepare a replacement batch while a signed batch is waiting to be
  submitted: the new prepare abandons the un-broadcast `sweeps` row (marks it
  failed) and the old signed file is then refused as stale by design.
- The server still holds `GAS_WALLET_PRIVATE_KEY` (BNB only). It cannot move
  USDT; the sponsorship caps bound its spend.

---

## 10. Possible next steps

- Fund a testnet gas wallet (BC testnet BNB) and a testnet treasury, set
  `USDT_CONTRACT_ADDRESS` to a BSC **testnet** USDT contract, `CHAIN_ID=97`, point
  `BSC_RPC_URL` + `BSC_RPC_URL_FALLBACK_URLS` at the same testnet, then enable
  `ENABLE_JOBS=true` to see the full listener → confirm → receipt → fund → daily
  sweep → treasury cycle on BSC testnet (Chapel) first, then mainnet. The
  `usdt_transfer_scan_state` cursor and the sweep gas-bump retry are in place, so
  repeated polls do not rescan from genesis.
- Treat `USDT_RECEIVING_WALLET` as a fallback only: with per-order derived
  addresses it is no longer the primary target, and it should ideally be replaced
  by `TREASURY_WALLET_ADDRESS` for all USDT flows.
- `orders.ticket_ids` is currently hardcoded to `'[]'`; populate it from the real
  booking ticket(s) when tickets are issued.
- Decide on auth for `GET /api/admin/report` (an admin login / token before go-live;
  it is currently unauthenticated alongside the other public endpoints).
- Run a real SMTP host (or MailHog locally) to see `ticket_deliveries` and
  `payment_receipts` flip to `sent` / `issued`, and watch
  `jobs/ticketDeliveryRetryJob.js` pick up the failures.
- Decide how `payment_review_flags` get resolved: nothing currently flips
  `resolved_at`, so an operator needs a procedure (or an admin endpoint) for it.
- Go-live preparation (Phase 4 follow-ups): fill real AzamPesa credentials, real
  SMTP + `MAIL_FROM`, deploy the frontend and backend Docker images, enable TLS,
  and add monitoring/log aggregation. Set `NEXT_PUBLIC_API_BASE_URL` to the deployed
  API.
- ~~Clean up or remove the exploratory blockchain/wallet utilities~~ (done: the
  unused exploratory controllers, wallet helper, prompt helper, and unused schema
  middleware were removed).
- Portable/browser-level QA of the reactive flows (polling, promotions) once real
  AzamPesa / BSC / SMTP services are available.
