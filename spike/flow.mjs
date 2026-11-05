import { readFileSync } from "node:fs";
import { NWCClient } from "@getalby/sdk/nwc";

const HOST_RELAY = "ws://127.0.0.1:7000";
const cfg = JSON.parse(readFileSync(new URL("connections.json", import.meta.url)));
const { contributionSat, budgetSat, members, hubs } = cfg;
const connect = (uri) => {
  const url = new URL(uri);
  url.searchParams.set("relay", HOST_RELAY);
  return new NWCClient({ nostrWalletConnectUrl: url.toString() });
};
const hubApi = async (h, method, path, body) => {
  const res = await fetch(hubs[h].url + path, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${hubs[h].token}` },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
};
const wallets = members.map((m) => ({ ...m, pay: connect(m.pay.uri), receive: connect(m.receive.uri) }));
const [payee, ...payers] = wallets;
const msat = contributionSat * 1000;
const describe = (e) => `${e.constructor.name} code=${e.code} message=${JSON.stringify(e.message)}`;

async function nodeState(label) {
  const rows = {};
  for (const h of ["a", "b"]) {
    const [ch] = await hubApi(h, "GET", "/api/channels");
    const bal = await hubApi(h, "GET", "/api/balances");
    rows[`hub ${h.toUpperCase()}`] = {
      channel_local_sat: ch.localBalanceSat,
      channel_remote_sat: ch.remoteBalanceSat,
      ln_spendable_sat: bal.lightning.totalSpendableSat,
      onchain_sat: bal.onchain.totalSat,
    };
  }
  console.log(`\nnode state ${label} (hub API /api/channels + /api/balances):`);
  console.table(rows);
  return rows;
}

async function appBalances(label) {
  const rows = {};
  for (const w of wallets) {
    rows[w.name] = {
      hub: w.hub,
      pay_sat: (await w.pay.getBalance()).balance / 1000,
      receive_sat: (await w.receive.getBalance()).balance / 1000,
    };
  }
  console.log(`\nconnection balances ${label} (NWC get_balance):`);
  console.table(rows);
  return rows;
}

const [ta, tb] = await Promise.all([hubApi("a", "GET", "/api/node/connection-info"), hubApi("b", "GET", "/api/node/connection-info")]);
console.log(`hub A node ${ta.pubkey}\nhub B node ${tb.pubkey}`);
const nodeBefore = await nodeState("before round");
const appsBefore = await appBalances("before round");

console.log(`\nround: payee=${payee.name} (hub ${payee.hub}), contribution=${contributionSat} sat, pay budget=${budgetSat} sat/month`);
let crossHubSat = 0;
for (const p of payers) {
  const t = Date.now();
  const inv = await payee.receive.makeInvoice({ amount: msat, description: `ajo round 1 from ${p.name}` });
  const res = await p.pay.payInvoice({ invoice: inv.invoice });
  const settled = await payee.receive.lookupInvoice({ payment_hash: inv.payment_hash });
  const route = p.hub === payee.hub ? "same hub (self-payment)" : `hub ${p.hub.toUpperCase()} -> hub ${payee.hub.toUpperCase()} over channel`;
  if (p.hub !== payee.hub) crossHubSat += contributionSat;
  console.log(`${p.name} -> ${payee.name} [${route}]: preimage=${res.preimage.slice(0, 16)}..., fees_paid=${res.fees_paid}, payee state=${settled.state}, ${Date.now() - t}ms`);
}

const nodeAfter = await nodeState("after round");
await appBalances("after round");
const dA = nodeAfter["hub A"].channel_local_sat - nodeBefore["hub A"].channel_local_sat;
const dB = nodeAfter["hub B"].channel_local_sat - nodeBefore["hub B"].channel_local_sat;
console.log(`hub A channel local delta = ${dA} sat, hub B channel local delta = ${dB} sat, cross-hub total = ${crossHubSat} sat: ${dA === -crossHubSat && dB === crossHubSat ? "OK" : "MISMATCH"}`);

console.log(`\nover-budget: ${payers[0].name} (hub ${payers[0].hub}) pays a second contribution in the same budget period`);
const inv2 = await payee.receive.makeInvoice({ amount: msat, description: "ajo over budget attempt" });
try {
  await payers[0].pay.payInvoice({ invoice: inv2.invoice });
  console.log("UNEXPECTED: over-budget payment succeeded");
} catch (e) {
  console.log(`rejected: ${describe(e)}`);
}

console.log(`\nfee reserve: hub A connection with budget exactly ${contributionSat} sat pays one ${contributionSat} sat cross-hub invoice`);
const probe = connect(cfg.probeExactBudgetUri);
const inv3 = await payee.receive.makeInvoice({ amount: msat, description: "exact budget probe" });
try {
  await probe.payInvoice({ invoice: inv3.invoice });
  console.log("paid: budget equal to the contribution is enough");
} catch (e) {
  console.log(`rejected: ${describe(e)}`);
}

const huge = 10_000_000;
console.log(`\nbacking: hub A /api/transfers ${huge} sat from the main wallet into the probe connection (hub A holds ${nodeAfter["hub A"].ln_spendable_sat} sat spendable)`);
const probeApp = (await hubApi("a", "GET", "/api/apps")).apps?.find((a) => a.name === "probe-exact-budget") ?? (await hubApi("a", "GET", "/api/apps")).find?.((a) => a.name === "probe-exact-budget");
try {
  await hubApi("a", "POST", "/api/transfers", { toAppId: probeApp.id, amountSat: huge });
  console.log(`accepted: probe get_balance now ${(await probe.getBalance()).balance / 1000} sat`);
} catch (e) {
  console.log(`refused: ${e.message}`);
}
await nodeState("final");
probe.close();
for (const w of wallets) { w.pay.close(); w.receive.close(); }
