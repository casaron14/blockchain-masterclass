# Blockchain Infrastructure Audit — Account Abstraction & Gas Sponsorship

**Scope:** the on-chain payment, collection and settlement code in `backend/`.
**Question answered:** is account abstraction (ERC-4337 / EIP-7702) or gas sponsorship
worth implementing here, and what is already there?
**Method:** read every blockchain service, job, controller and the relevant schema
sections; verified on-chain facts against BSC mainnet RPC and BNB Chain documentation.
**Date:** 23 October 2026.

---

## 1. Verdict first

| Question | Answer |
| --- | --- |
| Is gas sponsorship implemented? | **Yes, on the merchant side**, and it is the correct model. It is not hardened. |
| Should we add account abstraction? | **No.** This product has no user accounts and no wallet connection. AA would add a bundler, a paymaster, an embedded-wallet provider and a new signing surface to remove a ~$0.10 one-time BNB requirement for a minority of payers. |
| Can the *payer* be made gasless? | **Not with BEP20 USDT.** The token has no `permit` and no EIP-3009 (verified: `DOMAIN_SEPARATOR()` reverts on `0x55d3…7955`). Every payer-side path therefore needs a wallet that speaks 4337/7702 or a different token. |
| What is actually worth doing? | Fix three correctness defects in the existing sponsored flow (`F1`–`F3`), add listener/sponsorship observability, and treat payer gas as a messaging/product decision. |

The short version: **we already sponsor gas where we control the keys. We cannot
sponsor gas where we do not, without changing the wallet experience or the token.**

---

## 2. What is implemented today

### 2.1 Payment path (per-order deposit address)

```
booking ──► payments row (usdt_bep20, amount_expected = 3.8 USDT)
              │
              ▼  POST /api/payments/:id/initiate-usdt
        orders row + deposit_addresses row
        derivation index from customer_derivation_seq (never reused)
        address = BIP44 m/44'/60'/0'/0/{index} from WALLET_MNEMONIC
              │
              ▼  payer sends USDT to the derived address
        monitorService.runUsdtTransferListenerTick()   every 5 s
          1. read settlement frontier (latest + finalized head)
          2. ONE eth_getLogs for the USDT Transfer topic over the scan window
          3. attribute transfers to known deposit addresses in SQL
          4. insert deposits_observed, drop entries whose block hash was reorged
          5. settle each complete order in its own DB transaction
              │
              ▼  block is at/below finalized head, amount >= expected
        confirmUsdtOrderPaymentFromObservedDeposits()
          single DB transaction writes:
            deposits_observed (finalized)
            blockchain_transactions
            payments.status = confirmed
            bookings seat confirmation (FOR UPDATE seat_capacity)
            orders.status = paid
            payment_receipts row
          after commit: ticket email + receipt PDF email
              │
              ▼  daily, after SWEEP_MINIMUM_AGE_HOURS
        sweepService.runSweepCycle()
          gas wallet funds the deposit address with exact BNB for one transfer
          deposit address signs USDT.transfer(treasury, fullBalance)
          sweeps row + treasury_ledger row + orders.status = swept
```

Supporting pieces: `blockFinalityService` (finalized head with depth fallback),
`bscProviderPool` (endpoint rotation + cool-down), `usdtSettlementService` (exact
wei arithmetic, underpayment grace), `sweepVerificationService` (payment provable
after the funds were already swept), `reconciliationService` (deposits vs ledger vs
on-chain treasury), `telegramAlertService`, and seven gated background jobs.

This is materially better than the state described in `audit.md`. It is a
well-considered custodial collection gateway: the payer only needs to send a
transfer, and every state transition is written inside one DB transaction.

### 2.2 Where the gas is paid

| Actor | Pays gas? | Who funds it |
| --- | --- | --- |
| Attendee sending USDT | **Yes** — their wallet needs BNB | The attendee. Not sponsored. |
| Deposit address sweeping to treasury | No — it is pre-funded | `GAS_WALLET_PRIVATE_KEY` hot wallet |
| Gas wallet → deposit address funding tx | Yes | Gas wallet balance |
| Treasury / listener / reconciliation | No on-chain gas (read-only) | — |

