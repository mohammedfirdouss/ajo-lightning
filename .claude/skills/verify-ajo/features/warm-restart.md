# Restart warm

After `docker compose restart`, the seed service runs again, re-peers any member whose channel is down, and channels and payments come back in a few seconds instead of LDK's one-minute reconnect timer.

## Sub-features

- `warm-channels` brings every channel back to active.
- `warm-payment` routes a payment soon after the restart.

## How to get to it (user POV)

- Run `docker compose restart` on a seeded stack.

## Driving it with scripts and the hub API

Preconditions:

- `./scripts/doctor` exits 0.
- member3 has not paid this month.

- **Restart.** Run `t0=$(date +%s); docker compose restart`. Then wait with `until [ "$(docker compose ps -a --format '{{.ExitCode}} {{.State}}' seed)" = "0 exited" ]; do sleep 0.3; done; echo "seed done after $(( $(date +%s) - t0 ))s"`. It prints about 4 seconds.
- **Channels back.** Run `cap warm-doctor ./scripts/doctor`. It ends with `exit=0`.
- **Routed payment.** Run `cap warm-payment ./scripts/route member3` within a few seconds of the seed finishing. Every line starts with `ok`, and the transcript ends with `exit=0`. Use a payer that has not paid this month, per [Route a payment](./routed-payment.md).

## Gotchas

- `docker compose restart` also restarts the exited seed container. That is how the re-peer runs. A restart that skips the seed waits up to a minute for channels.
- Hub tokens rotate on every seed run. Copy `connections.json` again after a restart. The NWC connections stay the same unless `CONTRIBUTION` changed, in which case the seed replaces each pay connection with one capped at the new budget.
