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
- `$RUN/connections.json` exists, per the skill's Drive section.

- **Restart.** Run `t0=$(date +%s); docker compose restart`. Then wait with `until [ "$(docker compose ps -a --format '{{.ExitCode}} {{.State}}' seed)" = "0 exited" ]; do sleep 0.3; done; echo "seed done after $(( $(date +%s) - t0 ))s"`. It prints about 4 seconds.
- **Channels back.** Run `cap warm-doctor ./scripts/doctor`. It ends with `exit=0`.
- **Routed payment.** Define a helper that pays 1 sat from member2 to member1 through the router with the hub API, then capture it. The helper reads tokens from `$RUN`, so none reach the transcript.

	```bash
	pay_one() {
		local inv
		m() { jq -r --arg n "$1" ".members[]|select(.name==\$n)|.$2" "$RUN/connections.json"; }
		inv=$(curl -sf -XPOST "$(m member1 url)/api/invoices" -H "authorization: Bearer $(m member1 token)" -H 'content-type: application/json' -d '{"amountSat":1,"description":"warm check"}' | jq -r .invoice)
		curl -sf -XPOST "$(m member2 url)/api/payments/$inv" -H "authorization: Bearer $(m member2 token)" -H 'content-type: application/json' -d '{}' | jq -c '{preimage: (.preimage|.[0:16])}'
	}
	cap warm-payment pay_one
	```

	The transcript holds a preimage and ends with `exit=0`.

## Gotchas

- `docker compose restart` also restarts the exited seed container. That is how the re-peer runs. A restart that skips the seed waits up to a minute for channels.
- Hub tokens rotate on every seed run. Copy `connections.json` again after a restart.
