#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PW=spike-unlock-pw
HUB=http://localhost:8080
C=${CONTRIBUTION:-1000}
N=${MEMBERS:-5}
OUT=connections.json

bcli() { docker compose exec -T bitcoind bitcoin-cli -regtest -rpcuser=spike -rpcpassword=spike "$@"; }
api() { local m=$1 p=$2; shift 2; curl -sS -f -X "$m" "$HUB$p" -H 'content-type: application/json' ${TOKEN:+-H "authorization: Bearer $TOKEN"} "$@"; }

t0=$(date +%s)
docker compose up -d

until bcli getblockchaininfo >/dev/null 2>&1; do sleep 1; done
bcli loadwallet miner >/dev/null 2>&1 || bcli createwallet miner >/dev/null 2>&1 || true
if [ "$(bcli getblockcount)" -lt 101 ]; then
  bcli generatetoaddress 101 "$(bcli -rpcwallet=miner getnewaddress)" >/dev/null
fi

until curl -sf "$HUB/api/info" >/dev/null; do sleep 1; done
if [ "$(api GET /api/info | jq -r .setupCompleted)" != true ]; then
  api POST /api/setup -d "{\"backendType\":\"LDK\",\"unlockPassword\":\"$PW\"}" >/dev/null
fi
if [ "$(api GET /api/info | jq -r .running)" != true ]; then
  api POST /api/start -d "{\"unlockPassword\":\"$PW\"}" >/dev/null
fi
until [ "$(api GET /api/info | jq -r .running)" = true ]; do sleep 1; done
TOKEN=$(api POST /api/unlock -d "{\"unlockPassword\":\"$PW\",\"permission\":\"full\"}" | jq -r .token)
echo "hub running after $(( $(date +%s) - t0 ))s: $(api GET /api/info | jq -c '{version,network,backendType}')"

if [ -f "$OUT" ]; then echo "$OUT exists, keeping existing connections"; exit 0; fi

create_app() {
  sleep 1 # POST /api/apps shares the unlock-password rate limiter: 1 req/s, burst 2
  api POST /api/apps -d "$(jq -nc --arg name "$1" --argjson scopes "$2" --argjson max "$3" --arg pw "$PW" \
    '{name:$name, scopes:$scopes, maxAmountSat:$max, budgetRenewal:"monthly", isolated:true, unlockPassword:$pw}')"
}

members='[]'
for i in $(seq 1 "$N"); do
  pay=$(create_app "member$i-pay" '["pay_invoice","get_balance"]' "$C")
  recv=$(create_app "member$i-receive" '["make_invoice","lookup_invoice","get_balance"]' 0)
  api POST /api/transfers -d "{\"toAppId\":$(jq .id <<<"$pay"),\"amountSat\":$((3 * C))}"
  members=$(jq -c --arg n "member$i" --argjson p "$pay" --argjson r "$recv" \
    '. + [{name:$n, pay:{id:$p.id, uri:$p.pairingUri}, receive:{id:$r.id, uri:$r.pairingUri}}]' <<<"$members")
done
jq -n --argjson c "$C" --argjson m "$members" '{contributionSat:$c, members:$m}' > "$OUT"
echo "wrote $OUT with $N members, each pay connection funded with $((3 * C)) sats, budget $C sats/month"
