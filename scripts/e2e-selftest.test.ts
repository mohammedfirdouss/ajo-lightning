import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { checkReceipts, checkRerun, checkSettled, parseReport, type RoundReport } from "./e2e.ts";
import { expectDelta, expectSteady, type Stack } from "./stack.ts";

let balanceSat = 150_000;
const settled = (paymentHash: string, amountMsat = 1_000_000) => ({ type: "incoming", state: "settled", paymentHash, amountMsat });
const transactions = new Map([
	["a".repeat(64), settled("a".repeat(64))],
	["b".repeat(64), settled("b".repeat(64))],
	["c".repeat(64), { ...settled("c".repeat(64)), state: "pending" }],
	["d".repeat(64), settled("d".repeat(64), 999_000)],
]);
const server = createServer((req, res) => {
	res.setHeader("content-type", "application/json");
	if (req.url === "/api/channels") return res.end(JSON.stringify([{ active: true, localBalanceMsat: balanceSat * 1000 }]));
	const tx = transactions.get(req.url?.replace("/api/transactions/", "") ?? "");
	res.statusCode = tx ? 200 : 500;
	res.end(JSON.stringify(tx ?? { message: "The transaction requested was not found" }));
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
after(() => server.close());
const hub = { name: "fakehub", url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, token: "t" };
const later = (ms: number, sat: number) => setTimeout(() => (balanceSat = sat), ms);

const circleKey = generateSecretKey();
const names = ["member1", "member2", "member3"];
const stack = { contributionSat: 1000, members: names.map((name) => ({ ...hub, name })) } as Stack;
const round1: RoundReport = {
	round: 1,
	payee: "member1",
	circlePubkey: getPublicKey(circleKey),
	state: "complete",
	contributions: [
		{ member: "member2", state: "paid", paymentHash: "a".repeat(64) },
		{ member: "member3", state: "paid", paymentHash: "b".repeat(64) },
	],
};
const receipt = (hash: string, key = circleKey) =>
	finalizeEvent({ kind: 1, created_at: 1, tags: [["t", "ajo-receipt"], ["payment_hash", hash]], content: "" }, key);
const receipts = [receipt("a".repeat(64)), receipt("b".repeat(64))];

test("the delta check passes once the hub balance rises by exactly the contribution total", async () => {
	balanceSat = 150_000;
	later(600, 154_000);
	await expectDelta(hub, 150_000_000, 4_000_000, 3_000);
});

test("the delta check fails when the hub balance rises by any other amount", async () => {
	balanceSat = 153_000;
	await assert.rejects(expectDelta(hub, 150_000_000, 4_000_000, 500), /fakehub moved by 3000 sat, expected 4000 sat/);
	balanceSat = 155_000;
	await assert.rejects(expectDelta(hub, 150_000_000, 4_000_000, 500), /moved by 5000 sat, expected 4000 sat/);
});

test("the no-double-charge check passes while the balance holds and fails when it moves", async () => {
	balanceSat = 149_000;
	await expectSteady(hub, 149_000_000, 600);
	later(300, 147_999);
	await assert.rejects(expectSteady(hub, 149_000_000, 1_000), /moved by -1001 sat, expected no change/);
});

const withHash = (paymentHash: string): RoundReport => ({
	...round1,
	contributions: [round1.contributions[0], { member: "member3", state: "paid", paymentHash }],
});

test("the report parser accepts 64 lowercase hex hashes and rejects any other paid hash", () => {
	assert.deepEqual(parseReport(1, JSON.stringify(round1)), round1);
	for (const hash of ["x2", "B".repeat(64), undefined]) {
		assert.throws(() => parseReport(1, JSON.stringify(withHash(hash as string))), /does not match RoundReport/);
	}
});

test("the settlement check passes when the payee's hub settled every paid hash", async () => {
	await checkSettled(stack, round1);
});

test("the settlement check rejects a preimage, an unsettled payment, and a wrong amount", async () => {
	for (const hash of ["e".repeat(64), "c".repeat(64), "d".repeat(64)]) {
		await assert.rejects(checkSettled(stack, withHash(hash)), new RegExp(`member1's hub has no settled incoming 1000 sat payment with member3's hash ${hash}`));
	}
});

test("the receipt check passes one circle-signed receipt per payer", () => {
	assert.match(checkReceipts(stack, round1, receipts), /2 receipts signed by the circle's key/);
});

test("the receipt check rejects an empty report", () => {
	assert.throws(() => checkReceipts(stack, { ...round1, contributions: [] }, receipts), /reports 0 paid contributions/);
});

test("the receipt check ignores a hash outside the payment_hash tag", () => {
	const loose = finalizeEvent({ kind: 1, created_at: 1, tags: [["t", "ajo-receipt"]], content: "b".repeat(64) }, circleKey);
	assert.throws(() => checkReceipts(stack, round1, [receipts[0], loose]), /0 receipts for member3's payment/);
});

test("the receipt check rejects a receipt signed by another key", () => {
	const forged = [receipts[0], receipt("b".repeat(64), generateSecretKey())];
	assert.throws(() => checkReceipts(stack, round1, forged), /member3's payment is signed by [0-9a-f]{64}, not the circle's key/);
});

test("the rerun check passes a rerun that reports round 1's payments unchanged", () => {
	checkRerun(round1, structuredClone(round1));
});

test("the rerun check rejects a runner that minted a new invoice and was refused", () => {
	const reminted: RoundReport = {
		...round1,
		state: "partial",
		contributions: [
			round1.contributions[0],
			{ member: "member3", state: "failed", paymentHash: "c".repeat(64), error: "member3's spending cap is used up" },
		],
	};
	assert.throws(() => checkRerun(round1, reminted), /reports member3 as failed/);
	const repaid = { ...round1, contributions: [round1.contributions[0], { member: "member3", state: "paid" as const, paymentHash: "c".repeat(64) }] };
	assert.throws(() => checkRerun(round1, repaid), /lists member3 as paid with hash c{64}, expected paid with hash b{64}/);
});
