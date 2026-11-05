import assert from "node:assert/strict";
import { test } from "node:test";
import type { Contribution, Invoice, Round } from "../../src/round/types.ts";
import { memberId, paymentHash, preimage, roundId, sats } from "../../src/round/types.ts";
import { money } from "../../src/web/copy.ts";
import { circlePage, createPage } from "../../src/web/pages/circle.ts";
import { joinPage } from "../../src/web/pages/join.ts";
import { receiptsPage } from "../../src/web/pages/receipts.ts";
import { roundPage } from "../../src/web/pages/round.ts";
import type { Circle } from "../../src/web/source.ts";

const m = money(1.5);
const names = ["Ada", "Bola", "Chidi", "Dayo", "Efe"];
const ids = names.map((_, i) => memberId(`member${i + 1}`));
const circle: Circle = {
	name: "Market ajo",
	contribution: sats(1000),
	cadence: "monthly",
	lang: "en",
	start: "2026-11-05",
	lock: { salt: "00", hash: "00" },
	members: names.map((name, i) => ({ id: ids[i], name, capSat: sats(1010) })),
	pubkey: "a".repeat(64),
	relayUrl: "ws://127.0.0.1:7100",
};
const invoice = (i: number): Invoice => ({ paymentHash: paymentHash(String(i).repeat(64)), bolt11: "lnbcrt", amount: sats(1000), expiresAt: 0 });
const paid = (i: number): Contribution => ({ state: "paid", payer: ids[i], invoice: invoice(i), proof: { by: "preimage", preimage: preimage("f".repeat(64)) } });
const round = (phase: Round["phase"], contributions: Contribution[]) =>
	({ id: roundId(1), payee: ids[0], contribution: sats(1000), maxTries: 2, reruns: 0, phase, contributions }) as Round;

const visible = async (page: unknown) =>
	String(await page)
		.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, " ");
const rowOf = async (page: unknown, member: string) => {
	const li = String(await page).match(new RegExp(`<li class="row (\\w+)" data-member="${member}">([\\s\\S]*?)</li>`));
	assert.ok(li, `no row for ${member}`);
	return { tone: li[1], text: await visible(li[2]) };
};

test("the round page says paid, waiting, or not paid with a plain reason for each payer", async () => {
	const page = roundPage(
		circle,
		round("collecting", [
			paid(1),
			{ state: "invoiced", payer: ids[2], invoice: invoice(2), step: "lookup", tries: 1, lastErr: "TIMEOUT" },
			{ state: "failed", payer: ids[3], invoice: invoice(3), tries: 2, reason: "QUOTA_EXCEEDED" },
			{ state: "failed", payer: ids[4], invoice: invoice(4), tries: 2, reason: "INSUFFICIENT_BALANCE" },
		]),
		m,
	);
	assert.deepEqual(await rowOf(page, "member2"), { tone: "paid", text: " Bola Paid " });
	assert.deepEqual(await rowOf(page, "member3"), { tone: "waiting", text: " Chidi Waiting , trying again, last try was the wallet did not answer " });
	assert.deepEqual(await rowOf(page, "member4"), { tone: "notpaid", text: " Dayo Not paid , over your limit " });
	assert.deepEqual(await rowOf(page, "member5"), { tone: "notpaid", text: " Efe Not paid , not enough money " });
	const text = await visible(page);
	assert.match(text, /Round 1 pays Ada/);
	assert.match(text, /1,000 sat of 4,000 sat/);
	assert.match(text, /₦1,500 of ₦6,000/);
	assert.match(text, /fixed demo rate/);
	assert.match(text, /Collecting…/);
	assert.match(String(await page), /data-live="1"/);
});

test("the round page offers to collect a new round, to send back late payments on a partial one, and nothing for a complete one", async () => {
	const pending = ids.slice(1).map((payer) => ({ state: "pending" as const, payer }));
	assert.match(await visible(roundPage(circle, round("scheduled", pending), m)), /Collect this round/);
	const partial = roundPage(circle, round("partial", [paid(1), paid(2), paid(3), { state: "failed", payer: ids[4], invoice: invoice(4), tries: 2, reason: "QUOTA_EXCEEDED" }]), m);
	assert.match(await visible(partial), /Partly paid .* 3 paid · 0 waiting · 1 not paid/);
	assert.match(await visible(partial), /Send back any late payments/);
	const complete = await visible(roundPage(circle, round("complete", [paid(1), paid(2), paid(3), paid(4)]), m));
	assert.match(complete, /Complete · 4 paid/);
	assert.doesNotMatch(complete, /Collect this round|Send back|Finish collecting/);
	assert.match(complete, /See the receipts/);
});

