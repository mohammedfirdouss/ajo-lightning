#!/usr/bin/env bash
set -euo pipefail

N=${MEMBERS:-5}
C=${CONTRIBUTION:-1000}
PW=$UNLOCK_PASSWORD
CHANNEL_SAT=200000
PUSH_SAT=50000
STATE=/state/connections.json
TOK=/tmp/tokens
[[ $N =~ ^[2-5]$ ]] || { echo "MEMBERS must be 2 to 5, got $N" >&2; exit 2; }
[[ $C =~ ^[1-9][0-9]*$ ]] || { echo "CONTRIBUTION must be a positive whole number of sats, got $C" >&2; exit 2; }
fee=$(( (C + 99) / 100 ))
BUDGET=$(( C + (fee > 10 ? fee : 10) )) # the hub reserves max(1%, 10 sat) of routing fee per payment
MEMBER_HUBS=$(for i in $(seq 1 "$N"); do echo "member$i"; done | xargs)
HUBS="router $MEMBER_HUBS"
mkdir -p $TOK

t0=$(date +%s)
stage() { echo "[$(( $(date +%s) - t0 ))s] $*"; }
quiet() { "$@" >/dev/null 2>&1; }
waitfor() {
  local i
  for i in $(seq 1 180); do quiet "$@" && return 0; sleep 1; done
  echo "timeout after 180s: $*" >&2
  exit 1
}
parallel() {
  local f=$1 h pids=()
  shift
  for h in "$@"; do $f "$h" & pids+=($!); done
  for h in "${pids[@]}"; do wait "$h"; done
}

rpc() {
  curl -sS --fail-with-body --user ajo:ajo -d "{\"jsonrpc\":\"1.0\",\"id\":0,\"method\":\"$2\",\"params\":${3:-[]}}" \
    "http://bitcoind:18443/${1:+wallet/$1}" | jq -c .result
}
mine() { rpc "" generatetoaddress "[$1,$(rpc miner getnewaddress)]" >/dev/null; }
api() {
  local h=$1 m=$2 p=$3 t=""
  shift 3
  [ -s $TOK/"$h" ] && t=$(<$TOK/"$h")
  curl -sS --fail-with-body -X "$m" "http://$h:8080$p" -H 'content-type: application/json' ${t:+-H "authorization: Bearer $t"} "$@"
}
info() { api "$1" GET /api/info | jq -r ".$2"; }
running() { [ "$(info "$1" running)" = true ]; }
stopped() { [ "$(info "$1" running)" = false ]; }
channels() { api "$1" GET /api/channels | jq "$2"; }
active() { [ "$(channels "$1" '[.[]|select(.active)]|length')" -ge "$2" ]; }
unlock() { api "$1" POST /api/unlock -d "{\"unlockPassword\":\"$PW\",\"permission\":\"full\"}" | jq -er .token > $TOK/"$1"; }
start() { api "$1" POST /api/start -d "{\"unlockPassword\":\"$PW\"}"; }

init_hub() {
  local h=$1
  rm -f $TOK/"$h"
  waitfor api "$h" GET /api/info
  [ "$(info "$h" setupCompleted)" = true ] || running "$h" ||
    api "$h" POST /api/setup -d "{\"backendType\":\"LDK\",\"unlockPassword\":\"$PW\"}" >/dev/null
  running "$h" || waitfor start "$h"
  waitfor running "$h"
  waitfor unlock "$h"
}

# ldk-node refuses to forward onto unannounced channels (PrivateChannelForward), and only a node with
# an alias and an announcement address announces one. LDK reads the alias at start, so stop and start it.
reload_alias() {
  local h=$1
  api "$h" POST /api/node/alias -d "{\"nodeAlias\":\"ajo-$h\"}" >/dev/null
  waitfor api "$h" POST /api/stop -d '{}' # returns "app is busy" while the first sync runs
  waitfor stopped "$h"
  waitfor start "$h"
  waitfor running "$h"
}

open_channel() {
  [ "$(channels "$1" length)" -eq 0 ] || return 0
  api "$1" POST /api/channels -d "{\"pubkey\":\"$r_pubkey\",\"amountSats\":$CHANNEL_SAT,\"public\":true}" >/dev/null
}

# Peering a connected hub by a new address drops the live connection.
# Peering a down hub skips LDK's reconnect timer of about 60s after a restart.
reconnect() {
  quiet active "$1" 1 || quiet api "$1" POST /api/peers -d "{\"pubkey\":\"$r_pubkey\",\"address\":\"router\",\"port\":9735}" || true
}

router_policies() {
  api "$1" GET "/api/node/network-graph?nodeIds=$r_pubkey" | jq --arg r "$r_pubkey" \
    '[.channels[]|(if .NodeOne==$r then .OneToTwo else .TwoToOne end)|select(.Fees.BaseMsat==1000)]|length'
}
gossip_settled() { [ "$(router_policies "$1")" -ge "$N" ]; }

push() {
  [ ! -s $STATE ] && [ "$(channels "$1" '.[0].remoteBalanceSat')" -lt "$PUSH_SAT" ] || return 0
  local inv
  inv=$(api router POST /api/invoices -d "{\"amountSat\":$PUSH_SAT,\"description\":\"inbound liquidity for $1\"}" | jq -r .invoice)
  api "$1" POST "/api/payments/$inv" -d '{}' >/dev/null
}