So "gas sponsorship" already exists in the only place the business takes risk: the
collection leg. The economic size is trivial — at 65,000 gas and 1–3 gwei, one
sponsored sweep costs roughly 0.0002–0.0007 BNB, i.e. **under 0.2 % of a 3.8 USDT
ticket**. Optimising that further is not worth engineering time.

### 2.3 On-chain facts verified for this audit

| Fact | How verified | Result |
| --- | --- | --- |
| ERC-4337 EntryPoint deployed on BSC | `eth_getCode` on `0x5FF137…2789`, `0x0000…da032`, `0x4337…F108` | All three respond with bytecode (v0.6, v0.7, v0.8) |
| BSC USDT supports `permit` / EIP-3009 | `eth_call` `DOMAIN_SEPARATOR()` and `nonces(address)` on `0x55d398326f99059fF775485246999027B3197955` | **Both revert** → no signed-transfer path |
| EIP-7702 available on BSC | BNB Chain Pascal hardfork (March 2025) | Live on mainnet |
| BSC-native EOA paymaster exists | BNB Chain docs (BEP-322, MegaFuel/NodeReal) | Exists, but is **wallet-side** integration (`pm_isSponsorable` + `eth_sendRawTransaction` with gasPrice 0) |
| Installed `ethers` can sign 7702 authorizations | `ethers` 6.17.0 `Wallet.prototype.authorize` | Supported |

---

## 3. Account abstraction: feasibility

### 3.1 Why the product shape rules it out

Account abstraction solves "the user has no gas token and no smart account". Here:

- the attendee is an **email address and a phone number** — there is no account,
  no session, no wallet, and no on-chain identity to abstract;
- the frontend (`components/PaymentFlow.jsx`) shows a **deposit address and a QR
  code**. It never connects a wallet, never signs, never holds a key;
- the event is **150 seats, one event, one fixed price**.

