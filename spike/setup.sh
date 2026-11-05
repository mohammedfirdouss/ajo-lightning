#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PW=spike-unlock-pw
C=${CONTRIBUTION:-1000}
BUDGET=$(( C + (C / 100 > 10 ? (C + 99) / 100 : 10) )) # hub reserves max(1%, 10 sat) routing fee per non-self payment
CHANNEL_SAT=${CHANNEL_SAT:-500000}
PUSH_SAT=${PUSH_SAT:-50000}
OUT=connections.json
TOKEN_a= TOKEN_b=
huburl() { [ "$1" = a ] && echo http://localhost:8081 || echo http://localhost:8082; }

bcli() { docker compose exec -T bitcoind bitcoin-cli -regtest -rpcuser=spike -rpcpassword=spike "$@"; }
mine() { bcli generatetoaddress "$1" "$(bcli -rpcwallet=miner getnewaddress)" >/dev/null; }
api() { local h=$1 m=$2 p=$3 t; shift 3; t=TOKEN_$h; curl -sS -f -X "$m" "$(huburl $h)$p" -H 'content-type: application/json' ${!t:+-H "authorization: Bearer ${!t}"} "$@"; }
waitfor() { local i; for i in $(seq 1 120); do eval "$1" && return 0; sleep 1; done; echo "timeout: $1" >&2; exit 1; }

t0=$(date +%s)
docker compose up -d

waitfor 'bcli getblockchaininfo >/dev/null 2>&1'
bcli loadwallet miner >/dev/null 2>&1 || bcli createwallet miner >/dev/null 2>&1 || true
[ "$(bcli getblockcount)" -ge 101 ] || mine 101

for h in a b; do
  waitfor "curl -sf $(huburl $h)/api/info >/dev/null"
  [ "$(api $h GET /api/info | jq -r .setupCompleted)" = true ] || api $h POST /api/setup -d "{\"backendType\":\"LDK\",\"unlockPassword\":\"$PW\"}" >/dev/null
  [ "$(api $h GET /api/info | jq -r .running)" = true ] || api $h POST /api/start -d "{\"unlockPassword\":\"$PW\"}" >/dev/null
  waitfor "[ \"\$(api $h GET /api/info | jq -r .running)\" = true ]"
  sleep 1
  eval TOKEN_$h=$(api $h POST /api/unlock -d "{\"unlockPassword\":\"$PW\",\"permission\":\"full\"}" | jq -r .token)
done
echo "hubs running after $(( $(date +%s) - t0 ))s"

if [ -f "$OUT" ]; then
  waitfor '[ "$(api a GET /api/channels | jq "[.[]|select(.active)]|length")" -gt 0 ]' # LDK reconnects the peer up to ~60s after a restart
  echo "$OUT exists, channel A->B active again after $(( $(date +%s) - t0 ))s"; exit 0
fi

addr=$(api a POST /api/wallet/new-address | jq -r .)
bcli -rpcwallet=miner sendtoaddress "$addr" 0.01 >/dev/null
mine 6
waitfor '[ "$(api a POST /api/wallet/sync >/dev/null; api a GET /api/balances | jq .onchain.spendable)" -gt 0 ]'
echo "hub A on-chain: $(api a GET /api/balances | jq -c .onchain)"

b_pubkey=$(api b GET /api/node/connection-info | jq -r .pubkey)
api a POST /api/peers -d "{\"pubkey\":\"$b_pubkey\",\"address\":\"hub-b\",\"port\":9735}" >/dev/null
api a POST /api/channels -d "{\"pubkey\":\"$b_pubkey\",\"amountSats\":$CHANNEL_SAT,\"public\":false}" | jq -c .
waitfor '[ "$(api a GET /api/channels | jq "[.[]|select(.active)]|length")" -gt 0 ] || { mine 1; false; }'
echo "channel A->B active: $(api a GET /api/channels | jq -c '.[0]|{id,localBalanceSat,remoteBalanceSat,confirmations}')"

inv=$(api b POST /api/invoices -d "{\"amountSat\":$PUSH_SAT,\"description\":\"liquidity push A->B\"}" | jq -r .invoice)
api a POST "/api/payments/$inv" -d '{}' | jq -c '{preimage:.preimage[0:16],fee}'
echo "pushed $PUSH_SAT sat to hub B main wallet over the channel"

create_app() {
  sleep 1.1 # POST /api/apps shares the unlock-password rate limiter: 1 req/s, burst 2
  api "$1" POST /api/apps -d "$(jq -nc --arg name "$2" --argjson scopes "$3" --argjson max "$4" --arg pw "$PW" \
    '{name:$name, scopes:$scopes, maxAmountSat:$max, budgetRenewal:"monthly", isolated:true, unlockPassword:$pw}')"
}

members='[]'
for i in 1 2 3 4 5; do
  h=$(cut -d" " -f$i <<<"b a a a b")
  pay=$(create_app $h "member$i-pay" '["pay_invoice","get_balance"]' "$BUDGET")
  recv=$(create_app $h "member$i-receive" '["make_invoice","lookup_invoice","get_balance"]' 0)
  api $h POST /api/transfers -d "{\"toAppId\":$(jq .id <<<"$pay"),\"amountSat\":$((3 * C))}"
  members=$(jq -c --arg n "member$i" --arg h "$h" --argjson p "$pay" --argjson r "$recv" \
    '. + [{name:$n, hub:$h, pay:{id:$p.id, uri:$p.pairingUri}, receive:{id:$r.id, uri:$r.pairingUri}}]' <<<"$members")
done
probe=$(create_app a "probe-exact-budget" '["pay_invoice","get_balance"]' "$C")
api a POST /api/transfers -d "{\"toAppId\":$(jq .id <<<"$probe"),\"amountSat\":$((3 * C))}"

jq -n --argjson c "$C" --argjson b "$BUDGET" --argjson m "$members" --arg probe "$(jq -r .pairingUri <<<"$probe")" \
  --arg ta "$TOKEN_a" --arg tb "$TOKEN_b" \
  '{contributionSat:$c, budgetSat:$b, members:$m, probeExactBudgetUri:$probe, hubs:{a:{url:"http://localhost:8081",token:$ta}, b:{url:"http://localhost:8082",token:$tb}}}' > "$OUT"
echo "wrote $OUT: members 2-4 on hub A, 1 and 5 on hub B, pay budget $BUDGET sat/month, funded $((3 * C)) sat each; setup took $(( $(date +%s) - t0 ))s"
