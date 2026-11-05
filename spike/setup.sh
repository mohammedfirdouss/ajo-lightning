#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PW=spike-unlock-pw
N=${MEMBERS:-5}
C=${CONTRIBUTION:-1000}
BUDGET=$(( C + (C / 100 > 10 ? (C + 99) / 100 : 10) )) # hub reserves max(1%, 10 sat) routing fee per non-self payment
CHANNEL_SAT=${CHANNEL_SAT:-200000}
PUSH_SAT=${PUSH_SAT:-50000}
OUT=connections.json
TOK=.tokens
MEMBERS=$(seq -f member%g 1 "$N" | xargs)
HUBS="router $MEMBERS"
mkdir -p $TOK

port() { [ "$1" = router ] && echo 8180 || echo $(( 8180 + ${1#member} )); }
huburl() { echo "http://localhost:$(port "$1")"; }
bcli() { docker compose exec -T bitcoind bitcoin-cli -regtest -rpcuser=spike -rpcpassword=spike "$@"; }
mine() { bcli generatetoaddress "$1" "$(bcli -rpcwallet=miner getnewaddress)" >/dev/null; }
api() { local h=$1 m=$2 p=$3 t=""; shift 3; [ -s $TOK/$h ] && t=$(<$TOK/$h); curl -sS -f -X "$m" "$(huburl "$h")$p" -H 'content-type: application/json' ${t:+-H "authorization: Bearer $t"} "$@"; }
waitfor() { local i; for i in $(seq 1 180); do eval "$1" && return 0; sleep 1; done; echo "timeout: $1" >&2; exit 1; }
active() { api "$1" GET /api/channels | jq '[.[]|select(.active)]|length'; }
stage() { echo "[$(( $(date +%s) - t0 ))s] $*"; }
parallel() { local f=$1 h pids=(); shift; for h in "$@"; do $f "$h" & pids+=($!); done; for h in "${pids[@]}"; do wait "$h"; done; }

init_hub() {
  local h=$1
  waitfor "curl -sf $(huburl "$h")/api/info >/dev/null"
  [ "$(api "$h" GET /api/info | jq -r .setupCompleted)" = true ] || api "$h" POST /api/setup -d "{\"backendType\":\"LDK\",\"unlockPassword\":\"$PW\"}" >/dev/null
  [ "$(api "$h" GET /api/info | jq -r .running)" = true ] || api "$h" POST /api/start -d "{\"unlockPassword\":\"$PW\"}" >/dev/null
  waitfor "[ \"\$(api $h GET /api/info | jq -r .running)\" = true ]"
  sleep 1
  api "$h" POST /api/unlock -d "{\"unlockPassword\":\"$PW\",\"permission\":\"full\"}" | jq -r .token > $TOK/"$h"
}

t0=$(date +%s)
docker compose up -d bitcoind relay $HUBS
waitfor 'bcli getblockchaininfo >/dev/null 2>&1'
bcli loadwallet miner >/dev/null 2>&1 || bcli createwallet miner >/dev/null 2>&1 || true
[ "$(bcli getblockcount)" -ge 101 ] || mine $(( 100 + N ))
rm -f $TOK/*
parallel init_hub $HUBS
stage "stage 1: $((N + 1)) hubs set up, started, unlocked"

if [ -f "$OUT" ]; then
  r_pubkey=$(api router GET /api/node/connection-info | jq -r .pubkey)
  for h in $MEMBERS; do api "$h" POST /api/peers -d "{\"pubkey\":\"$r_pubkey\",\"address\":\"router\",\"port\":9735}" >/dev/null || true; done # skip LDK's ~60s reconnect timer
  for h in $MEMBERS; do waitfor "[ \"\$(active $h)\" -ge 1 ]"; done
  waitfor "[ \"\$(active router)\" -ge $N ]"
  stage "warm: $OUT exists, all $N member<->router channels active again"; exit 0
fi

# ldk-node refuses to forward onto unannounced channels (PrivateChannelForward), and only a node with an
# alias and announcement address may announce one. The alias is read when LDK starts, hence the restart.
for h in $HUBS; do api "$h" POST /api/node/alias -d "{\"nodeAlias\":\"ajo-$h\"}"; done
docker compose restart $HUBS >/dev/null 2>&1
parallel init_hub $HUBS
stage "stage 1b: node aliases set, hubs restarted so LDK can announce channels"

r_pubkey=$(api router GET /api/node/connection-info | jq -r .pubkey)
fund=$(for h in $MEMBERS; do api "$h" POST /api/wallet/new-address | jq -r .; done | jq -Rnc '[inputs|{(.):0.005}]|add')
bcli -rpcwallet=miner sendmany "" "$fund" >/dev/null
mine 6
for h in $MEMBERS; do waitfor "[ \"\$(api $h POST /api/wallet/sync >/dev/null; api $h GET /api/balances | jq .onchain.spendable)\" -gt 0 ]"; done
stage "stage 2: $N members funded on-chain with 500000 sat each in one sendmany"

open_channel() {
  api "$1" POST /api/peers -d "{\"pubkey\":\"$r_pubkey\",\"address\":\"router\",\"port\":9735}" >/dev/null
  api "$1" POST /api/channels -d "{\"pubkey\":\"$r_pubkey\",\"amountSats\":$CHANNEL_SAT,\"public\":true}" >/dev/null
}
parallel open_channel $MEMBERS
sleep 2
bcli getrawmempool | jq -r "\"stage 3: \(length) funding txs in mempool, mining\""
waitfor "[ \"\$(active router)\" -ge $N ] || { mine 1; false; }"
mine 6 # channel announcements need 6 confirmations
stage "stage 3: $N announced channels member->router active, chain height $(bcli getblockcount)"

api router GET /api/channels | jq -r '.[]|"\(.remotePubkey) \(.id)"' | while read -r pk id; do
  api router PATCH "/api/peers/$pk/channels/$id" -d '{"forwardingFeeBaseMsat":1000,"forwardingFeeProportionalMillionths":0,"maxDustHtlcExposureFromFeeRateMultiplier":10000}'
done
stage "stage 3b: router forwarding fee set to 1 sat base, 0 ppm on all $N channels"
r_policies() {
  api "$1" GET "/api/node/network-graph?nodeIds=$r_pubkey" | jq --arg r "$r_pubkey" \
    '[.channels[]|(if .NodeOne==$r then .OneToTwo else .TwoToOne end)|select(.Fees.BaseMsat==1000)]|length'
}
for h in $MEMBERS; do waitfor "[ \"\$(r_policies $h)\" -ge $N ]"; done
stage "stage 3c: every member's gossip graph has the router's 1 sat policy on all $N channels"

push() {
  local inv
  inv=$(api router POST /api/invoices -d "{\"amountSat\":$PUSH_SAT,\"description\":\"inbound liquidity for $1\"}" | jq -r .invoice)
  api "$1" POST "/api/payments/$inv" -d '{}' >/dev/null
}
for h in $MEMBERS; do push "$h"; done
stage "stage 4: each member paid router $PUSH_SAT sat so router can forward to it"

create_apps() {
  local h=$1 pay recv
  pay=$(api "$h" POST /api/apps -d "$(jq -nc --arg name "$h-pay" --argjson max "$BUDGET" --arg pw "$PW" \
    '{name:$name, scopes:["pay_invoice","get_balance"], maxAmountSat:$max, budgetRenewal:"monthly", isolated:false, unlockPassword:$pw}')")
  sleep 1.1 # POST /api/apps shares the unlock-password rate limiter: 1 req/s, burst 2
  recv=$(api "$h" POST /api/apps -d "$(jq -nc --arg name "$h-receive" --arg pw "$PW" \
    '{name:$name, scopes:["make_invoice","lookup_invoice","get_balance"], maxAmountSat:0, budgetRenewal:"never", isolated:false, unlockPassword:$pw}')")
  jq -nc --arg n "$h" --arg url "$(huburl "$h")" --arg tok "$(<$TOK/"$h")" --argjson p "$pay" --argjson r "$recv" \
    '{name:$n, url:$url, token:$tok, pay:{id:$p.id, uri:$p.pairingUri}, receive:{id:$r.id, uri:$r.pairingUri}}' > $TOK/"$h".json
}
parallel create_apps $MEMBERS
jq -n --argjson c "$C" --argjson b "$BUDGET" --arg rurl "$(huburl router)" --arg rtok "$(<$TOK/router)" \
  --slurpfile m <(for h in $MEMBERS; do cat $TOK/"$h".json; done) \
  '{contributionSat:$c, budgetSat:$b, router:{url:$rurl, token:$rtok}, members:$m}' > "$OUT"
stage "stage 5: wrote $OUT, $N members x (pay budget $BUDGET sat/month, receive), cold setup done"
