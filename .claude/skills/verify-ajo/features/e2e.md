# Run the e2e checks

`scripts/e2e` runs round 1 and round 2 through `node src/run-round.ts` and checks the four rules in [PLAN.md](../../../../PLAN.md) against the hubs and the relay. Until a round runner exists it fails on purpose.

## Sub-features

- `e2e-run` runs the four checks and exits 0 only if all pass.
- `e2e-selftest` proves the balance, receipt, and rerun checks can fail and pass against a fake hub and fake reports.

## How to get to it (user POV)

- Run `./scripts/e2e`.
- Run `npm test`.

## Driving it with scripts and the hub API

Preconditions:

- A fresh stack from `./scripts/up`. Round 1 must not have run on it.

- **Run.** Run `cap e2e ./scripts/e2e`. Without `src/run-round.ts` the transcript is `FAIL check 1 no round runner yet` and `exit=1`. With a runner it shows `PASS check 1`, `PASS check 3`, `PASS check 4`, and `PASS check 2`, in that order, and `exit=0`.
- **Self-test.** Run `cap e2e-selftest npm test`. Eight tests pass, and the transcript ends with `exit=0`.

## Gotchas

- The checks run in the order 1, 3, 4, 2 and stop at the first failure. Check 2 runs round 2, which would spoil the balances that check 4 reads.
- A runner must print its report as the last stdout line, in the `RoundReport` shape in `scripts/e2e.ts`, and exit 0 for a partial round. The report names `circlePubkey`, the key that signs every receipt. The runner must finish within 120 seconds, so it mints short-lived invoices.
- Check 3 wants one paid contribution from every member except the payee. Check 4 wants the rerun to report each of those as paid with its round 1 payment hash and nothing as failed, and no balance to move. A runner that mints a new invoice on the rerun fails, even though the budget refuses the payment.
- Check 2 relies on the monthly pay budget, which allows one contribution. Every round 1 payer is over its cap in round 2.
