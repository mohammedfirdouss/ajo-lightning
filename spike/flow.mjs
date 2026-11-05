import { readFileSync } from "node:fs";
import { NWCClient } from "@getalby/sdk/nwc";

const HOST_RELAY = "ws://127.0.0.1:7100";
const cfg = JSON.parse(readFileSync(new URL("connections.json", import.meta.url)));
const { contributionSat, budgetSat, members, router } = cfg;
const connect = (uri) => {
  const url = new URL(uri);
  url.searchParams.set("relay", HOST_RELAY);
  return new NWCClient({ nostrWalletConnectUrl: url.toString() });
};
const hubApi = async ({ url, token }, method, path, body) => {
  const res = await fetch(url + path, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
};
const hubs = [{ name: "router", ...router }, ...members];
const wallets = members.map((m) => ({ ...m, pay: connect(m.pay.uri), receive: connect(m.receive.uri) }));
const [payee, ...payers] = wallets;
const msat = contributionSat * 1000;
const describe = (e) => `${e.constructor.name} code=${e.code} message=${JSON.stringify(e.message)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function nodeState(label) {
  await sleep(2000); // /api/channels balances lag a payment by about a second
  const rows = {};
  for (const h of hubs) {
    const chans = await hubApi(h, "GET", "/api/channels");
    const bal = await hubApi(h, "GET", "/api/balances");
    rows[h.name] = {
      channels: chans.length,
      active: chans.filter((c) => c.active).length,
      channel_local_sat: chans.reduce((s, c) => s + c.localBalanceSat, 0),
      channel_remote_sat: chans.reduce((s, c) => s + c.remoteBalanceSat, 0),
      ln_spendable_sat: bal.lightning.totalSpendableSat,
      onchain_sat: bal.onchain.totalSat,
    };
  }
  console.log(`\nnode state ${label} (hub API /api/channels + /api/balances):`);
  console.table(rows);
  return rows;
}

async function connectionBalances(label) {
  const rows = {};
  for (const w of wallets) {
    rows[w.name] = { pay_sat: (await w.pay.getBalance()).balance / 1000, receive_sat: (await w.receive.getBalance()).balance / 1000 };
  }
  console.log(`\nconnection balances ${label} (NWC get_balance, both connections see the one node balance):`);
  console.table(rows);
}

for (const h of hubs) console.log(`${h.name.padEnd(8)} node ${(await hubApi(h, "GET", "/api/node/connection-info")).pubkey}`);
const before = await nodeState("before round");
await connectionBalances("before round");

console.log(`\nround: payee=${payee.name}, contribution=${contributionSat} sat, pay budget=${budgetSat} sat/month, route payer -> router -> ${payee.name}`);
const feesBy = {};
for (const p of payers) {
  const t = Date.now();
  const inv = await payee.receive.makeInvoice({ amount: msat, description: `ajo round 1 from ${p.name}` });
  const res = await p.pay.payInvoice({ invoice: inv.invoice });
  const settled = await payee.receive.lookupInvoice({ payment_hash: inv.payment_hash });
  feesBy[p.name] = res.fees_paid / 1000;
  console.log(`${p.name} -> ${payee.name}: preimage=${res.preimage.slice(0, 16)}..., fees_paid=${res.fees_paid} msat, payee state=${settled.state}, ${Date.now() - t}ms`);
}

const after = await nodeState("after round");
await connectionBalances("after round");

console.log("\nchannel_local_sat deltas:");
const totalFees = Object.values(feesBy).reduce((a, b) => a + b, 0);
const checks = [];
for (const h of hubs) {
  const d = after[h.name].channel_local_sat - before[h.name].channel_local_sat;
  const want = h.name === "router" ? totalFees : h.name === payee.name ? payers.length * contributionSat : -(contributionSat + feesBy[h.name]);
  const ok = Math.abs(d - want) < 1; // sat rounding of msat balances
  checks.push(ok);
  console.log(`  ${h.name.padEnd(8)} delta=${String(d).padStart(6)} expected=${String(want).padStart(6)} ${ok ? "OK" : "MISMATCH"}`);
}
console.log(`balance deltas: ${checks.every(Boolean) ? "ALL OK" : "MISMATCH"} (router routing fees total ${totalFees} sat)`);

console.log(`\nover-budget: ${payers[0].name} pays a second contribution in the same budget period (non-isolated connection)`);
const inv2 = await payee.receive.makeInvoice({ amount: msat, description: "ajo over budget attempt" });
try {
  await payers[0].pay.payInvoice({ invoice: inv2.invoice });
  console.log("UNEXPECTED: over-budget payment succeeded");
} catch (e) {
  console.log(`rejected: ${describe(e)}`);
}

console.log(`\nscope: ${payee.name} receive connection tries to pay a ${contributionSat} sat invoice from ${payers[0].name}`);
const inv3 = await payers[0].receive.makeInvoice({ amount: msat, description: "receive-only connection pay attempt" });
try {
  await payee.receive.payInvoice({ invoice: inv3.invoice });
  console.log("UNEXPECTED: receive connection paid");
} catch (e) {
  console.log(`rejected: ${describe(e)}`);
}

await nodeState("final");
for (const w of wallets) { w.pay.close(); w.receive.close(); }
