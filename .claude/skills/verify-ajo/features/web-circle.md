# Start a circle and read the payout order

The circle page at `/` starts a circle with a name, a contribution in sats, a cadence, a reminder language, and a passcode. Once members join, it lists them in payout order, each with their pay limit in sats and in naira, the round that pays them, and a link to each round.

## Sub-features

- With no circle, `/` shows the start form. A second start is ignored.
- The passcode must be 6 to 64 characters. The store keeps only a salted scrypt hash of it. Join and collect ask for it, and the receipts page does not.
- The reminder language is English, Nigerian Pidgin, Yoruba, French, or Wolof. The circle starts on the day it is made, and round n falls due n - 1 weeks or months later.
- The member list is the payout order. Round n pays member n.
- Each limit shows in sats and in naira. Naira uses the fixed demo rate `AJO_NAIRA_PER_SAT` (default 1.5), and the page says it is not a live price.
- The join button shows only until round 1 has started.
- On the stack, the form says each demo wallet can pay up to the seeded pay budget a month, 1010 sat by default, and refuses a contribution whose amount plus routing fee is over that budget, with 422 and "Choose 1000 sat or less". A 1010 sat contribution is refused, because it leaves no room for the fee. It stores no circle, so the organiser can try again.

## How to get to it (user POV)

Open the app on a phone. Fill in the circle name, keep 1000 sats and "Every month", pick a reminder language, type a passcode, and press "Start the circle".

## Driving it with scripts and the hub API

On the stack, serve the pages per [the skill](../SKILL.md) and open `http://127.0.0.1:$WEB_PORT/`. The circle lives in `ajo.db` in the state volume, so it survives a restart of `web`.

Without the stack, the fake source in `src/web/fake.ts` drives the real round reducer against in-memory wallets:

```bash
AJO_SOURCE=fake PORT=8900 npm run web
```

Drive either one with Playwright from a scratch dir, never as a project dependency, on a 360 by 740 viewport. Find controls by label and role, for example `getByLabel("Circle name")` and `getByRole("button", { name: "Start the circle" })`. Fill the passcode with `getByLabel("Circle passcode")` and the language with `getByLabel("Reminders in")`.

## Gotchas

- The fake keeps state in memory. Restart the server to start over. On the stack, run `docker compose down -v` to start over.
- `npm run web` without `AJO_SOURCE=fake` and without `AJO_STATE_DIR` stops with a message that names both.
