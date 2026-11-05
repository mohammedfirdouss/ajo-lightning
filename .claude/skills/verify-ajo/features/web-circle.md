# Start a circle and read the payout order

The circle page at `/` starts a circle with a name, a contribution in sats, and a cadence. Once members join, it lists them in payout order, each with their pay limit in sats and in naira, the round that pays them, and a link to each round.

## Sub-features

- With no circle, `/` shows the start form. A second start is ignored.
- The member list is the payout order. Round n pays member n.
- Each limit shows in sats and in naira. Naira uses the fixed demo rate `AJO_NAIRA_PER_SAT` (default 1.5), and the page says it is not a live price.
- The join button shows only until round 1 has started.

## How to get to it (user POV)

Open the app on a phone. Fill in the circle name, keep 1000 sats and "Every month", and press "Start the circle".

## Driving it with scripts and the hub API

No round runner is wired in yet, so the pages run on the fake source in `src/web/fake.ts`, which drives the real round reducer against in-memory wallets:

```bash
AJO_SOURCE=fake PORT=8900 npm run web
```

Drive it with Playwright from a scratch dir, never as a project dependency, on a 360 by 740 viewport. Find controls by label and role, for example `getByLabel("Circle name")` and `getByRole("button", { name: "Start the circle" })`.

## Gotchas

- The fake keeps state in memory. Restart the server to start over.
- `AJO_SOURCE` other than `fake` stops the server with "no round runner is wired in yet".
