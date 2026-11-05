# Boot the stack

One command starts bitcoind, a Nostr relay, a router hub, and one Alby Hub per member, then seeds funded, announced channels and NWC connections. Nobody runs a setup step by hand.

## Sub-features

- `boot-up` starts the stack with `scripts/up` and exits with the seed's status.
- `boot-bare` starts it with a bare `docker compose up`.
- `boot-members` starts fewer member hubs with `MEMBERS=3`.
- `boot-doctor` reports whether the stack is worth driving.

## How to get to it (user POV)

- Run `./scripts/up`.
- Run `docker compose up`.
- Run `MEMBERS=3 ./scripts/up` on a laptop with less RAM.

## Driving it with scripts and the hub API

Preconditions:

- No containers exist for `$COMPOSE_PROJECT_NAME`. Check with `docker compose ps -a`.

- **Cold boot.** Run `cap boot-up ./scripts/up`. The transcript ends with `seed done: router and 5 member hubs each have an active channel` and `exit=0`.
- **Doctor.** Run `cap boot-doctor ./scripts/doctor`. Every line starts with `ok`, the router line reads `5 of 5 channels active`, and the transcript ends with `exit=0`.
- **Doctor sees a fault.** Run `docker compose stop member3`, then `cap boot-doctor-fault ./scripts/doctor`. The `member3` and `router` lines start with `FAIL` and the transcript ends with `exit=1`. Run `docker compose start member3 && ./scripts/up` to heal it.
- **Bare compose.** Run `docker compose down -v`, then `docker compose up 2>&1 | tee "$EVIDENCE/boot-bare.txt"` in a second terminal or as a background job. Wait for `seed-1 exited with code 0` in the file, then stop it with `docker compose stop`. The file holds `seed done`.
- **Fewer members.** Run `docker compose down -v`, then `MEMBERS=3 cap boot-members ./scripts/up`. Run `docker compose ps --format '{{.Service}}'`. It lists `member1` to `member3` and no `member4` or `member5`, and `./scripts/doctor` shows `3 of 3 channels active` for the router.

## Gotchas

- `MEMBERS=3 docker compose up` still starts all five hubs and seeds three. Use `scripts/up` to save RAM.
- The relay image is amd64 only. On Apple Silicon it runs under emulation and prints a platform warning.
- The project name defaults to `ajo`. Two runs with the same name share volumes and state.
- A port clash makes `up` fail with `port is already allocated`. Pick another `HUB_PORT_PREFIX` or `RELAY_PORT`.
