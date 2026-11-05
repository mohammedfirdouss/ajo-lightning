---
name: verify-ajo
description: Launch, check, drive, and tear down the Ajo on Lightning regtest stack (bitcoind, a Nostr relay, a router hub, member Alby Hubs, and the web pages) from the terminal and a 360 px browser, and capture evidence. Use to prove a change to the stack, the seed, scripts/doctor, scripts/e2e, scripts/route, a round runner, or the circle pages on the real stack, or when a live verification lane says to follow verify-ajo.
---

# Verify Ajo on Lightning

There are two surfaces. On the CLI, `scripts/up`, `scripts/doctor`, `scripts/route`, and `scripts/e2e` drive a Docker Compose stack, and the hub HTTP API and the relay show its state. The web pages in `src/web` are the `web` service of the same stack, served at `http://127.0.0.1:$WEB_PORT`. They collect real rounds over NWC. `AJO_SOURCE=fake npm run web` serves them on in-memory wallets instead, as [web-circle.md](features/web-circle.md) shows. Each feature has a recipe in [features/README.md](features/README.md).

Requirements: Docker, `jq`, and Node 22.18 or newer on `PATH`. Run `npm ci` once in the worktree. Drive the pages with Playwright from a scratch dir, never as a project dependency.

## Set up one isolated run

Every run gets its own Compose project, host ports, a private scratch dir for secrets, and an evidence dir. Two runs on one machine must differ in all four. Run this block once. It picks the first hub port prefix from 820 whose six hub ports, relay port, and web port no listening socket and no container, running or stopped, already claims. It writes the resolved values to an env file.

```bash
taken() { { lsof -iTCP -sTCP:LISTEN -nP; docker ps -aq | xargs docker inspect --format '{{json .HostConfig.PortBindings}}'; } 2>/dev/null | grep -qE "[:\"](${1}[0-5]|$2|$3)[\" ]"; }
p=820; while taken $p "7${p#8}0" "6${p#8}0"; do p=$((p + 1)); done
name=ajo-verify-$(date +%s)
mkdir -p /tmp/verify-ajo "/tmp/verify-ajo/$name" && mkdir -m 700 "/tmp/verify-ajo/$name.run"
cat > "/tmp/verify-ajo/$name.env" <<EOF
export COMPOSE_PROJECT_NAME=$name HUB_PORT_PREFIX=$p RELAY_PORT=7${p#8}0 WEB_PORT=6${p#8}0
export RUN=/tmp/verify-ajo/$name.run EVIDENCE=/tmp/verify-ajo/$name
cap() { local slug=\$1; shift; { echo "\\\$ \$*"; "\$@"; echo "exit=\$?"; } 2>&1 | tee "\$EVIDENCE/\$slug.txt"; }
EOF
echo "source /tmp/verify-ajo/$name.env"
```

The block prints a line such as `source /tmp/verify-ajo/ajo-verify-1762345678.env`. Run that line at the start of every shell, including each new shell your tool starts per command. It sets the same values every time, so it is safe to source again. Run every command below from the repo root.

`cap <slug> <command>` saves the command, its output, and its exit code to `$EVIDENCE/<slug>.txt`. It always returns 0, so read the `exit=` line. `$RUN` holds secrets and is never evidence.

Before launch, run `docker compose ls -a | grep "$COMPOSE_PROJECT_NAME"` and require no output.

## Launch

```bash
cap up ./scripts/up # add MEMBERS=3 in front to start 3 member hubs instead of 5
```

Ready means the transcript holds a line such as `seed-1  | [13s] seed done: router and 5 member hubs each have an active channel, pay budget 1010 sat a month for a 1000 sat contribution` and ends with `exit=0`. A cold boot takes about 15 seconds with images pulled. The first run also builds the small `seed` image. A bare `docker compose up` prints the same `seed done` line in the foreground, then starts the `web` service and keeps running.

`scripts/up` does not start the pages. To serve them, run:

```bash
cap web docker compose up -d --build --no-deps web
```

Ready means `curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$WEB_PORT/"` prints `200`. The image holds the code, so rerun the command with `--build` after each change.

## Doctor

```bash
cap doctor ./scripts/doctor
```

It is read-only. It reads `connections.json` from the `state` volume, then checks that the relay answers NIP-11 and that every hub's node runs with its channels active, using this project's read-only hub tokens. A hub from another project rejects those tokens, so `ok` lines prove the ports are ours. Exit 0 means the stack is worth driving. Run it first whenever anything looks off.

## Drive

Pick a recipe from the feature map. Each one names exact commands and the state that proves it. Read hub state only through the hub API, and never trust what a round runner says about balances.

`connections.json` holds the NWC pairing URIs and read-only hub tokens. The tokens can read balances, channels, and apps, and the hub answers 403 to anything that spends, mints, or changes the node. Copy the file to the private scratch dir only, never to the evidence dir:

```bash
docker compose run --rm --no-deps -T --entrypoint cat seed /state/connections.json > "$RUN/connections.json"
```

## Evidence

- Save each command transcript with `cap`, which records the exit code. Lanes that ask for a `.png` accept the `.txt` transcript of the same step.
- For a payment, capture the absolute balance of each hub involved before and after, and the delta between them. `scripts/route` prints all three.
- Prove side effects on the system that owns them. Use hub `/api/channels` for balances and the relay for receipts.
- Save each page screenshot at a 360 by 740 viewport to `$EVIDENCE/<slug>.png`. The link fields mask what is typed, so a filled form is safe to capture.
- Never write a `nostr+walletconnect://` URI, a `secret=` value, or a hub token into `$EVIDENCE`. Before handing over, run `grep -rlE 'nostr\+walletconnect|secret=|eyJhbGci' "$EVIDENCE"` and require no output.

## Cleanup

```bash
docker compose down -v --rmi local
rm -rf "/tmp/verify-ajo/${COMPOSE_PROJECT_NAME:?}.run"
ls "$EVIDENCE"
```

`down -v` removes only this project's containers and volumes. The evidence dir survives, and `ls` proves it. Never run `docker compose down` without `COMPOSE_PROJECT_NAME` set, because the project name in `docker-compose.yml` is the default `ajo`.
