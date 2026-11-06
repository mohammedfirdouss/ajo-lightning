# AjoRound, a TLA+ model of one round

`AjoRound.tla` models one round of a circle. A payee receives one contribution from each payer. A payer's wallet can refuse, a reply can time out while the payment still lands, and the coordinator can crash and retry. The model checks whether a retry can charge a member twice or show a paid member as failed.

The model came first. The round core in `src/round` follows the fixed design, and `test/round/round-props.test.ts` drives that core with every action in the model's `Next` and checks the same five rules over 1000 random runs. The model predates hold invoices, so it does not model the settle and cancel steps that `src/run-round.ts` adds.

## The rules

| Rule | What it says |
| --- | --- |
| `NoPayerChargedTwice` | No payer pays more than one contribution. |
| `PayeeGetsAtMostThePot` | The payee receives at most one contribution per payer. |
| `CompleteMeansEveryonePaid` | A complete round means every payer paid. |
| `RecordMatchesWalletAtEnd` | When the round ends, a payer shows paid exactly when their wallet paid. |
| `RefusedMeansNoMoneyMoved` | A payer shown as refused by their wallet did not pay. |
| `RoundEnds` | Every round ends, complete or partial. This is a liveness property. |

Two constants pick the design. `Fixed = TRUE` looks the invoice up on the payee's wallet before any retry, and `Fixed = FALSE` retries the pay at once. `Reuse = TRUE` retries the stored invoice, and `Reuse = FALSE` mints a new invoice for each retry.

## Results

| Config | Design | Result |
| --- | --- | --- |
| `fixed.cfg` | Look up, then reuse the invoice | All five rules and `RoundEnds` hold over 7,280,499 distinct states. |
| `naive.cfg` | Retry at once, reuse the invoice | `RefusedMeansNoMoneyMoved` breaks in 11 steps. A payer's late payment reaches the payee, the retry is refused over budget, and the payer shows as refused while the payee has the sats. |
| `naive-rest.cfg` | Retry at once, reuse the invoice | Without the two record rules, the other rules hold over 2,211,385 distinct states. The naive design never double-charges. |
| `noreuse.cfg` | Look up, then mint a new invoice | `NoPayerChargedTwice` breaks in 11 steps. The first payment lands late, the retry pays a second invoice, and the payer pays twice. |
| `noreuse-rest.cfg` | Look up, then mint a new invoice | Without `NoPayerChargedTwice`, `PayeeGetsAtMostThePot` breaks in 19 steps. Extra invoices let the payee receive more than one contribution per payer. |

`report-naive.md` gives a shorter path for the naive design. `RecordMatchesWalletAtEnd` breaks in 8 steps when a reply times out, the late payment lands, and the round ends with the payer shown failed.

## Run TLC

You need Java 11 or later. Download TLC 1.7.4 once:

```sh
curl -L -o /tmp/tla2tools.jar https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar
```

From this folder, check a config:

```sh
java -XX:+UseParallelGC -jar /tmp/tla2tools.jar -workers auto -metadir /tmp/ajo-tlc -config fixed.cfg AjoRound.tla
```

Replace `fixed.cfg` with any config in the table. `-metadir` keeps TLC's state files out of the repo.

On a 12-core laptop, `fixed.cfg` ends in about 4 minutes with these lines:

```text
Model checking completed. No error has been found.
38038794 states generated, 7280499 distinct states found, 0 states left on queue.
The depth of the complete state graph search is 44.
```

`naive.cfg` ends in a few seconds with `Error: Invariant RefusedMeansNoMoneyMoved is violated.` and a trace of 12 states, the initial state and 11 steps. `noreuse.cfg` ends with `Error: Invariant NoPayerChargedTwice is violated.` and a trace of the same length. TLC exits with code 12 when an invariant breaks.

## Charts

`chart-naive.mmd` and `chart-fixed.mmd` draw a round with one payer, from `naive-1payer.cfg` and `fixed-1payer.cfg`. GitHub renders a `.mmd` file as a diagram. In the naive chart, the orange states end with the record wrong. `view.mjs` holds the words on each state and arrow.

The charts come from the `statechart` skill in pstack. It runs TLC, then draws the state graph through `view.mjs`. To make them again:

```sh
HIDE_RERUN=1 node <pstack>/skills/statechart/scripts/statechart.ts AjoRound.tla --config naive-1payer.cfg --view view.mjs --out /tmp/chart-naive
HIDE_RERUN=1 node <pstack>/skills/statechart/scripts/statechart.ts AjoRound.tla --config fixed-1payer.cfg --view view.mjs --out /tmp/chart-fixed
```

`HIDE_RERUN=1` hides the crash and retry arrows that carry no bug, so each chart stays readable. With it, both outputs match the committed charts byte for byte, and `/tmp/chart-naive/report.md` matches `report-naive.md`.
