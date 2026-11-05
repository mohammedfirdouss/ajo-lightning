# Route a payment

A member pays another member over two hops, member to router to member, through NWC. The pay connection refuses a second contribution in the same month, and the receive connection refuses to pay at all.

## Sub-features

- `route-pay` has one member pay member1 one contribution.
- `route-budget` refuses a second payment over the pay budget with `QUOTA_EXCEEDED`.
- `route-scope` refuses a payment from a receive connection with `RESTRICTED`.

## How to get to it (user POV)

- Run `./scripts/route`. The round runner and the web UI come in later PRs.

## Driving it with scripts and the hub API

Preconditions:

- A fresh stack from `./scripts/up`, so no member has spent its weekly budget yet.

- **Run it.** Run `cap route ./scripts/route`. It reads `connections.json` from the state volume, mints an invoice on member1's receive connection, and pays it from member2's pay connection. Every line starts with `ok`, and the transcript ends with `exit=0`.
- **Balances.** Three lines give each hub's absolute balance before and after, read from `/api/channels` with the read-only tokens. With the default 1000 sat contribution, the deltas are `-1001 sat` for member2, `1000 sat` for member1, and `1 sat` for the router.
- **Budget refusal.** The line `member2 pays member1 again in the same month` ends with `refused QUOTA_EXCEEDED`.
- **Scope refusal.** The line `member1's receive connection tries to pay` ends with `refused RESTRICTED`.
- **Another payer.** Run `./scripts/route member3` to pay from member3 instead. Any member other than member1 works once a week.

## Gotchas

- Budgets renew weekly. A second run with the same payer fails its first line with `refused QUOTA_EXCEEDED`, and its balance lines with a delta of 0. Pick another payer or run `docker compose down -v && ./scripts/up`.
- The script prints no URI, secret, or token, so its raw output is safe evidence.
- The script talks to the relay at `ws://127.0.0.1:$RELAY_PORT`. Use `127.0.0.1`, not `localhost`, on macOS.