Adding 4337 means: an embedded-wallet provider (Privy / Openfort / MetaMask
Embedded), an account implementation, a bundler, a paymaster with a funding policy,
a new client SDK, new failure states ("user operation rejected", "paymaster
policy denied"), and a second signing surface. That is a multi-week feature whose
only user-visible benefit is removing a ~$0.10 BNB requirement for payers who
already hold crypto.

### 3.2 Option matrix

| Option | Payer needs | What we must build/operate | Works for a general attendee? | Verdict |
| --- | --- | --- | --- | --- |
| **A. Keep current flow** | BNB in their wallet | nothing | Yes | **Recommended for this event** |
| **B. EOA paymaster (BEP-322 / MegaFuel)** | A wallet that supports sponsorship (Bitget does; most do not) | NodeReal sponsor policy + wallet integration | No — depends on the payer's wallet | Optional add-on, not a solution |
| **C. EIP-7702 + our relayer** | A wallet that can sign a 7702 authorization | delegate contract (audited), relayer, wallet-connect UI | No — very few wallets sign 7702 for dApps today | Spike only |
| **D. ERC-4337 smart account + paymaster** | An AA wallet, funded | embedded wallets, bundler, paymaster, policy service | Only if we issue the wallet | **No** |
| **E. Switch token to EIP-3009 (FDUSD / USDC)** | A signature, no gas | token/product change, wallet-connect UI, relayer | Yes, if the business accepts the token change | Cleanest true-gasless path; product decision |
| **F. Hosted checkout / exchange withdrawal** | Nothing new | third-party integration | Yes | Valid, but out of scope of this codebase |

The decisive constraint is **USDT on BEP20 has no signature-transfer primitive**.
Unlike USDC (EIP-3009) or DAI (permit), USDT can only be moved by a transaction
signed by the token holder's account, and that account must hold BNB. No amount of
abstraction on our side changes that without either (a) the payer's wallet
supporting 7702/paymaster sponsorship, or (b) a different token.

### 3.3 What AA *would* buy us (and why it is not worth it here)

- **Batching** — irrelevant; one transfer per payment.
- **Session keys / social recovery** — irrelevant; no repeat users in v1.
- **Sponsorship** — already achieved on the merchant leg with a plain hot wallet,
  and unreachable on the payer leg for the reasons above.
- **Account portability** — irrelevant; tickets are delivered by email.

---

## 4. Findings in the existing blockchain code

Severity is about money correctness and auditability, not style.

### P0 — fix before the next live payment

**F1. The public `verify-usdt` endpoint verifies against the wrong wallet and
skips finality.**
`confirmUsdtPaymentForBooking` (`services/usdtPaymentService.js:455`) calls
`verifyUsdtTransfer(txHash)` with no expected address; `verifyUsdtTransferOnBlockchain`
(`:93`) then falls back to `USDT_RECEIVING_WALLET`. Since Phase 5 every booking is
paid to a **derived** address, so this path rejects legitimate payments. If the
legacy shared wallet is still configured, it instead accepts *any* transfer to that
wallet for *any* booking — there is no binding between tx and order. It also confirms
at `USDT_MIN_CONFIRMATIONS` (default 1), bypassing the finalized-head rule and the
reorg guard, and compares against the static price rather than
`payments.amount_expected`.
*Fix:* delete the endpoint, or route it through
`confirmUsdtOrderPaymentFromObservedDeposits` after resolving the tx to the booking's
deposit address and recording it as an observed deposit.

**F2. Sweep retry can broadcast the same transfer twice.**
`broadcastSweepTransactionWithGasBumpRetry` (`services/sweepService.js:316`) treats
any rejection from `broadcastResponse.wait()` as a failed attempt, then rebuilds the
transaction with `getTransactionCount(address, 'pending')` (`:336`). If the first
transaction was accepted but `wait()` timed out, the retry takes the *next* nonce and
re-broadcasts the same USDT transfer. When both mine, the second reverts and
`runSweepCycle` records `failed` (`:510`) even though the money moved — a permanent
reconciliation mismatch and an order that never reaches `swept`.
*Fix:* on failure, look the receipt/transaction up by hash first; treat "already
mined" as success; only bump gas on the same nonce for a still-pending transaction;
only retry genuine broadcast errors.

**F3. The post-broadcast writes are not atomic.**
`markSweepRecordAsSwept`, `recordTreasuryMovement` and `markOrderAsSwept`
(`services/sweepService.js:445`–`:462`) are three separate statements after the
broadcast. A crash between them leaves `sweeps.status` at `pending`/`funded`, no
ledger row and no order transition, while the USDT has already left the address.
The next pass sees a zero balance and returns `EMPTY_DEPOSIT_ADDRESS`, so the gap is
never repaired. `markUnfinishedSweepRecordAsFailed` (`:469`) also only marks the
**newest** row, so an abandoned older row stays `pending` forever.
*Fix:* one transaction for all three writes, and a recovery pass that resolves
`pending`/`funded` sweeps by looking their `tx_hash` up on chain before retrying.

### Phase A remediation — F1, F2 and F3 fixed

- **F1** — `verifyUsdtPaymentEndpoint` now calls
  `verifyClaimedUsdtTransferForBooking` (`services/usdtPaymentClaimService.js`).
  The claim resolves the receipt to the booking's own deposit address (active or
  superseded), records the transfer, and delegates to
  `confirmUsdtOrderPaymentFromObservedDeposits`. A hash that pays another address
  returns `TRANSFER_NOT_FOR_THIS_BOOKING` and leaves the payment pending; finality,
  amount (`payments.amount_expected`), seat capacity, receipts and review flags are
  decided by the same path as the listener. Tests:
  `tests/usdtPaymentClaimService.test.js`.
- **F2** — `broadcastSweepTransactionWithGasBumpRetry` reads the nonce once, persists
  each broadcast hash through `onTransactionBroadcast`, checks the receipt before
  retrying, treats a mined receipt as success, and stops on a receipt with
  `status = 0` or a definitively rejected broadcast (`INSUFFICIENT_FUNDS`,
  `CALL_EXCEPTION`, ...). Tests: nonce reuse, wait-timeout resolved from receipt,
  revert not retried, in `tests/sweepService.test.js`.
- **F3** — `completeSweepRecordWithTreasuryMovement` writes the sweep row, the
  treasury ledger row (`ON CONFLICT (tx_hash) DO NOTHING`) and the order transition
  in one transaction. `markSweepTransactionAsBroadcast` persists the hash before
  waiting, and `recoverUnfinishedSweepForOrder` finishes a `pending`/`funded` sweep
  from its mined receipt instead of re-broadcasting. A row that already carries a
  `tx_hash` is no longer marked failed by the cycle error handler. Tests:
  idempotent completion and recovery (`swept`, `AWAITING_BROADCAST_CONFIRMATION`,
  `SWEEP_REVERTED_ON_CHAIN`) in `tests/sweepService.test.js`.

