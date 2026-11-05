# Ajo on Lightning plan

Ajo on Lightning lets a savings circle (ajo, esusu, tontine) collect and pay out over Bitcoin Lightning. Each member pays the round's payee directly from their own wallet, so nobody holds a pot.
It is for market traders and colleagues in African savings circles. It is also for the Dakar Bitcoin Hack judges, who run it with one command.
The rule the program enforces is that a member is never charged twice and is never shown as failed when the payee has their sats.
The PRs, in order, are PR1 stack and harness, PR2 round core, PR3 wallet and receipt adapters, PR4 phone UI, PR5 reminders, and PR6 docs and pitch.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `pstack/skills/poteto-mode/playbooks/autopilot-stack.md`. The operator lands every PR. Each PR stops at merge-ready and waits for the operator.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

This program runs in Claude Code, not Cursor. Live lanes run on this machine against the Docker stack instead of cloud VMs. Models come from the user's `pstack-models` rule, so the swarm workers run on `claude-opus-5-5`. Bugbot does not exist here, so the bugbot triage boxes are replaced by one `interrogate` pass per PR. The operator chose five live lanes per PR instead of ten, so lint this plan with `PLAN_LANES=5 node scripts/check-plan.mjs docs/plan.md`.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] Read these at program start. Re-read them at every tick.
  - [ ] `pstack/skills/poteto-mode/playbooks/autopilot-stack.md` from the installed plugin.
  - [ ] `pstack/skills/swarm/SKILL.md` from the installed plugin.
  - [ ] `cursor-team-kit/skills/control-ui/SKILL.md` and `cursor-team-kit/skills/control-cli/SKILL.md` from the installed plugin.
  - [ ] `pstack/skills/poteto-mode/playbooks/opening-a-pr.md` from the installed plugin.
  - [ ] `pstack/skills/architect/SKILL.md`, `pstack/skills/tdd/SKILL.md`, `pstack/skills/interrogate/SKILL.md`, `pstack/skills/technical-writing/SKILL.md`, `pstack/skills/unslop/SKILL.md`, and `pstack/skills/show-me-your-work/SKILL.md` from the installed plugin.
  - [ ] `git show origin/main:.claude/skills/verify-ajo/SKILL.md` once PR1 has merged.
- [ ] On the operator's go, arm the audit tick as `/loop 1h` with the tick prompt below. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from trunk. Audit the operation against it and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one `pstack:poteto-agent` owner per PR with the full lifecycle the execution playbook names.
- [ ] Follow this dependency graph. Each PR stacks on its parent branch.
  - [ ] PR1 is first and branches from `main`.
  - [ ] PR2 after PR1.
  - [ ] PR3 after PR2.
  - [ ] PR4 after PR3.
  - [ ] PR5 after PR4.
  - [ ] PR6 after PR5. Its owner may start drafting docs once PR3 is code-ready, in its own worktree.
- [ ] Hold the file boundaries.
  - [ ] PR1 touches only `docker-compose.yml`, `seed/**`, `scripts/**` including `scripts/check-plan.mjs`, `.claude/skills/verify-ajo/**`, `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`, and `docs/plan.md`.
  - [ ] PR2 touches only `src/round/**` and `test/round/**`.
  - [ ] PR3 touches only `src/wallet/**`, `src/receipts/**`, `src/store/**`, `src/run-round.ts`, `test/adapters/**`, the new `app` service in `docker-compose.yml`, and its dependencies in `package.json` and `package-lock.json`.
  - [ ] PR4 touches only `src/web/**`, `public/**`, `.claude/skills/verify-ajo/features/**`, the `app` service ports in `docker-compose.yml`, and its dependencies in `package.json` and `package-lock.json`.
  - [ ] PR5 touches only `src/reminders/**`, `test/reminders/**`, and its dependencies in `package.json` and `package-lock.json`.
  - [ ] PR6 touches only `README.md`, `docs/**`, and `model/**`.
