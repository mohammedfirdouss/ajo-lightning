import assert from "node:assert/strict";
import { test } from "node:test";
import { apply, newRound, next } from "../../src/round/round.ts";
import { memberId, roundId, sats } from "../../src/round/types.ts";
import { EXPIRES_AT, type ModelAction, World } from "./world.ts";

const m2 = memberId("member2");
const m3 = memberId("member3");

function replay(world: World, path: [ModelAction, () => unknown][]) {
	path.forEach(([action, step], i) => {
		step();
		assert.deepEqual(world.brokenRules(), [], `after step ${i + 1}, ${action}\n${world.trace.join("\n")}`);
	});
}

function lookupAndClose(world: World) {
	world.LookupInvoice(m2);
	assert.equal(world.EndRound().ok, true, world.trace.join("\n"));
}

const commandTypes = (w: World) => next(w.round).map((c) => c.type);

test("RecordMatchesWalletAtEnd: a reply that times out while the payment lands late ends paid (8-step path)", () => {
	const w = new World();
	replay(w, [
		["Start", () => w.Start()],
		["MakeInvoice", () => w.MakeInvoice(m2)],
		["SendPay", () => w.SendPay(m2)],
		["WalletSends", () => w.WalletSends(m2)],
		["ReplyTimesOut", () => w.ReplyTimesOut(m2)],
		["LatePaymentArrives", () => w.LatePaymentArrives()],
		["RecordReply", () => w.RecordReply(m2)],
		["EndRound", () => assert.equal(w.EndRound().ok, false, "the round closed before it checked the invoice")],
	]);
	assert.equal(w.round.phase, "collecting");
	assert.notEqual(w.contribution(m2).state, "failed");
	lookupAndClose(w);
	assert.equal(w.round.phase, "complete");
	assert.equal(w.contribution(m2).state, "paid");
	assert.equal(w.charged.get(m2), 1000);
});

test("RefusedMeansNoMoneyMoved: a refusal after a crash and a late payment ends paid (11-step path)", () => {
	const w = new World();
	replay(w, [
		["Start", () => w.Start()],
		["MakeInvoice", () => w.MakeInvoice(m2)],
		["SendPay", () => w.SendPay(m2)],
		["WalletSends", () => w.WalletSends(m2)],
		["CoordinatorCrashes", () => w.CoordinatorCrashes()],
		["CoordinatorRetries", () => w.CoordinatorRetries()],
		["LookupInvoice", () => w.LookupInvoice(m2)],
		["LatePaymentArrives", () => w.LatePaymentArrives()],
		["SendPay", () => w.SendPay(m2)],
		["WalletRefuses", () => w.WalletRefuses(m2, "QUOTA_EXCEEDED")],
		["RecordReply", () => w.RecordReply(m2)],
	]);
	assert.notEqual(w.contribution(m2).state, "failed");
	lookupAndClose(w);
	assert.equal(w.round.phase, "complete");
	assert.equal(w.contribution(m2).state, "paid");
	assert.equal(w.charged.get(m2), 1000);
});

test("NoPayerChargedTwice: a retry cannot mint a second invoice, and every retry pays the stored one", () => {
	const w = new World();
	w.Start();
	w.MakeInvoice(m2);
	const stored = w.contribution(m2);
	assert.equal(stored.state, "invoiced");
	const second = { paymentHash: "f".repeat(64), bolt11: "lnbcrt-second", amount: sats(1000), expiresAt: EXPIRES_AT };
	assert.equal(w.feed({ type: "invoiceMade", payer: m2, invoice: second }).ok, false);
	assert.deepEqual(w.contribution(m2), stored);
	w.SendPay(m2);
	w.WalletRefuses(m2, "INSUFFICIENT_BALANCE");
	w.RecordReply(m2);
	w.LookupInvoice(m2);
	assert.deepEqual(next(w.round), [{ type: "pay", payer: m2, invoice: stored.invoice }]);
	assert.equal(w.invoices.size, 1);
});