create_app() {
  api "$1" POST /api/apps -d "$2" | jq -ec '{id, uri: .pairingUri}'
}
connections() {
  local h=$1 prev pay recv apps
  prev=$( [ -s $STATE ] && jq -c --arg h "$h" '.members[]|select(.name==$h)' $STATE || true)
  apps=$(api "$h" GET /api/apps | jq -c '[.apps[]|{id, name}]')
  if [ -n "$prev" ] && jq -e --argjson a "$apps" '[.pay.id, .receive.id] - [$a[].id] == []' <<<"$prev" >/dev/null; then
    pay=$(jq -c .pay <<<"$prev")
    recv=$(jq -c .receive <<<"$prev")
  else
    for id in $(jq -r --arg h "$h" '.[]|select(.name==$h+"-pay" or .name==$h+"-receive")|.id' <<<"$apps"); do
      api "$h" DELETE "/api/apps/$id" >/dev/null
    done
    # POST /api/apps shares the unlock-password rate limiter, 1 request a second.
    pay=$(waitfor_out create_app "$h" "$(jq -nc --arg n "$h-pay" --argjson max "$BUDGET" --arg pw "$PW" \
      '{name:$n, scopes:["pay_invoice","get_balance"], maxAmountSat:$max, budgetRenewal:"monthly", isolated:false, unlockPassword:$pw}')")
    recv=$(waitfor_out create_app "$h" "$(jq -nc --arg n "$h-receive" --arg pw "$PW" \
      '{name:$n, scopes:["make_invoice","lookup_invoice","get_balance"], maxAmountSat:0, budgetRenewal:"never", isolated:false, unlockPassword:$pw}')")
  fi
  jq -nc --arg n "$h" --arg url "$(hosturl "$h")" --arg tok "$(<$TOK/"$h")" --argjson p "$pay" --argjson r "$recv" \
    '{name:$n, url:$url, token:$tok, pay:$p, receive:$r}' > $TOK/"$h".json
}
waitfor_out() {
  local i out
  for i in $(seq 1 30); do out=$("$@" 2>/dev/null) && { echo "$out"; return 0; }; sleep 1.1; done
  echo "timeout: $1 $2" >&2
  exit 1
}
hosturl() { echo "http://127.0.0.1:$HOST_HUB_PORT_PREFIX$([ "$1" = router ] && echo 0 || echo "${1#member}")"; }

waitfor rpc "" getblockchaininfo
quiet rpc "" loadwallet '["miner"]' || quiet rpc "" createwallet '["miner"]' || true
[ "$(rpc "" getblockcount)" -ge 101 ] || mine $(( 100 + N ))
parallel init_hub $HUBS
stage "$((N + 1)) hubs set up, started, and unlocked"

r_pubkey=$(api router GET /api/node/connection-info | jq -r .pubkey)
fresh=$( [ "$(channels router length)" -lt "$N" ] && echo 1 || true)
if [ -n "$fresh" ]; then
  parallel reload_alias $HUBS
  stage "node aliases set and LDK restarted so channels can be announced"

  need=$(for h in $MEMBER_HUBS; do
    if [ "$(channels "$h" length)" -eq 0 ] && [ "$(api "$h" GET /api/balances | jq .onchain.spendable)" -eq 0 ]; then echo "$h"; fi
  done | xargs)
  if [ -n "$need" ]; then
    fund=$(for h in $need; do api "$h" POST /api/wallet/new-address | jq -r .; done | jq -Rnc '[inputs|{(.):0.005}]|add')
    rpc miner sendmany "[\"\",$fund]" >/dev/null
    mine 6
    for h in $need; do waitfor eval "api $h POST /api/wallet/sync && [ \"\$(api $h GET /api/balances | jq .onchain.spendable)\" -gt 0 ]"; done
    stage "funded $need on-chain with 500000 sat each"
  fi
fi

parallel reconnect $MEMBER_HUBS
parallel open_channel $MEMBER_HUBS
for i in $(seq 1 360); do
  quiet active router "$N" && break
  if [ -n "$fresh" ]; then mine 1; elif (( i % 6 == 0 )); then parallel reconnect $MEMBER_HUBS; fi
  sleep 0.5
done
active router "$N" || { echo "router never reached $N active channels" >&2; exit 1; }
for h in $MEMBER_HUBS; do waitfor active "$h" 1; done
[ -z "$fresh" ] || mine 6 # channel announcements need 6 confirmations
stage "$N member channels to the router are active"

api router GET /api/channels | jq -r '.[]|select(.forwardingFeeBaseMsat != 1000)|"\(.remotePubkey) \(.id)"' | while read -r pk id; do
  api router PATCH "/api/peers/$pk/channels/$id" \
    -d '{"forwardingFeeBaseMsat":1000,"forwardingFeeProportionalMillionths":0,"maxDustHtlcExposureFromFeeRateMultiplier":10000}' >/dev/null
done
for h in $MEMBER_HUBS; do waitfor gossip_settled "$h"; done
stage "router forwards at 1 sat and every member's graph has that policy"

for h in $MEMBER_HUBS; do push "$h"; done
stage "router holds at least $PUSH_SAT sat on each channel so it can forward to every member"

parallel connections $MEMBER_HUBS
jq -n --argjson c "$C" --argjson b "$BUDGET" --arg relay "ws://127.0.0.1:$HOST_RELAY_PORT" \
  --arg rurl "$(hosturl router)" --arg rtok "$(<$TOK/router)" \
  --slurpfile m <(for h in $MEMBER_HUBS; do cat $TOK/"$h".json; done) \
  '{contributionSat:$c, budgetSat:$b, relayUrl:$relay, router:{name:"router", url:$rurl, token:$rtok}, members:$m}' > $STATE.tmp
chmod 600 $STATE.tmp
mv $STATE.tmp $STATE
stage "seed done: router and $N member hubs each have an active channel, pay budget $BUDGET sat a month for a $C sat contribution"