- [ ] Hold the review gate. PR4 and PR5 change an interaction. They wait for the operator's review in chat with screenshots and a video before merge.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`; if `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Never require `gt`.
- [ ] Open the PR ready, never draft, per **Opening a PR**. Use `gh pr create --base <base-branch>`. A stack child targets its parent branch. The repo is `mohammedfirdouss/ajo-lightning`.
- [ ] Run `npm run lint` and `npm run typecheck` once before the PR-facing push. Push with hooks on.
- [ ] Run `/deslop` before each commit and `/no-comments` before review.
- [ ] Run `interrogate` over each PR diff in place of Bugbot. Triage its verified findings per `../references/bugbot-triage.md`.
- [ ] Rebase onto current trunk before the code-ready report and babysit. Keep that merge base in fix rounds. Rebase again only at merge prep, on a `git merge-tree` conflict with trunk, on a CI failure that comes from a change on trunk, or when a known concurrent change to the same files lands.
- [ ] Write commit messages with no Co-Authored-By trailer.

### Verdict and merge, for every PR

- [ ] A full swarm runs once, at the code-ready head. Another full swarm runs only for new behavior, a redesign, or a large new diff. A rebase, a merge-conflict resolution, or a minor fix gets a single verifier at the new head, and a wording-only change gets none. Run each full swarm per `pstack/skills/swarm/SKILL.md`. One gates lane. The five live lanes from the PR's **Verify, live** block. The perf lane from its **Verify, perf** block. Two or more audit lanes, each with its own focus, that read the diff and the receipts and distrust the PR body. The root audits the receipts in the merge-ready report before the verdict.
- [ ] Judge every finding by the execution playbook's blocking rule. The verdict is clean when none blocks. A failure on trunk behavior in a lane marked `Regression lane against trunk.` is recorded against trunk and does not block the PR. A new head gets a fresh verdict, except for results that stay valid under the patch-id rule in `playbooks/shipping.md`.
- [ ] The root appends each verified PR to the stack and reports it merge-ready. The operator lands the stack bottom-up. A result stays valid after a rebase only when the patch-id is unchanged, per `playbooks/shipping.md`.

### Boot recipe, for every live lane

Each live lane runs on this machine at the PR head, in its own git worktree and its own Docker Compose project name. Drive through `control-ui` or `control-cli` from `cursor-team-kit`.

