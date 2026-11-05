import { readFileSync } from "node:fs";
import { NWCClient } from "@getalby/sdk/nwc";

const HOST_RELAY = "ws://127.0.0.1:7000";
const { contributionSat, members } = JSON.parse(readFileSync(new URL("connections.json", import.meta.url)));
const connect = (uri) => {
  const url = new URL(uri);
  url.searchParams.set("relay", HOST_RELAY);
  return new NWCClient({ nostrWalletConnectUrl: url.toString() });
};
const wallets = members.map((m) => ({ name: m.name, pay: connect(m.pay.uri), receive: connect(m.receive.uri) }));
const [payee, ...payers] = wallets;
const msat = contributionSat * 1000;

async function balances(label) {
  const rows = {};
  for (const w of wallets) {
    rows[w.name] = {
      pay_sat: (await w.pay.getBalance()).balance / 1000,
      receive_sat: (await w.receive.getBalance()).balance / 1000,
    };
  }
  console.log(`\nbalances ${label} (via NWC get_balance):`);
  console.table(rows);
  return rows;
}

const describe = (e) => `${e.constructor.name} code=${e.code} message=${JSON.stringify(e.message)}`;

const before = await balances("before round");

console.log(`\nround: payee=${payee.name}, contribution=${contributionSat} sat`);
for (const p of payers) {
  const t = Date.now();
  const inv = await payee.receive.makeInvoice({ amount: msat, description: `ajo round 1 from ${p.name}` });
  const res = await p.pay.payInvoice({ invoice: inv.invoice });
  const settled = await payee.receive.lookupInvoice({ payment_hash: inv.payment_hash });
  console.log(`${p.name} -> ${payee.name}: paid, preimage=${res.preimage.slice(0, 16)}..., fees_paid=${res.fees_paid}, payee lookup state=${settled.state}, ${Date.now() - t}ms`);
}

const after = await balances("after round");
const delta = after[payee.name].receive_sat - before[payee.name].receive_sat;
console.log(`payee receive delta = ${delta} sat, expected ${payers.length * contributionSat}: ${delta === payers.length * contributionSat ? "OK" : "MISMATCH"}`);

console.log(`\nover-budget: ${payers[0].name} pays a second contribution in the same budget period`);
const inv2 = await payee.receive.makeInvoice({ amount: msat, description: "ajo over budget attempt" });
try {
  await payers[0].pay.payInvoice({ invoice: inv2.invoice });
  console.log("UNEXPECTED: over-budget payment succeeded");
} catch (e) {
  console.log(`rejected: ${describe(e)}`);
}

console.log(`\nleast privilege: ${payee.name}'s receive connection tries pay_invoice`);
const inv3 = await payers[1].receive.makeInvoice({ amount: 1000, description: "scope test" });
try {
  await payee.receive.payInvoice({ invoice: inv3.invoice });
  console.log("UNEXPECTED: receive connection could pay");
} catch (e) {
  console.log(`rejected: ${describe(e)}`);
}

await balances("final");
for (const w of wallets) { w.pay.close(); w.receive.close(); }