### Phase B remediation — F4, F5 and F10 fixed

- **F4** — `finalizeSettledSweepRecords` marks `sweeps.status = 'swept'` rows
  `is_finalized` when their block is at or below the settlement frontier;
  `runSweepCycle` runs it after every pass. `verifyPaymentAgainstSweepEvidence`
  now only trusts a swept row that either has no block number (pre-tracking
  legacy row) or is finalized. Tests: `tests/sweepService.test.js`,
  `tests/sweepVerificationService.test.js`.
- **F5** — `services/gasSponsorshipPolicyService.js` enforces per-sweep,
  per-cycle and rolling-day caps, with exact spend summed from the new
  `sweeps.bnb_funded_wei` (the old `NUMERIC(14,2)` column rounds a real sweep fee
  to zero). A refused sweep is marked failed and alerted, never funded. Tests:
  `tests/gasSponsorshipPolicyService.test.js`, cap cases in
  `tests/sweepService.test.js`.
- **F10** — `jobs/listenerHealthCheckJob.js` alerts when
  `usdt_transfer_scan_state` shows no successful scan for N poll intervals, K
  consecutive failures, or no scan since process start. The alert is de-duplicated
  per stall episode. Tests: `tests/listenerHealthService.test.js`.

### Phase C remediation — F9 fixed (seed removed from the API host)

- **F9** — the API process no longer derives from or holds the seed.
  `services/depositAddressDerivationService.js` derives
  `xpub.deriveChild(index)` from `WALLET_ACCOUNT_XPUB` (the external-chain node
  `m/44'/60'/0'/0`); the mnemonic fallback is refused in production by
  `config/productionSigningGuard.js`, which also rejects
  `ENABLE_SWEEP_JOB=true` at startup. Collection is split into
  `sweepBatchPreparationService` (online: prepare + BNB funding),
  `offlineSweepSigningService` (air-gapped: sign the nonce-sharing retry
  ladder), and `sweepBatchSubmissionService` (online: validate the recovered
  sender, broadcast, complete the ledger atomically). The dead
  `signTransactionWithDerivedKey` helper was removed. Tests:
  `tests/productionSigningGuard.test.js`,
  `tests/depositAddressDerivationService.test.js`,
  `tests/sweepBatchOfflineSigning.test.js`.

### P1 — hardening

**F4. Sweep finality is never tracked.** `sweeps.is_finalized`, `block_hash` and
`block_number` exist (`config/schema.sql:654`) and are written once, but no code ever
sets `is_finalized` or re-checks the block. `verifyPaymentAgainstSweepEvidence`
treats any success row with a `tx_hash` as proof, so a reorg could leave the ledger
recording a transfer that no longer exists.

**F5. Sponsored BNB has no policy or budget.** `sweeps.bnb_funded` records what was
sent per order, but there is no aggregate sponsorship spend, no per-sweep cap and no
per-cycle cap in code. The only guard is a Telegram alert at 0.1 BNB
(`jobs/gasWalletMonitorJob.js`). A bad `SWEEP_GAS_BUFFER_PERCENT` or
`SWEEP_MAX_RETRIES` multiplies the funding silently.

**F6. One transaction can only ever match one deposit.**
`deposits_observed.tx_hash` is globally `UNIQUE` (`config/schema.sql:576`).
`parseAllUsdtTransfersFromReceipt` now returns every matching `Transfer` log, but
the claim path still stores them under a single row keyed by the transaction hash,
so a batch payout that pays two derived addresses in one transaction can only ever
attribute one of them.

**F7. Funds on orders that never reach `paid` are never collected.**
`fetchPaidOrdersEligibleForSweep` selects only `orders.status = 'paid'`
(`services/sweepService.js:156`). Underpayments and late payments on expired orders
are correctly recorded in `payment_review_flags`, but their tokens stay on the
deposit address indefinitely with no sweep path.

