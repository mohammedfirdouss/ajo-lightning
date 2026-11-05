# Route a payment

A member pays another member over two hops, member to router to member, through NWC. The pay connection refuses a second contribution in the same month, and the receive connection refuses to pay at all.

## Sub-features

- `route-round` has members 2 to 5 each pay member1 one contribution.
- `route-budget` refuses a payment over the pay budget with `QUOTA_EXCEEDED`.
- `route-scope` refuses a payment from a receive connection with `RESTRICTED`.

## How to get to it (user POV)

- Today only the spike's flow script pays over NWC. The round runner and the web UI come in later PRs.

## Driving it with scripts and the hub API

Preconditions:

- A fresh stack from `./scripts/up`, so no member has spent its monthly budget yet.
- `$RUN/connections.json` exists, per the skill's Drive section.

- **Get the flow script.** Run `git show 2efe05b:spike/flow.mjs > "$RUN/flow.mjs" && printf '{"type":"module"}' > "$RUN/package.json" && npm i --prefix "$RUN" --silent @getalby/sdk@9.0.0`. If your relay is not on 7100, run `sed -i.bak "s#ws://127.0.0.1:7100#ws://127.0.0.1:$RELAY_PORT#" "$RUN/flow.mjs"`.
- **Run it.** Define `route() { (cd "$RUN" && node flow.mjs) > "$RUN/flow.log" 2>&1; local rc=$?; grep -E 'delta|rejected:|->' "$RUN/flow.log"; return $rc; }`, then run `cap route route`. Four `member<n> -> member1` lines show `payee state=settled`, and the transcript ends with `exit=0`.
- **Balances.** The same file shows `member1 delta= 4000`, `delta= -1001` for members 2 to 5, `router delta= 4`, and `balance deltas: ALL OK`. These come from hub `/api/channels`.
- **Budget refusal.** The file holds `rejected: Nip47WalletError code=QUOTA_EXCEEDED`.
- **Scope refusal.** The file holds `rejected: Nip47WalletError code=RESTRICTED`.

## Gotchas

- Commit 2efe05b lives on the local `spike/node-per-member` branch and is not on GitHub. Run from a worktree of the local repo, not a fresh clone.
- The flow script prints full tables, so the `grep` above keeps secrets and noise out of the evidence. Do not tee its raw output.
- Budgets renew monthly. A second run on the same stack refuses every payer. Run `docker compose down -v && ./scripts/up` first.
- Use `ws://127.0.0.1`, not `ws://localhost`, for the relay on macOS.
