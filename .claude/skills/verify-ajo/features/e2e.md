# Run the e2e checks

`scripts/e2e` runs round 1 and round 2 through `node src/run-round.ts` and checks the four rules in [PLAN.md](../../../../PLAN.md) against the hubs and the relay. Until a round runner exists it fails on purpose.

## Sub-features

- `e2e-run` runs the four checks and exits 0 only if all pass.
- `e2e-selftest` proves the report, settlement, balance, receipt, and rerun checks can fail and pass against a fake hub and fake reports.

## How to get to it (user POV)

- Run `./scripts/e2e`.
- Run `npm test`.

## Driving it with scripts and the hub API

Preconditions:

- A fresh stack from `./scripts/up`. Round 1 must not have run on it.

- **Run.** Run `cap e2e ./scripts/e2e`. Without `src/run-round.ts` the transcript is `FAIL check 1 no round runner yet` and `exit=1`. With a runner it shows `PASS check 1`, `PASS check 3`, `PASS check 4`, and `PASS check 2`, in that order, and `exit=0`.
- **Self-test.** Run `cap e2e-selftest npm test e2e-selftest`. Twelve tests pass, and the transcript ends with `exit=0`.

## Gotchas

- The checks run in the order 1, 3, 4, 2 and stop at the first failure. Check 2 runs round 2, which would spoil the balances that check 4 reads.
- The runner contract is the doc comment on `RoundReport` in `scripts/e2e.ts`. In short:
  - Print the report as the last stdout line and exit 0, also for a partial round.
  - Read the stack with `loadStack()` from `scripts/stack.ts`, which reads `connections.json` in the seed's `state` volume.
  - Give every paid entry a `paymentHash` of 64 lowercase hex, the hash of the invoice the payee's receive connection minted.
  - Publish one receipt per paid entry to `relayUrl`, signed by the key in `circlePubkey`, tagged `["t", "ajo-receipt"]` and `["payment_hash", <paymentHash>]`.
  - Finish within 120 seconds, so mint invoices with a short expiry and never wait one out.
- Check 3 wants one paid contribution from every member except the payee, a settled incoming payment of `contributionSat` on the payee's hub for each hash (read with `GET /api/transactions/<hash>` and the read-only token), and one matching receipt each. Check 4 wants the rerun to report each of those as paid with its round 1 payment hash and nothing as failed, and no balance to move. A runner that mints a new invoice on the rerun fails, even though the budget refuses the payment.
- Check 2 relies on the monthly pay budget, which allows one contribution. Every round 1 payer is over its cap in round 2.