test("RecordMatchesWalletAtEnd: the round stays collecting while a pay call is outstanding, and a refusal fails only once the invoice expires", () => {
	const w = new World(["member2", "member3"]);
	w.Start();
	w.MakeInvoice(m2);
	w.MakeInvoice(m3);
	w.SendPay(m2);
	w.WalletSends(m2);
	w.PaymentArrives(m2);
	w.RecordReply(m2);
	w.SendPay(m3);
	assert.equal(w.EndRound().ok, false);
	assert.equal(w.round.phase, "collecting");
	w.WalletRefuses(m3, "QUOTA_EXCEEDED");
	w.RecordReply(m3);
	assert.equal(w.EndRound().ok, false);
	const open = w.contribution(m3);
	assert.equal(open.state, "invoiced");
	w.InvoiceExpires(open.invoice.paymentHash);
	w.LookupInvoice(m3);
	assert.equal(w.EndRound().ok, true);
	assert.equal(w.round.phase, "partial");
	assert.deepEqual(w.contribution(m3), { state: "failed", payer: m3, invoice: open.invoice, reason: "QUOTA_EXCEEDED" });
	assert.equal(w.contribution(m2).state, "paid");
	assert.deepEqual(w.brokenRules(), []);
});

test("NoPayerChargedTwice: a restart turns an outstanding pay into a lookup, so it never pays blind", () => {
	const w = new World();
	w.Start();
	w.MakeInvoice(m2);
	w.SendPay(m2);
	w.CoordinatorCrashes();
	w.CoordinatorRetries();
	assert.deepEqual(commandTypes(w), ["lookup"]);
});

test("NoPayerChargedTwice: an open invoice past the try limit is only looked up, at its expiry, never paid again", () => {
	const w = new World(["member2"], 1);
	w.Start();
	w.MakeInvoice(m2);
	w.SendPay(m2);
	w.WalletRefuses(m2, "QUOTA_EXCEEDED");
	w.RecordReply(m2);
	const c = w.contribution(m2);
	assert.equal(c.state, "invoiced");
	assert.deepEqual(next(w.round), [{ type: "lookup", payer: m2, invoice: c.invoice }], "the first lookup after a failed pay runs now");
	w.LookupInvoice(m2);
	assert.deepEqual(next(w.round), [{ type: "lookup", payer: m2, invoice: c.invoice, waitUntil: EXPIRES_AT }]);
	w.LookupInvoice(m2);
	assert.deepEqual(next(w.round), [{ type: "lookup", payer: m2, invoice: c.invoice, waitUntil: EXPIRES_AT }]);
	w.InvoiceExpires(c.invoice.paymentHash);
	lookupAndClose(w);
	assert.equal(w.round.phase, "partial");
});

test("NoPayerChargedTwice: running a partial round again asks no wallet to pay", () => {
	const w = new World();
	w.Start();
	w.MakeInvoice(m2);
	const c = w.contribution(m2);
	assert.equal(c.state, "invoiced");
	w.InvoiceExpires(c.invoice.paymentHash);
	w.SendPay(m2);
	w.WalletSends(m2);
	w.PaymentArrives(m2);
	w.RecordReply(m2);
	lookupAndClose(w);
	assert.deepEqual(w.contribution(m2), { state: "failed", payer: m2, invoice: c.invoice, reason: "TIMEOUT" });
	w.RoundRunsAgain();
	assert.deepEqual(commandTypes(w), ["close"]);
	assert.equal(w.EndRound().ok, true);
	assert.equal(w.round.phase, "partial");
	assert.equal(w.charged.get(m2) ?? 0, 0);
});

test("PayeeGetsAtMostThePot: an invoice for any amount but the contribution is rejected", () => {
	const w = new World();
	w.Start();
	const invoice = { paymentHash: "a".repeat(64), bolt11: "lnbcrt", amount: sats(1001), expiresAt: EXPIRES_AT };
	assert.equal(w.feed({ type: "invoiceMade", payer: m2, invoice }).ok, false);
	assert.equal(w.contribution(m2).state, "pending");
});

test("a round rejects the payee as a payer, a repeated payer, and events for someone outside the circle", () => {
	const setup = { id: roundId(1), payee: memberId("member1"), contribution: sats(1000) };
	assert.throws(() => newRound({ ...setup, payers: [memberId("member1"), m2] }), /payee/);
	assert.throws(() => newRound({ ...setup, payers: [m2, m2] }), /twice/);
	assert.throws(() => newRound({ ...setup, payers: [] }), /payer/);
	const started = apply(newRound({ ...setup, payers: [m2] }), { type: "start" });
	assert.equal(started.ok, true);
	assert.equal(apply(started.round, { type: "paySent", payer: memberId("stranger") }).ok, false);
});
