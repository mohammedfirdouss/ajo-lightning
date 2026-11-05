# Ajo on Lightning: build plan

## Goal

A savings circle (ajo, esusu, tontine) where members pay each other directly over Lightning. The app never holds a pot. Entry for the Dakar Bitcoin Hack. Submissions close 2026-11-20 20:00 UTC.

## Definition of done

From a clean clone, `docker compose up` followed by one seed command gives a circle of 5 members on regtest. Running round 1 must then show all of the following:

1. The payee's wallet balance rises by exactly 4 × contribution. Read this from the wallet service, not from the app's own records.
2. A member whose payment goes over their spending cap gets a plain-language error, and the round is marked partial.
3. A signed receipt for each payment appears on the local Nostr relay.
4. Running the round twice never charges anyone twice.

`scripts/e2e` checks all four automatically and fails if any one breaks.

## Data shape

- **Circle:** name, contribution amount in sats, cadence, payout order, members.
- **Member:** display name, a pay connection (NWC `pay_invoice` only, capped at the contribution per period), and a receive connection (NWC `make_invoice` and `lookup_invoice` only).
- **Round:** a state machine with states `scheduled → collecting → complete | partial`.
- **Contribution:** a state machine per member per round, with states `pending → invoiced → paid | failed(reason)`. It is identified by (round, member). A retry checks the existing invoice with `lookup_invoice` before paying again, so a retry never charges twice.
- **Receipt:** a Nostr event signed by the circle's key. It carries the round, the payer's pseudonymous id, the amount and the payment hash. It contains no names or phone numbers.

## Phases (riskiest first)

| # | Unit | Check |
|---|------|-------|
| 0 | Spike: N separate NWC wallets on local regtest, direct payments between them, and a budget refusal | The spike script prints balances before and after, plus the refusal's error code |
| 1 | Scaffold: compose, seed, and an e2e harness that fails | `scripts/e2e` runs and fails |
| 2 | Domain core: the round and contribution state machines, plus tests | Unit tests pass |
| 3 | Adapters: NWC payments and Nostr receipts | e2e checks 1, 3 and 4 pass |
| 4 | UI: mobile-first pages rendered on the server, light enough for slow connections | Pages work on a phone-sized screen with slow-3G throttling |
| 5 | AI reminders in English, Pidgin, Yoruba, French and Wolof, with template fallback | Works without an API key |
| 6 | Docs: README, architecture diagram, threat model, metrics, demo script | A clean-clone run following the README works |
| 7 | Optional: hosted demo on Mutinynet | Judges can pay with sats from the faucet |

## Decision log

| Date | Decision | Why |
|------|----------|-----|
| 2026-11-05 | Members pay the payee directly; there is no pot | The app never holds funds. It may spend at most each member's capped amount, which is the security story. |
| 2026-11-05 | One Node service rendering pages on the server, with SQLite | Small pages suit cheap phones on slow connections, and there are fewer moving parts. |