**F8. Documented review reasons are never produced.**
`payment_review_reason` declares `overpayment`, `hold_expired_with_seat` and
`swept_before_confirmation`, and `handover.md` describes them, but no code path
writes them (grep-verified). Overpayments are silently accepted and swept.
Schema, docs and behaviour disagree.

**F9. Seed handling contradicts the stated security model.**
`blockchain.md` §1 requires the seed in a KMS/HSM and signing isolated from the web
server. `services/signingService.js:28` instead caches the master HD node in module
memory **inside the API process**, which also derives deposit keys. A compromise of
the public-facing Express process exposes every deposit address's key, the gas
wallet key (`GAS_WALLET_PRIVATE_KEY` is also read in-process) and the treasury
destination. Also `signTransactionWithDerivedKey` (`:55`) is dead code that would
throw: it calls `sendTransaction` on a wallet with no provider.

### P2 — operations

**F10. No stall alarm for the payment listener.** `usdt_transfer_scan_state` stores
`last_scanned_at`, `consecutive_failures` and `last_error`, but nothing alerts on
them. A listener that stops scanning is the worst failure mode for this product:
payments are received and never confirmed. The Telegram service already exists.

**F11. Config drift.** `backend/.env` still carries dead keys
(`USDT_EXPECTED_AMOUNT`, `EVENT_TITLE/DATE/LOCATION`, `ALCHEMY_*`) that
`.env.example` documents as removed. `.env.local` (testnet) is the effective config
and points at a mock USDT — correct for development, but it means the mainnet gas
wallet and treasury are **not exercised** by the local config.

**F12. Manual `verify-usdt` and the automatic listener disagree.**
Before Phase A there were two confirmation paths with different guarantees
(finality, receipt issuance, observed-deposit records, review flags). The claim
path now delegates to the listener's settlement function, so only one path decides
whether a payment is complete; the claim only supplies an additional observed
transfer. Keeping it that way is the invariant to protect.

---

## 5. Recommended plan

### Phase A — correctness (1–2 days)

1. `F1` make `verify-usdt` authoritative-safe or remove it; add a test that a
   transfer to a *different* booking's deposit address is rejected.
2. `F2` receipt-first retry in `broadcastSweepTransactionWithGasBumpRetry`; add a
   test where `wait()` fails after a successful broadcast and assert **one** on-chain
   transfer and one `swept` order.
3. `F3` single transaction for sweep completion + a recovery pass over
   `pending`/`funded` sweeps; test the crash window.

### Phase B — observability of the sponsored flow (1–2 days) — implemented

4. `F10` alert when `now - last_scanned_at` exceeds N poll intervals or
   `consecutive_failures` exceeds K.
5. `F5` a small `gasSponsorshipPolicy` module: max BNB per sweep, max per cycle,
   max per day, persisted spend total, refuse-and-alert instead of spending.
6. `F4` mark sweep rows finalized from the same frontier the listener uses.

### Phase C — product decision, not engineering

7. Decide how to talk to crypto payers. The cheapest real improvement is copy:
   state that the payer needs a small BNB balance, and prefer AzamPesa / Lipa Namba
   for attendees without crypto. (Option A.)
8. If payer-side gasless is still wanted, evaluate **Option E** (a token with
   EIP-3009) before **Option D** (4337). Option E removes the gas requirement with a
   signature and no smart account; Option D requires issuing wallets.
9. Only prototype **Option B** (MegaFuel) if NodeReal sponsorship is available and
   the event is willing to tell attendees which wallets work.

### Explicit non-goals

- Do not add a bundler or paymaster to this repository.
- Do not deploy a 7702 delegate contract for a 150-seat event.
- ~~Do not move the seed into a new service as part of this work; `F9` is a separate
  infrastructure project (the current model is acceptable only if the API host is
  treated as a signer and hardened accordingly).~~ Addressed by the Phase C
  remediation above: the server is xpub-only and signing is offline.

---

## 6. Bottom line

The blockchain infrastructure is in good shape and already does the thing that
matters economically: it pays the gas needed to collect the money. Account
abstraction would not improve a flow that has no user accounts, and BEP20 USDT makes
true payer-side gaslessness impossible without changing either the wallet experience
or the token.

The valuable work is not abstraction. It is closing the three correctness gaps in
the existing sponsored path and making its failures visible.