- [ ] `git fetch origin <head-branch> && git checkout <head SHA>` inside `git worktree add /tmp/ajo-lane-<n>`.
- [ ] Run `COMPOSE_PROJECT_NAME=ajo-lane-<n> ./scripts/up`. Wait for the log line `seed done` and for `./scripts/doctor` to exit 0.
- [ ] Drive the app only through the control skill commands named in `.claude/skills/verify-ajo/SKILL.md`. Read-only diagnostics are `./scripts/doctor`, `docker compose logs`, and the hub `GET /api/channels` call.
- [ ] Save every screenshot to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png` and return the paths with the report.
- [ ] Tear down with `COMPOSE_PROJECT_NAME=ajo-lane-<n> docker compose down -v` and `git worktree remove /tmp/ajo-lane-<n>`.

## Stand up the Lightning stack and the failing harness (PR1)

**Depends on.** None.

**Files.**

- [ ] Create `docker-compose.yml` from `spike/node-per-member` commit 2efe05b, with pinned images `ghcr.io/getalby/hub:v1.24.6`, `bitcoin/bitcoin:28.1`, and `scsibug/nostr-rs-relay:0.9.0`.
- [ ] Create `seed/seed.sh` and a one-shot `seed` service in compose, so a bare `docker compose up` seeds.
- [ ] Create `scripts/up`, `scripts/doctor`, and `scripts/e2e`.
- [ ] Create `.claude/skills/verify-ajo/SKILL.md` per the `create-verification-skill` skill, for the CLI surface.
- [ ] Create `package.json` with `lint`, `typecheck`, and `test` scripts.

**Build.**

- [ ] Port the spike's eight setup stages into `seed/seed.sh`. That covers the hubs, the alias restart, on-chain funding, the batched public channels, the router fee patch, the gossip wait, the push, and the app connections. Pay connections get a budget of contribution plus max(1%, 10 sat).
- [ ] Write `scripts/e2e` with the four checks from `PLAN.md`. Each check reads wallet state from the hub API, never from app state.
- [ ] Write the `verify-ajo` skill and prove it once per its own step 4.

**You see.**

- [ ] `docker compose up` prints `seed done` with five member hubs and one router hub, each with an active channel.
- [ ] `./scripts/e2e` exits 1 and prints `FAIL check 1 no round runner yet`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `scripts/e2e` self-test with a fake hub URL that returns a known balance, so the balance-delta assertion is proven to fail and pass. Run `npm test -- e2e-selftest`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Five lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `docker compose up` at trunk and head. Trunk has no stack, so record that and gate the head reaching `seed done`. Save `pr1-boot.png`. Pass when head prints `seed done` and `./scripts/doctor` exits 0.
- [ ] Lane 2. Cold boot from an empty volume with `docker compose down -v`, then a warm `docker compose restart`. Save `pr1-cold-warm.png`. Pass when every hub reports one active channel after the cold boot, and again within 10 seconds of the restart.
- [ ] Lane 3. Run the spike flow script against the stack. Save `pr1-route.png`. Pass when member2 falls by 1001, member1 rises by 1000, an over-budget pay returns `QUOTA_EXCEEDED`, and a receive connection pay returns `RESTRICTED`.
- [ ] Lane 4. Secrets audit with `git ls-files` and `docker compose logs`. Save `pr1-secrets.png`. Pass when no `nostr+walletconnect://` string appears in git or logs, and `./scripts/e2e` exits 1 with `FAIL check 1`.
- [ ] Lane 5. Follow `.claude/skills/verify-ajo/SKILL.md` cold, as a fresh agent, in a second Compose project beside lane 1. Save `pr1-skill.png`. Pass when launch, doctor, one drive, and cleanup succeed with no port clash and the evidence survives cleanup.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Seconds from `docker compose up` to `seed done` with images already pulled, and seconds from restart to first routed payment.
- [ ] Probe. Time three cold boots and three warm restarts with `time`, interleaved, on head. Trunk has no stack, so measure the spike branch as the baseline.
- [ ] Baseline. Record the spike numbers first, 31 seconds cold and 4 seconds warm.
- [ ] Rule. Fail when the cold median exceeds 60 seconds or the warm median exceeds 10 seconds.

**Review gate.** None. PR1 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Interrogate triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The root appends PR1 to the base-branch stack and the operator lands it bottom-up.

## Build the round core that never double-charges (PR2)

**Depends on.** PR1.

**Files.**

- [ ] Create `src/round/types.ts` with branded `Sats`, `MemberId`, `RoundId`, and the discriminated unions for round and contribution state.
- [ ] Create `src/round/round.ts` with a pure reducer from events to state.
- [ ] Create `test/round/round.test.ts`.

**Build.**

- [ ] Run `architect` with two structurally distinct sketches of the reducer and its event set, then implement the synthesis. The contract is the fixed rules in `model/AjoRound.tla`.
- [ ] Encode one invoice per round and payer, reused on every retry. Errors from `pay_invoice` only set `lastErr`. Only `lookup_invoice` reporting expired unpaid sets `failed(reason)`. The round closes only when every contribution is paid or failed and no pay call is outstanding.
- [ ] Write the tests first per the `tdd` skill.

**You see.**

