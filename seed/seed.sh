#!/usr/bin/env bash
set -euo pipefail

N=${MEMBERS:-5}
C=${CONTRIBUTION:-1000}
: "${UNLOCK_PASSWORD:?}"
CHANNEL_SAT=200000
PUSH_SAT=50000
STATE=/state/connections.json
TOK=/tmp/tokens
[[ $N =~ ^[3-5]$ ]] || { echo "MEMBERS must be 3 to 5, got $N" >&2; exit 2; }
[[ $C =~ ^[1-9][0-9]*$ ]] || { echo "CONTRIBUTION must be a positive whole number of sats, got $C" >&2; exit 2; }
fee=$(( (C + 99) / 100 ))
BUDGET=$(( C + (fee > 10 ? fee : 10) )) # the hub reserves max(1%, 10 sat) of routing fee per payment
MAX_C=$(( (PUSH_SAT - 10000) / (N - 1) ))
(( C > 10 && C <= MAX_C )) || {
  echo "CONTRIBUTION must be 11 to $MAX_C sat with $N members, so a pay budget covers one contribution but not two and round 1 fits the router's $PUSH_SAT sat on the payee's channel; got $C" >&2
  exit 2
}
# Alby Hub has no hold invoice scope. make_invoice also grants make_hold_invoice, settle_hold_invoice and cancel_hold_invoice.
SPEC=$(jq -nc --argjson b "$BUDGET" '{
  pay: {scopes: ["pay_invoice"], maxAmountSat: $b, budgetRenewal: "weekly"},
  receive: {scopes: ["lookup_invoice", "make_invoice"], maxAmountSat: 0, budgetRenewal: "never"}
}')
MEMBER_HUBS=$(for i in $(seq 1 "$N"); do echo "member$i"; done | xargs)
HUBS="router $MEMBER_HUBS"
mkdir -p $TOK

t0=$(date +%s)
stage() { echo "[$(( $(date +%s) - t0 ))s] $*"; }
quiet() { "$@" >/dev/null 2>&1; }
waitfor() {
  local i out
  for i in $(seq 1 180); do
    if out=$("$@" 2>/dev/null); then printf '%s' "$out"; return 0; fi
    sleep 1
  done
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
  jq -nc --arg m "$2" --argjson p "${3:-[]}" '{jsonrpc: "1.0", id: 0, method: $m, params: $p}' |
    curl -sS --fail-with-body --user ajo:ajo -d @- "http://bitcoind:18443/${1:+wallet/$1}" | jq -c .result
}
mine() { rpc "" generatetoaddress "$(jq -nc --argjson n "$1" --argjson a "$(rpc miner getnewaddress)" '[$n, $a]')" >/dev/null; }
api() {
  local h=$1 m=$2 p=$3 auth=()
  shift 3
  if [ -s $TOK/"$h" ]; then auth=(-H "@$TOK/$h"); fi
  curl -sS --fail-with-body -X "$m" "http://$h:8080$p" -H 'content-type: application/json' "${auth[@]}" "$@"
}
info() { api "$1" GET /api/info | jq -r ".$2"; }
running() { [ "$(info "$1" running)" = true ]; }
stopped() { [ "$(info "$1" running)" = false ]; }
channels() { api "$1" GET /api/channels | jq "$2"; }
active() { [ "$(channels "$1" '[.[]|select(.active)]|length')" -ge "$2" ]; }
synced() { quiet api "$1" POST /api/wallet/sync && [ "$(api "$1" GET /api/balances | jq .onchain.spendable)" -gt 0 ]; }
with_password() { jq -nc "$1 + {unlockPassword: \$ENV.UNLOCK_PASSWORD}" "${@:2}"; }
unlock() { with_password '{permission: $p}' --arg p "$2" | api "$1" POST /api/unlock -d @- | jq -jer .token; }
start() { with_password '{}' | api "$1" POST /api/start -d @-; }

init_hub() {
  local h=$1 full
  waitfor api "$h" GET /api/info >/dev/null
  [ "$(info "$h" setupCompleted)" = true ] || running "$h" ||
    with_password '{backendType: "LDK"}' | api "$h" POST /api/setup -d @- >/dev/null
  running "$h" || waitfor start "$h" >/dev/null
  waitfor running "$h"
  full=$(waitfor unlock "$h" full)
  printf 'authorization: Bearer %s\n' "$full" > $TOK/"$h"
  waitfor unlock "$h" readonly > $TOK/"$h".ro
}

# ldk-node refuses to forward onto unannounced channels (PrivateChannelForward), and only a node with
# an alias and an announcement address announces one. LDK reads the alias at start, so stop and start it.
reload_alias() {
  local h=$1
  api "$h" POST /api/node/alias -d "$(jq -nc --arg a "ajo-$h" '{nodeAlias: $a}')" >/dev/null
  waitfor api "$h" POST /api/stop -d '{}' >/dev/null # returns "app is busy" while the first sync runs
  waitfor stopped "$h"
  waitfor start "$h" >/dev/null
  waitfor running "$h"
}

open_channel() {
  [ "$(channels "$1" length)" -eq 0 ] || return 0
  api "$1" POST /api/channels -d "$(jq -nc --arg pk "$r_pubkey" --argjson amt "$CHANNEL_SAT" '{pubkey: $pk, amountSats: $amt, public: true}')" >/dev/null
}

# Peering a connected hub by a new address drops the live connection.
# Peering a down hub skips LDK's reconnect timer of about 60s after a restart.
reconnect() {
  quiet active "$1" 1 || quiet api "$1" POST /api/peers -d "$(jq -nc --arg pk "$r_pubkey" '{pubkey: $pk, address: "router", port: 9735}')" || true
}

