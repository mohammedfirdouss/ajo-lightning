import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { roundId, sats } from "../../src/round/types.ts";
import { openStore } from "../../src/store/sqlite.ts";
import type { LinkInfo } from "../../src/wallet/nwc.ts";
import { checkLinks, nwcSource } from "../../src/web/nwc-source.ts";
import { lock } from "../../src/web/passcode.ts";
import { nwcLink } from "../../src/web/source.ts";

const PAY: LinkInfo = { methods: ["pay_invoice", "get_info", "get_budget"], budget: { totalSat: 1010, usedSat: 0, renewal: "monthly" } };
const RECEIVE: LinkInfo = { methods: ["make_invoice", "make_hold_invoice", "settle_hold_invoice", "cancel_hold_invoice", "lookup_invoice", "get_info"] };
const link = () => nwcLink(`nostr+walletconnect://${randomBytes(32).toString("hex")}?relay=ws%3A%2F%2Frelay%3A8080&secret=${randomBytes(32).toString("hex")}`) ?? assert.fail();

test("link checks refuse a receive link that can pay, a pay link that can invoice, and a wallet that does not answer", () => {
	const c = sats(1000);
	const reason = (pay: LinkInfo | undefined, receive: LinkInfo | undefined) => {
		const r = checkLinks(pay, receive, c);
		return r.ok ? "ok" : r.reason;
	};
	assert.equal(reason(PAY, RECEIVE), "ok");
	assert.deepEqual(checkLinks(PAY, RECEIVE, c), { ok: true, capSat: 1010 });
	assert.match(reason(PAY, { methods: [...RECEIVE.methods, "pay_invoice"] }), /^Your receive link can spend money/);
	assert.match(reason({ ...PAY, methods: [...PAY.methods, "make_invoice"] }, RECEIVE), /^Your pay link can also create invoices/);
	assert.match(reason(RECEIVE, PAY), /^Your receive link can spend money/, "swapped links are caught");
	assert.match(reason(undefined, RECEIVE), /could not reach the wallet behind your pay link/);
	assert.match(reason(PAY, undefined), /could not reach the wallet behind your receive link/);
});

test("link checks refuse a receive link without the hold invoice methods", () => {
	for (const method of ["make_hold_invoice", "settle_hold_invoice", "cancel_hold_invoice", "lookup_invoice"]) {
		const r = checkLinks(PAY, { methods: RECEIVE.methods.filter((m) => m !== method) }, sats(1000));
		assert.match(r.ok ? "ok" : r.reason, /^Your receive link cannot create, settle and cancel hold invoices/, method);
	}
});

test("link checks want a renewing pay limit with room for the contribution and its routing fee", () => {
	const reason = (budget: LinkInfo["budget"], contribution = 1000) => {
		const r = checkLinks({ ...PAY, budget }, RECEIVE, sats(contribution));
		return r.ok ? "ok" : r.reason;
	};
	const monthly = (totalSat: number, usedSat = 0) => ({ totalSat, usedSat, renewal: "monthly" as const });
	assert.equal(reason(monthly(1010)), "ok");
	assert.match(reason(undefined), /no spending limit/);
	assert.match(reason(monthly(1009)), /limit of 1009 sat is less than the 1010 sat each round needs, which is 1000 sat plus up to 10 sat in routing fees/);
	assert.match(reason(monthly(1000)), /less than the 1010 sat/, "a limit of exactly the contribution leaves nothing for the fee");
	assert.match(reason(monthly(5049), 5000), /less than the 5050 sat each round needs, which is 5000 sat plus up to 50 sat/, "the fee is 1% above 1000 sat");
	assert.equal(reason(monthly(5050), 5000), "ok");
	assert.match(reason(monthly(1010, 1001)), /has 9 sat left of its limit until it renews/);
	assert.match(reason({ totalSat: 1_000_000, usedSat: 0, renewal: "never" }), /limit never renews/);
});

async function source(info: (uri: string) => Promise<LinkInfo>) {
	const store = openStore(`${mkdtempSync(`${tmpdir()}/ajo-web-`)}/ajo.db`, randomBytes(32));
	const s = nwcSource({ store, circleKey: randomBytes(32), relayUrl: "ws://127.0.0.1:7100", publish: async () => {}, connect: () => assert.fail("no wallet in this test"), linkInfo: info });
	await s.create({ name: "Market ajo", contribution: sats(1000), cadence: "monthly", lang: "en", start: "2026-11-05", lock: await lock("market-day") });
	return { s, store };
}

test("the store-backed source keeps members in join order with the cap their wallet reported", async () => {
	const links = new Map<string, LinkInfo>();
	const { s, store } = await source(async (uri) => links.get(uri) ?? Promise.reject(new Error("silent")));
	for (const name of ["Ada", "Bola", "Chidi"]) {
		const pay = link();
		const receive = link();
		links.set(pay, PAY).set(receive, RECEIVE);
		assert.equal((await s.join({ name, pay, receive })).ok, true);
	}
	const circle = await s.circle();
	assert.deepEqual(circle?.members.map((m) => [m.name, m.capSat]), [["Ada", 1010], ["Bola", 1010], ["Chidi", 1010]]);
	const round2 = await s.round(roundId(2));
	assert.equal(round2?.payee, circle?.members[1].id);
	assert.equal(round2?.phase, "scheduled");
	assert.equal(await s.round(roundId(4)), undefined);
	assert.deepEqual((store.circle() as { name: string }).name, "Market ajo");
});

test("the store-backed source refuses a silent wallet, a reused link and a taken name, and saves no member", async () => {
	const pay = link();
	const receive = link();
	const { s } = await source(async (uri) => (uri === pay ? PAY : uri === receive ? RECEIVE : Promise.reject(new Error("silent"))));
	const silent = await s.join({ name: "Ada", pay: link(), receive });
	assert.equal(silent.ok, false);
	assert.equal((await s.circle())?.members.length, 0);
	assert.equal((await s.join({ name: "Ada", pay, receive })).ok, true);
	const again = await s.join({ name: "Bola", pay, receive: link() });
	assert.match(again.ok ? "" : again.reason, /already belongs to a member/);
	const same = await s.join({ name: "Ada", pay: link(), receive: link() });
	assert.match(same.ok ? "" : same.reason, /already has that name/);
});