- [ ] `npm test -- round` prints both model bug paths as passing tests named after the rule they protect.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/round/round.test.ts` replays the 8-step timeout path and the 11-step crash then over-budget path from `model/report-naive.md`, one event per model step. Run `npm test -- round`.
- [ ] A property test over random event orders asserts the five model rules. Run `npm test -- round-props`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Five lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `./scripts/e2e` at trunk and head. Trunk lacks the core, so record that and gate head still booting to `seed done`. Save `pr2-boot.png`. Pass when the stack boots and e2e fails only on the missing runner.
- [ ] Lane 2. Replay the timeout path and the crash then over-budget path from `model/report-naive.md` through the reducer. Save `pr2-bug-paths.png`. Pass when both contributions end `paid`, not failed.
- [ ] Lane 3. Feed a retry that tries to mint a second invoice. Save `pr2-reuse.png`. Pass when the reducer rejects it and keeps the stored invoice.
- [ ] Lane 4. Close a round with one pay call outstanding, then let one invoice expire unpaid after `QUOTA_EXCEEDED`. Save `pr2-partial.png`. Pass when the round stays `collecting` until the call returns, then ends `partial` with that contribution `failed(QUOTA_EXCEEDED)`.
- [ ] Lane 5. Run the property test with 10000 runs, and map each model action in `model/AjoRound.tla` to a reducer event. Save `pr2-props.png`. Pass when no counterexample is found and no model action is unmapped.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Wall time of `npm test -- round` and `npm test -- round-props`.
- [ ] Probe. Run each three times at head with `time`. Trunk has no tests, so set an absolute budget.
- [ ] Baseline. Record that trunk has no round tests.
- [ ] Rule. Fail when either suite median exceeds 5 seconds.

**Review gate.** None. PR2 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Interrogate triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The root appends PR2 to the base-branch stack and the operator lands it bottom-up.

## Wire NWC payments and Nostr receipts to the core (PR3)

**Depends on.** PR2.

**Files.**

- [ ] Create `src/wallet/nwc.ts` around `@getalby/sdk` 9.0.0 `NWCClient`.
- [ ] Create `src/receipts/nostr.ts` around `nostr-tools` 2.25.5.
- [ ] Create `src/store/sqlite.ts` on `node:sqlite`.
- [ ] Create `src/run-round.ts` and `test/adapters/*.test.ts`.

**Build.**

- [ ] Parse every NWC reply at the boundary into the core's event union. Branch on `Nip47WalletError.code`, never the message.
- [ ] Persist the invoice for each round and payer before the first `pay_invoice`. On start, call `lookup_invoice` for every open contribution.
- [ ] Publish one signed receipt event per paid contribution, carrying round, pseudonymous payer id, amount, and payment hash. No names, phone numbers, or NWC secrets.
- [ ] Keep NWC secrets in the database encrypted with a key from `.env`, and never log them.
- [ ] Match the runner contract PR1 fixed in `scripts/e2e.ts`. `node src/run-round.ts <round>` exits 0 when the round ran, its last stdout line is the `RoundReport` JSON, and each receipt is a Nostr event tagged `t` `ajo-receipt` carrying the payment hash.

**You see.**

- [ ] `./scripts/e2e` exits 0 with `PASS check 1`, `PASS check 2`, `PASS check 3`, and `PASS check 4`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/adapters/nwc.test.ts` maps each NWC error code to the right event. Run `npm test -- adapters`.
- [ ] `test/adapters/receipts.test.ts` asserts the receipt event has no field outside the allowed set. Run `npm test -- adapters`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Five lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `./scripts/e2e` at trunk and head. Save `pr3-e2e.png`. Pass when trunk fails check 1 and head passes all four checks.
- [ ] Lane 2. Kill the app container mid-round with `docker compose kill app`, start it, then run the same round again. Save `pr3-crash.png`. Pass when no payer is charged twice, the rerun moves zero sats, and the record matches the wallets.
- [ ] Lane 3. Pause the router container during a payment, then unpause. Save `pr3-timeout.png`. Pass when a late-settled payment ends `paid`, never failed.
- [ ] Lane 4. Pre-spend member3's budget, then run a round. Save `pr3-quota.png`. Pass when member3 ends `failed(QUOTA_EXCEEDED)` after invoice expiry and the round is `partial`.
- [ ] Lane 5. Read receipts from the relay with a nostr-tools script, and grep app logs and the database file for `nostr+walletconnect://` and member names. Save `pr3-receipts.png`. Pass when there is one valid signed event per paid contribution and no secret or name appears in plain text.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Milliseconds from round start to round complete for four payers.
- [ ] Probe. Run five rounds at head interleaved with five runs of the spike flow script on `spike/node-per-member`. Both produce the metric.
- [ ] Baseline. Record the spike median first, about 1200 milliseconds for four payments of 247 to 351 milliseconds each.
- [ ] Rule. Fail when the head median exceeds the spike median by more than 50 percent or exceeds 3000 milliseconds.

**Review gate.** None. PR3 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Interrogate triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The root appends PR3 to the base-branch stack and the operator lands it bottom-up.

## Ship the phone-first circle pages (PR4)

**Depends on.** PR3.

**Files.**

- [ ] Create `src/web/server.ts` with Hono and server-rendered HTML.
- [ ] Create `src/web/pages/*.ts` for circle, join, round, and receipts.
- [ ] Create `public/app.css` and at most one small `public/app.js`.
- [ ] Extend `.claude/skills/verify-ajo/features/` with one file per page.

**Build.**

- [ ] Prototype two layouts of the round page per the `prototype` playbook and pick by screenshot on a 360 px wide viewport.
- [ ] Members join by pasting or scanning a pay and a receive NWC link, with the cap shown in sats and in naira.
- [ ] The round page shows each member as paid, waiting, or not paid with a plain reason. The copy says "over your limit" for `QUOTA_EXCEEDED` and "not enough money" for `INSUFFICIENT_BALANCE`.
- [ ] Contrast passes WCAG AA and tap targets are at least 44 px.

**You see.**

- [ ] On a 360 px wide screen, pressing "Collect this round" turns each member row green as their payment lands.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/web/pages.test.ts` renders each page from fixture state and asserts the visible status words. Run `npm test -- web`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Five lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `./scripts/e2e` at trunk and head. Save `pr4-e2e.png`. Pass when both pass all four checks.
- [ ] Lane 2. Create a circle and join with a pasted pay link and receive link on a 360 px viewport. Save `pr4-create-join.png`. Pass when the circle lists five members in payout order with each cap in sats and naira.
- [ ] Lane 3. Collect a round, reloading the page once mid-round. Save `pr4-collect.png`. Pass when all four payer rows show paid, member1 wallet rises by 4000, and no payment repeats after the reload.
- [ ] Lane 4. Collect with member3 over the limit. Save `pr4-quota.png`. Pass when member3 shows "over your limit" in plain words.
- [ ] Lane 5. Throttle to slow 3G and run an axe scan on the round page. Save `pr4-slow-a11y.png`. Pass when the page is usable within 3 seconds with zero serious or critical issues.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Transferred bytes and time to interactive for the round page.
- [ ] Probe. Load the round page five times on slow 3G at head. Trunk has no UI, so set absolute budgets.
- [ ] Baseline. Record that trunk serves no page.
- [ ] Rule. Fail when the round page exceeds 50 KB transferred or 3 seconds to interactive on slow 3G.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 4 and lane 5 screenshots into `docs/media/pr4-review-collect.png` and `docs/media/pr4-review-quota.png`.
- [ ] Record a 30 to 60 second video of a round on a 360 px viewport. Save it as `docs/media/pr4-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Interrogate triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The root appends PR4 to the base-branch stack and the operator lands it bottom-up.

## Send reminders in the members' own language (PR5)

**Depends on.** PR4.

**Files.**

- [ ] Create `src/reminders/reminders.ts` and `src/reminders/templates.ts`.
- [ ] Create `test/reminders/reminders.test.ts`.

**Build.**

- [ ] Load the `claude-api` skill before writing the client. Use the current Claude model it names.
- [ ] Generate a short reminder in English, Nigerian Pidgin, Yoruba, French, or Wolof from round state only. Send no names or phone numbers to the model.
- [ ] Fall back to fixed templates when `ANTHROPIC_API_KEY` is absent or the call fails or takes over 5 seconds.
- [ ] Show each reminder on the member row with a copy button for WhatsApp.

**You see.**

- [ ] Without an API key, each waiting member row shows a template reminder in the chosen language.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/reminders/reminders.test.ts` asserts the prompt payload holds no member name and that the fallback fires on timeout. Run `npm test -- reminders`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Five lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Collect a round at trunk and head. Save `pr5-collect.png`. Pass when both pay the payee 4000 and head also shows reminders.
- [ ] Lane 2. No API key, in English and Yoruba. Save `pr5-template.png`. Pass when a template reminder shows for each waiting member in the chosen language.
- [ ] Lane 3. With an API key, in Pidgin, French, and Wolof. Save `pr5-ai.png`. Pass when each generated reminder names the amount and due date, and a Wolof speaker check is listed as open if none is available.
- [ ] Lane 4. Block outbound network to the API. Save `pr5-fallback.png`. Pass when the template shows within 5 seconds.
- [ ] Lane 5. Capture the outbound request body. Save `pr5-payload.png`. Pass when it holds no member name, phone number, or NWC secret.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Round page time to interactive with reminders, and reminder generation time.
- [ ] Probe. Load the round page five times at trunk and head on slow 3G, interleaved.
- [ ] Baseline. Record the trunk round page time first.
- [ ] Rule. Fail when head exceeds trunk by more than 300 milliseconds, or reminder generation exceeds 5 seconds before fallback.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2 and lane 4 screenshots into `docs/media/pr5-review-template.png` and `docs/media/pr5-review-ai.png`.
- [ ] Record a 30 to 60 second video of reminders appearing during a round. Save it as `docs/media/pr5-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Interrogate triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The root appends PR5 to the base-branch stack and the operator lands it bottom-up.

## Write the README, threat model, and pitch (PR6)

**Depends on.** PR5.

**Files.**

- [ ] Edit `README.md`.
- [ ] Create `docs/threat-model.md`, `docs/architecture.md`, `docs/demo-script.md`, and `docs/devpost.md`.
- [ ] Create `model/` with the TLA+ spec, configs, view, and both charts.

**Build.**

- [ ] Write under `technical-writing`, then `unslop`. README covers setup, the architecture diagram, constraints, metrics to track, and the next iteration, as the judging criteria ask.
- [ ] The threat model lists assets, actors, trust boundaries, and each control with its evidence, including the TLA+ result and the interrogate findings.
- [ ] State the honest limits. The router keeps the 50k sat push as bought inbound liquidity, the demo runs on regtest, and Machankura receive is custodial.
- [ ] The demo script fits three minutes, problem then solution then impact then next steps.

**You see.**

- [ ] A fresh reader following only the README reaches a collected round.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `PLAN_LANES=5 node scripts/check-plan.mjs docs/plan.md` and a link check over `README.md` and `docs/`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Five lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `./scripts/e2e` at trunk and head. Save `pr6-e2e.png`. Pass when both pass all four checks.
- [ ] Lane 2. Fresh clone, follow the README quickstart only. Save `pr6-quickstart.png`. Pass when a round is collected with every command run exactly as written.
- [ ] Lane 3. Rerun the TLA+ commands in `model/README.md` and render the architecture diagram on GitHub. Save `pr6-model.png`. Pass when the fixed config reports no error and the diagram matches the compose services.
- [ ] Lane 4. Check each threat model control against its evidence pointer, and search docs for secrets, real names, and phone numbers. Save `pr6-threats.png`. Pass when every pointer resolves and none appear.
- [ ] Lane 5. Time the demo script read aloud against the app, and read the docs as a judge. Save `pr6-demo.png`. Pass when it fits within 3 minutes and each judging criterion maps to a section.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Minutes from fresh clone to first collected round following the README, images already pulled.
- [ ] Probe. Time three fresh-clone runs at head. Trunk has no README quickstart, so set an absolute budget.
- [ ] Baseline. Record that trunk has no quickstart.
- [ ] Rule. Fail when the median exceeds 3 minutes.

**Review gate.** None. PR6 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Interrogate triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The root appends PR6 to the base-branch stack and the operator lands it bottom-up.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Run the `show-me-your-work` audit and cross-model review over `decisions.tsv`.
- [ ] Run `reflect` over the transcript.
- [ ] Reply to the operator with the report the execution playbook names.

## Appendix A. Prototype evidence

- Branch `spike/nwc-regtest`, commit 804a974. One Alby Hub, isolated connections, budget refusal `QUOTA_EXCEEDED`, scope refusal `RESTRICTED`. Payments were database self-payments, so this layout was rejected.
- Branch `spike/two-hub`, commit ebd7264. A real channel between two hubs routed cross-hub payments, with channel deltas of minus 3000 and plus 3000. Budgets need a fee reserve of max(1%, 10 sat). Transfers into isolated apps are unbacked.
- Branch `spike/node-per-member`, commit 2efe05b. One hub per member plus a router. Each payer fell by 1001, member1 rose by 4000, and the router gained 4. Budgets hold on non-isolated connections. Warm restart takes 4 seconds. RAM is 450 to 800 MiB.
- `model/AjoRound.tla`. The naive retry design never double-charges but can show a paid member as failed in 8 or 11 steps. The fixed design holds all five rules and liveness over 7,280,499 states. Minting a new invoice on retry double-charges in 11 steps.
- Unproven. Hosting on Mutinynet, Wolof reminder quality, and whether the organisers accept NWC as the wallet implementation.

## Appendix B. Alternatives rejected

- One hub with isolated sub-wallets. Payments never cross a channel and one hub custodies everyone.
- Two hubs with isolated sub-wallets. Each hub still custodies its members, and funding is unbacked ledger credit.
- A pot held by the app. It is the exact failure the product exists to remove.
- LNbits. Not needed once Alby Hub worked, and its wallets are custodial accounts on one node.
- Breez SDK Greenlight and Liquid. Deprecated or migration advised.
- A single-page React app. Heavier on slow networks than server-rendered pages.

## Appendix C. Risks

- Organiser eligibility. The Devpost "Students only" tag may exclude the operator. Watched outside the PRs.
- Wallet implementation rule. If NWC does not count, PR3 adds a BDK on-chain wallet. Watched by the PR3 owner.
- RAM on judges' laptops. Six hubs need up to 800 MiB. The PR1 owner documents a `MEMBERS=3` mode.
- Channel gossip timing. A round before gossip settles fails with `RouteNotFound`. The PR1 seed waits on the network graph.
- Relay image is amd64 only. It runs under emulation on Apple Silicon. The PR1 owner checks for an arm64 relay.
- Time. BountyPay is due 12 Nov and this is due 20 Nov. PR4 and PR5 review gates need the operator.

## Appendix D. Links and reading list

- `PLAN.md` for the definition of done and data shape.
- `research.md` for the stack facts and sources.
- `model/` for the TLA+ spec and charts.
- PR2 and PR3 get `pstack/skills/how/SKILL.md` over the prior PR and `pstack/skills/interrogate/SKILL.md` over their diff.
- The trail lives in `decisions.tsv` per `pstack/skills/show-me-your-work/SKILL.md`. It stays local unless the operator asks to commit it.
