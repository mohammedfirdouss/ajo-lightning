# Run the e2e checks

`scripts/e2e` runs round 1 and round 2 through `node src/run-round.ts` and checks the four rules in `PLAN.md` against the hubs and the relay. Until a round runner exists it fails on purpose.

## Sub-features

- `e2e-run` runs the four checks and exits 0 only if all pass.
- `e2e-selftest` proves the balance checks can fail and pass against a fake hub.

## How to get to it (user POV)

- Run `./scripts/e2e`.
- Run `npm test -- e2e-selftest`.

## Driving it with scripts and the hub API

Preconditions:

- A fresh stack from `./scripts/up`. Round 1 must not have run on it.

- **Run.** Run `cap e2e ./scripts/e2e`. Without `src/run-round.ts` the transcript is `FAIL check 1 no round runner yet` and `exit=1`. With a runner it shows `PASS check 1`, `PASS check 3`, `PASS check 4`, and `PASS check 2`, in that order, and `exit=0`.
- **Self-test.** Run `cap e2e-selftest npm test -- e2e-selftest`. Three tests pass, and the transcript ends with `exit=0`.

## Gotchas

- The checks run in the order 1, 3, 4, 2 and stop at the first failure. Check 2 runs round 2, which would spoil the balances that check 4 reads.
- A runner must print its report as the last stdout line, in the `RoundReport` shape in `scripts/e2e.ts`, and exit 0 for a partial round.
- Check 2 relies on the monthly pay budget, which allows one contribution. Every round 1 payer is over its cap in round 2.
