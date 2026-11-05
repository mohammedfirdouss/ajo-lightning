---
name: verify-ajo
description: Launch, check, drive, and tear down the Ajo on Lightning regtest stack (bitcoind, a Nostr relay, a router hub, and member Alby Hubs) from the terminal, and capture evidence. Use to prove a change to the stack, the seed, scripts/doctor, scripts/e2e, or a round runner on the real stack, or when a live verification lane says to follow verify-ajo.
---

# Verify Ajo on Lightning

The surface today is the CLI. `scripts/up`, `scripts/doctor`, and `scripts/e2e` drive a Docker Compose stack, and the hub HTTP API and the relay show its state. There is no web UI yet. Each feature has a recipe in [features/README.md](features/README.md).

## Set up one isolated run

Every run gets its own Compose project, host ports, a private scratch dir for secrets, and an evidence dir. Two runs on one machine must differ in all four.

```bash
export COMPOSE_PROJECT_NAME=ajo-verify-$RANDOM # never reuse a project you did not start
export HUB_PORT_PREFIX=828 RELAY_PORT=7200     # defaults are 818 and 7100; hubs listen on <prefix>0 to <prefix>5
export RUN=$(mktemp -d) EVIDENCE=/tmp/verify-ajo/$COMPOSE_PROJECT_NAME
mkdir -p "$EVIDENCE" && chmod 700 "$RUN"
cap() { local slug=$1; shift; { echo "\$ $*"; "$@"; echo "exit=$?"; } 2>&1 | tee "$EVIDENCE/$slug.txt"; }
```

Run every command below from the repo root with these variables set. `cap <slug> <command>` saves the command, its output, and its exit code to `$EVIDENCE/<slug>.txt`.

## Launch

```bash
cap up ./scripts/up # add MEMBERS=3 in front to start 3 member hubs instead of 5
```

Ready means the last seed line reads `seed done: router and 5 member hubs each have an active channel` and `scripts/up` exits 0. A cold boot takes about 15 seconds with images pulled. The first run also builds the small `seed` image. A bare `docker compose up` does the same in the foreground and prints the same `seed done` line, then keeps running.

## Doctor

```bash
cap doctor ./scripts/doctor
```

It is read-only. It reads `connections.json` from the `state` volume, then checks that the relay answers NIP-11 and that every hub's node runs with its channels active, using this project's hub tokens. A hub from another project rejects those tokens, so `ok` lines prove the ports are ours. Exit 0 means the stack is worth driving. Run it first whenever anything looks off.

## Drive

Pick a recipe from the feature map. Each one names exact commands and the state that proves it. Read hub state only through the hub API with the token from `connections.json`, and never trust what a round runner says about balances.

Copy the secrets to the private scratch dir only, never to the evidence dir:

```bash
docker compose run --rm --no-deps -T --entrypoint cat seed /state/connections.json > "$RUN/connections.json"
```

## Evidence

- Save each command transcript with `cap`, which records the exit code. Lanes that ask for a `.png` accept the `.txt` transcript of the same step.
- Capture the state before and after an action, not only the final state. For payments that means hub balances on both sides.
- Prove side effects on the system that owns them. Use hub `/api/channels` for balances and the relay for receipts.
- Never write a `nostr+walletconnect://` URI, a `secret=` value, or a hub token into `$EVIDENCE`. Before handing over, run `grep -rlE 'nostr\+walletconnect|secret=|eyJhbGci' "$EVIDENCE"` and require no output.

## Cleanup

```bash
docker compose down -v
rm -rf "$RUN"
ls "$EVIDENCE"
```

`down -v` removes only this project's containers and volumes. The evidence dir survives, and `ls` proves it. Never run `docker compose down` without `COMPOSE_PROJECT_NAME` set, because the project name in `docker-compose.yml` is the default `ajo`.