test("the circle page lists members in payout order with each limit in sats and naira", async () => {
	const pending = ids.slice(1).map((payer) => ({ state: "pending" as const, payer }));
	const text = await visible(circlePage(circle, [round("scheduled", pending)], m));
	const order = names.map((n) => text.indexOf(`${n} Limit 1,010 sat (₦1,515) a month`));
	assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), text);
	assert.match(text, /Ada Limit .* gets paid in round 1/);
	assert.match(text, /Join this circle/);
	assert.match(text, /Round 1 pays Ada Not started/);
	assert.match(await visible(createPage()), /Start the circle/);
});

test("the join page asks for both links, hides them as typed, and shows the error it is given", async () => {
	const page = String(await joinPage(circle, m, { error: "The pay link and the receive link must be different links.", name: "Efe" }));
	assert.equal(page.match(/type="password"/g)?.length, 3, "both links and the passcode are masked");
	assert.doesNotMatch(page, /Demo wallet/, "no demo wallets outside the demo stack");
	const text = await visible(page);
	assert.match(text, /Pay link from your wallet/);
	assert.match(text, /Receive link from your wallet/);
	assert.match(text, /must be different links/);
	assert.match(page, /value="Efe"/);
});

test("the join page asks for a pay limit that renews as often as the circle pays", async () => {
	for (const cadence of ["weekly", "monthly"] as const) {
		const text = await visible(joinPage({ ...circle, cadence }, m));
		assert.match(text, new RegExp(`Make it with a ${cadence} limit of at least 1,010 sat, which covers 1,000 sat and the routing fee`));
		assert.doesNotMatch(text, new RegExp(`${cadence === "weekly" ? "monthly" : "weekly"} limit`));
	}
});

test("the receipts page lists each paid contribution with its payment hash and no failed one", async () => {
	const r = round("partial", [paid(1), paid(2), { state: "failed", payer: ids[3], invoice: invoice(3), tries: 2, reason: "QUOTA_EXCEEDED" }]);
	const text = await visible(receiptsPage(circle, [r], m));
	assert.match(text, /Round 1, paid to Ada/);
	assert.match(text, /Bola \(member2\) paid 1,000 sat 1{64}/);
	assert.match(text, /Chidi \(member3\) paid 1,000 sat 2{64}/);
	assert.doesNotMatch(text, /Dayo/);
	assert.match(text, new RegExp(`Circle key ${"a".repeat(64)}`));
});

test("each payer who has not paid gets a reminder with a copy button, and a paid payer gets none", async () => {
	const waiting: Contribution = { state: "pending", payer: ids[2] };
	const failed: Contribution = { state: "failed", payer: ids[3], invoice: invoice(3), tries: 2, reason: "QUOTA_EXCEEDED" };
	const reminders = new Map([
		[ids[2], "Hi Member 3, pay 1000 sats"],
		[ids[3], "Hi Member 4, pay 1000 sats"],
	]);
	const page = roundPage(circle, round("partial", [paid(1), waiting, failed, paid(4)]), m, { reminders });
	assert.match((await rowOf(page, "member3")).text, /Hi Member 3, pay 1000 sats Copy for WhatsApp/);
	assert.match((await rowOf(page, "member4")).text, /Hi Member 4, pay 1000 sats Copy for WhatsApp/);
	assert.doesNotMatch((await rowOf(page, "member2")).text, /Copy for WhatsApp/);
	assert.match(String(await page), /data-copy="Hi Member 3, pay 1000 sats"/);
});

test("the join page offers the demo wallets in the same form when the stack has them", async () => {
	const page = String(await joinPage(circle, m, { demo: 5 }));
	assert.equal(page.match(/<form/g)?.length, 1);
	assert.equal(page.match(/<option value="\d">Demo wallet \d<\/option>/g)?.length, 5);
	assert.match(page, /name="use" value="demo" formnovalidate/);
});
