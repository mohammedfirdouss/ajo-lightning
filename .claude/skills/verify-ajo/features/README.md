# Ajo on Lightning verification map

This directory is the maintained source for proving what the stack does for a user. Set up a run per [the skill](../SKILL.md), then use the matching feature file as the recipe.

## Baseline preconditions

- Docker is running, and the run's `COMPOSE_PROJECT_NAME`, `HUB_PORT_PREFIX`, `RELAY_PORT`, `RUN`, and `EVIDENCE` are set.
- Node 22.18 or newer is on `PATH`, and `npm ci` has run in the repo.
- `./scripts/doctor` exits 0, unless the recipe is the boot itself.
- Never drive a Compose project that this run did not start.

## Driving conventions

- Run every command from the repo root. Wrap each proof step in `cap <slug>`.
- Read balances from hub `/api/channels` and receipts from the relay. A runner's own report is a claim, not proof.
- Keep `connections.json` in `$RUN`. It holds NWC secrets and hub tokens.

## Proof and skip reporting

- CLI proof is the command, its output, and its exit code.
- Payment proof is the hub balance on both sides, before and after.
- Report a step you could not reach with the command you ran and the precondition that failed. Never report it as verified through another path.

## Feature entry contract

Each feature file has an H1, one paragraph on the user-visible behavior, and four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with scripts and the hub API`, and `Gotchas`.

## Features

- [Boot the stack](./boot.md) covers a cold boot, a bare `docker compose up`, `MEMBERS`, and the doctor.
- [Restart warm](./warm-restart.md) covers `docker compose restart` and how fast channels and payments come back.
- [Route a payment](./routed-payment.md) covers a two-hop payment, the pay budget refusal, and the receive-only refusal.
- [Run the e2e checks](./e2e.md) covers `scripts/e2e` and its self-test.
