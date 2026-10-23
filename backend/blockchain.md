# Implementation Prompt: USDT (BEP20) Payment Collection System via BIP44 HD Derivation

Use this as a prompt for a coding assistant (Claude Code, Cursor, etc.) or as an engineering spec for your team. It's written to be handed over as-is.

---

## Context to give the assistant

> I'm building a ticketing website that accepts USDT payments on the BEP20 (BNB Smart Chain) network. I need a backend payment collection system that:
> 1. Generates a unique deposit address per order using BIP44 HD derivation
> 2. Monitors those addresses for incoming USDT
> 3. Automatically sweeps confirmed funds into a treasury wallet
> 4. Reconciles payments against orders
>
> Build this as [Node.js/Python/etc — specify your stack]. Walk through each component below, implement it, and flag any security decisions you need my input on before proceeding.

---

## 1. Wallet & key management

- Generate one BIP39 mnemonic (master seed) **once**, offline, at setup time. Never generate it inside application code at runtime.
- Derive keys using BIP44 path `m/44'/60'/0'/0/{index}` (coin type 60 = Ethereum-compatible, which BSC uses since it's EVM-compatible).
- Store the master seed in a KMS or HSM (AWS KMS, GCP KMS, HashiCorp Vault, or a hardware wallet for the truly paranoid). **The application server should never hold the raw seed in memory longer than needed to derive a key, and ideally should call out to a signing service rather than hold the seed at all.**
- Maintain a monotonically increasing `derivation_index` counter in your database — one per order, never reused.
- Library suggestions: `ethers.js` (`HDNodeWallet`) or `bip32` + `ethereumjs-wallet` for Node; 

**Ask the assistant to implement:**
- A `deriveAddressForOrder(orderId)` function that increments the index, derives the address, and stores the mapping `{order_id, derivation_index, address}` in the database — but **never stores the private key**.
- A separate, isolated `signWithDerivedKey(index, txPayload)` function/service that re-derives the private key on demand from the seed (held only in the signing service), signs, and immediately discards the key from memory. This should be a different process/service from the public-facing web app if possible.

---

## 2. Database schema

Ask the assistant to create tables for:

- **orders**: `id, customer_id, ticket_ids, amount_usdt, status (pending/paid/expired/swept), created_at, expires_at`
- **deposit_addresses**: `order_id, derivation_index, address, created_at`
- **deposits_observed**: `id, address, tx_hash, amount, block_number, confirmations, order_id, matched_at`
- **sweeps**: `id, address, order_id, tx_hash, amount, gas_used, bnb_funded, status (pending/funded/swept/failed), created_at`
- **treasury_ledger**: running record of everything moved into the treasury wallet, for reconciliation

keep in mind that the customer_id will be different from the ticket id as this id should be a number for the derivation index
---

## 3. Payment monitoring (watching addresses for incoming USDT)

I will use and set up alchemy

## 4. Sweep logic (moving funds from deposit addresses to treasury)

This is the gas-overhead-handling part we discussed. Implement the **fund-then-sweep** pattern with **threshold batching**:

**Ask the assistant to implement:**
1. A scheduled job (cron triggered once N paid-but-unswept orders accumulate) that:
   - Queries all `deposit_addresses` with confirmed USDT balance above a minimum sweep threshold (e.g., skip anything where gas cost would exceed some % of the balance — make this configurable).
   - For each address needing a sweep, calculates the exact BNB needed for one `USDT.transfer()` call (get current gas price from the RPC, multiply by ~65,000 gas, add a small buffer).
   - Sends that exact BNB amount from a dedicated **gas wallet** (a normal hot wallet you top up manually or via automated refill from treasury) to each deposit address, batched if possible to reduce overhead.
   - Waits for funding tx confirmation.
   - Calls `signWithDerivedKey` to sign a `USDT.transfer(treasury, fullBalance)` transaction from the now-funded deposit address, broadcasts it.
   - Marks the sweep as complete, updates `treasury_ledger`.
2. Retry/alerting logic: if a funding tx or sweep tx fails or gets stuck (low gas price during BSC congestion), retry with bumped gas price, and alert if it fails N times.
3. A gas wallet balance monitor that alerts you (Telegram webhook) when the gas wallet drops below a threshold, so sweeps don't silently stall.

---

## 5. Reconciliation & accounting

**Ask the assistant to implement:**
- A daily reconciliation job that cross-checks: sum of confirmed deposits vs sum of amounts in `treasury_ledger` vs actual on-chain treasury wallet USDT balance (via `balanceOf` call). Alert on any mismatch.
- An admin dashboard or CLI report showing: pending orders awaiting payment, paid-but-unswept orders, total swept, current gas wallet balance, current treasury balance.

---

## 6. Order expiry & address handling

**Ask the assistant to implement:**
-implement the expiry of the system 
- Never reuse a derivation index/address across two different orders, even if the first order expired unpaid.

---

## 7. Security checklist to review with the assistant

- [ ] Master seed never touches the main application server's environment variables or codebase directly — lives in KMS/HSM/vault only.
- [ ] Signing service is a separate, network-isolated component from the public web server.
- [ ] Gas wallet and treasury wallet are **different** wallets with different exposure — gas wallet holds small operational float only; treasury is your real balance, ideally with a higher security bar (multisig or cold storage for anything beyond operational float).
- [ ] Rate-limit and validate all webhook/RPC inputs (a malicious actor sending fake "payment" webhooks should not be able to mark an order paid).
- [ ] Log every derivation index used, every sweep, every treasury movement — immutable audit trail.
- [ ] Test thoroughly on BSC **testnet** (Chapel testnet) with testnet USDT before touching mainnet funds.
- [ ] Get a second person (or an external auditor if funds at scale justify it) to review the signing service and sweep logic before go-live — this is the part where bugs cost real money.

---

## Suggested build order

1. HD derivation + address generation + DB schema
2. Testnet deployment, manually send testnet BNB/USDT to a derived address, confirm you can sign and sweep it back out
3. Payment monitoring/indexer
4. Automated fund-then-sweep job with threshold batching
5. Reconciliation job + alerting
6. Admin dashboard
7. Security review, then mainnet