router_policies() {
  api "$1" GET "/api/node/network-graph?nodeIds=$r_pubkey" | jq --arg r "$r_pubkey" \
    '[.channels[]|(if .NodeOne==$r then .OneToTwo else .TwoToOne end)|select(.Fees.BaseMsat==1000)]|length'
}
gossip_settled() { [ "$(router_policies "$1")" -ge "$N" ]; }

push() {
  [ ! -s $STATE ] && [ "$(channels "$1" '.[0].remoteBalanceSat')" -lt "$PUSH_SAT" ] || return 0
  local inv
  inv=$(api router POST /api/invoices -d "$(jq -nc --argjson amt "$PUSH_SAT" --arg d "inbound liquidity for $1" '{amountSat: $amt, description: $d}')" | jq -r .invoice)
  api "$1" POST "/api/payments/$inv" -d '{}' >/dev/null
}

create_app() {
  with_password '$s[$k] + {name: $n, isolated: false}' --argjson s "$SPEC" --arg k "$2" --arg n "$1-$2" |
    api "$1" POST /api/apps -d @- | jq -ec '{id, uri: .pairingUri}'
}
connection() {
  local h=$1 kind=$2 out=$TOK/$1-$2.json apps pk
  apps=$(api "$h" GET /api/apps)
  if [ -s $STATE ]; then jq -c --arg h "$h" --arg k "$kind" '.members[]|select(.name==$h)|.[$k]' $STATE > "$out"; fi
  if [ -s "$out" ] && jq -e --slurpfile prev "$out" --argjson s "$SPEC" --arg k "$kind" --arg n "$h-$kind" \
    'any(.apps[]; .id == $prev[0].id and .name == $n and {scopes: (.scopes|sort), maxAmountSat} == ($s[$k]|{scopes, maxAmountSat}))' \
    <<<"$apps" >/dev/null; then
    return 0
  fi
  for pk in $(jq -r --arg n "$h-$kind" '.apps[]|select(.name==$n)|.appPubkey' <<<"$apps"); do
    api "$h" DELETE "/api/apps/$pk" >/dev/null
  done
  waitfor create_app "$h" "$kind" > "$out" # POST /api/apps shares the unlock rate limiter, 1 request a second
}
connections() {
  local h=$1
  connection "$h" pay
  connection "$h" receive
  jq -nc --arg n "$h" --arg url "$(hosturl "$h")" --rawfile tok $TOK/"$h".ro \
    --slurpfile p $TOK/"$h"-pay.json --slurpfile r $TOK/"$h"-receive.json \
    '{name: $n, url: $url, token: $tok, pay: $p[0], receive: $r[0]}' > $TOK/"$h".json
}
hosturl() {
  local n=${1#member}
  if [ "$1" = router ]; then n=0; fi
  echo "http://127.0.0.1:$HOST_HUB_PORT_PREFIX$n"
}

waitfor rpc "" getblockchaininfo >/dev/null
quiet rpc "" loadwallet '["miner"]' || quiet rpc "" createwallet '["miner"]' || true
[ "$(rpc "" getblockcount)" -ge 101 ] || mine $(( 100 + N ))
parallel init_hub $HUBS
stage "$((N + 1)) hubs set up, started, and unlocked"

r_pubkey=$(api router GET /api/node/connection-info | jq -r .pubkey)
fresh=false
if [ "$(channels router length)" -lt "$N" ]; then fresh=true; fi
if $fresh; then
  parallel reload_alias $HUBS
  stage "node aliases set and LDK restarted so channels can be announced"

  need=$(for h in $MEMBER_HUBS; do
    if [ "$(channels "$h" length)" -eq 0 ] && [ "$(api "$h" GET /api/balances | jq .onchain.spendable)" -eq 0 ]; then echo "$h"; fi
  done | xargs)
  if [ -n "$need" ]; then
    fund=$(for h in $need; do api "$h" POST /api/wallet/new-address | jq -r .; done | jq -Rnc '[inputs|{(.):0.005}]|add')
    rpc miner sendmany "$(jq -nc --argjson f "$fund" '["", $f]')" >/dev/null
    mine 6
    for h in $need; do waitfor synced "$h"; done
    stage "funded $need on-chain with 500000 sat each"
  fi
fi

parallel reconnect $MEMBER_HUBS
parallel open_channel $MEMBER_HUBS
for i in $(seq 1 360); do
  quiet active router "$N" && break
  if $fresh; then mine 1; elif (( i % 6 == 0 )); then parallel reconnect $MEMBER_HUBS; fi
  sleep 0.5
done
active router "$N" || { echo "router never reached $N active channels" >&2; exit 1; }
for h in $MEMBER_HUBS; do waitfor active "$h" 1; done
if $fresh; then mine 6; fi # channel announcements need 6 confirmations
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
  --arg rurl "$(hosturl router)" --rawfile rtok $TOK/router.ro \
  --slurpfile m <(for h in $MEMBER_HUBS; do cat $TOK/"$h".json; done) \
  '{contributionSat: $c, budgetSat: $b, relayUrl: $relay, router: {name: "router", url: $rurl, token: $rtok}, members: $m}' > $STATE.tmp
chmod 600 $STATE.tmp
mv $STATE.tmp $STATE
stage "seed done: router and $N member hubs each have an active channel, pay budget $BUDGET sat a week for a $C sat contribution"
