# Hold a payment until Ajo settles it

The runner collects each payment on a hold invoice from the payee's receive link. The payee's hub holds the sats until the runner sends the preimage, which only the runner keeps, sealed in `ajo.db`. When the runner's clock passes the invoice's expiry with no payment held, the contribution fails and the runner cancels the invoice. A failed payment stays failed, and the payer's balance does not move.

## Sub-features

- The runner mints one hold invoice per round and payer with `make_hold_invoice`, and never mints a second one, also on a rerun or after a crash.
- While the payer's wallet waits, the runner polls `lookup_invoice` every 500 ms. It sends `settle_hold_invoice` as soon as the hub reports the payment `accepted`.
- At expiry the runner fails the contribution and sends `cancel_hold_invoice`. A payment that reaches the hub later is held and never settled.
- A rerun of a partial round only cancels the failed invoices again. That cancel refunds a payment the hub accepted after the first cancel failed.
- Once a settle has left the runner, its clock no longer fails that payment. The rerun then reads the hub's `settled`.
- A pay call waits at most 20 seconds and every other wallet call at most 10 seconds, and none waits past the round's 100 second budget, so a payee hub that stops answering cannot stretch a run.

## How to get to it (user POV)

Collect a round on the round page, or run `node src/run-round.ts 1`. A member whose payment did not land reads "Ajo will not take a payment on this invoice now that it has expired".

## Driving it with scripts and the hub API

Start a fresh stack per [the skill](../SKILL.md) and copy `connections.json` to `$RUN`. Read each member hub's balance before and after every step with `GET /api/channels` and that hub's read-only token. Round 1 pays member1.

- **Payee stops answering.** Run `docker compose pause router`, start `node src/run-round.ts 1` in the background, wait 6 seconds, then run `docker compose pause member1` and `docker compose unpause router`. The runner exits 0 in under 100 seconds, about 48 in practice, with every contribution `failed`. Run `docker compose unpause member1` and wait 20 seconds. `docker compose logs member1` shows `Updated hold invoice state to accepted` for each late payment, and no payer's balance has moved. Run `node src/run-round.ts 1` again. It reports the same failures, member1's log shows `Marked hold invoice as failed in DB due to cancellation` for each one, and every balance equals its value before the round.
- **Runner killed mid-round.** Run `docker compose pause router`, start `node src/run-round.ts 1` in the background, wait 6 seconds, then `docker kill` the `ajo-round-1-<pid>` container and run `docker compose unpause router`. Run `node src/run-round.ts 1` again. It prints `round 1 was interrupted last time` and reports `complete`. Each payer falls by 1001 sat once and member1 rises by 4000. A third run moves no balance.
- **Unit proof.** `npm test -- runner` covers a late payment after a cancel, a cancel the hub missed, a settle whose reply was lost, and the budget with a silent payee hub.

## Gotchas

- Alby Hub v1.24.6 grants the hold methods through the `make_invoice` permission and has no scope of their own. Asking for `make_hold_invoice` as a scope fails with `did not recognize requested scope`.
- The hub answers `cancel_hold_invoice` with `NOT_FOUND` while it holds no payment. That reply is expected.
- A payment that reaches the hub after a successful cancel is held until its claim deadline, about 124 blocks on this stack, because the hub no longer tracks the invoice. The runner never settles it, and LDK fails it back at that height. To see it, mine past the deadline with `bitcoin-cli -regtest -rpcuser=ajo -rpcpassword=ajo -rpcwallet=miner generatetoaddress 126 <address>` in the `bitcoind` container.
- `GET /api/channels` counts a payment the payee's hub holds in its `localBalance` before it settles. Judge the payer's side, and read the payee again after the rerun's cancel.
