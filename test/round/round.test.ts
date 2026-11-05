import assert from "node:assert/strict";
import { test } from "node:test";
import { apply, newRound, next } from "../../src/round/round.ts";
import { memberId, preimage, type RoundEvent, roundId, sats } from "../../src/round/types.ts";
import { EXPIRES_AT, invoiceFor, type ModelAction, World } from "./world.ts";

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
	const { invoice: second } = invoiceFor("second");
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
	assert.deepEqual(w.contribution(m3), { state: "failed", payer: m3, invoice: open.invoice, tries: 1, reason: "QUOTA_EXCEEDED" });
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

test("NoPayerChargedTwice: running a partial round again looks up the expired invoice and asks no wallet to pay", () => {
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
	const failed = { state: "failed", payer: m2, invoice: c.invoice, tries: 1, reason: "TIMEOUT" };
	assert.deepEqual(w.contribution(m2), failed);
	w.RoundRunsAgain();
	assert.deepEqual(next(w.round), [{ type: "lookup", payer: m2, invoice: c.invoice }]);
	lookupAndClose(w);
	assert.equal(w.round.phase, "partial");
	assert.deepEqual(w.contribution(m2), failed);
	assert.equal(w.charged.get(m2) ?? 0, 0);
	assert.equal(w.invoices.size, 1);
});

test("NoPayerChargedTwice: a rerun after the payee wrongly reports a paid invoice expired looks it up again and never mints", () => {
	const w = new World(["member2"], 1);
	w.Start();
	w.MakeInvoice(m2);
	const c = w.contribution(m2);
	assert.equal(c.state, "invoiced");
	w.SendPay(m2);
	w.WalletSends(m2);
	w.ReplyTimesOut(m2);
	w.LatePaymentArrives();
	w.RecordReply(m2);
	assert.equal(w.charged.get(m2), 1000);
	assert.equal(w.feed({ type: "lookupReplied", payer: m2, paymentHash: c.invoice.paymentHash, invoice: "expired" }).ok, true);
	assert.equal(w.EndRound().ok, true);
	assert.equal(w.round.phase, "partial");
	w.RoundRunsAgain();
	assert.deepEqual(next(w.round), [{ type: "lookup", payer: m2, invoice: c.invoice }], "the rerun offers no makeInvoice");
	w.LookupInvoice(m2);
	assert.equal(w.EndRound().ok, true);
	assert.equal(w.round.phase, "complete");
	assert.equal(w.charged.get(m2), 1000);
	assert.equal(w.invoices.size, 1);
});

test("CompleteMeansEveryonePaid: a pay reply without a preimage that hashes to the invoice is not proof", () => {
	const w = new World(["member2"], 4);
	w.Start();
	w.MakeInvoice(m2);
	const c = w.contribution(m2);
	assert.equal(c.state, "invoiced");
	// @ts-expect-error a success reply must carry a preimage
	const bare: RoundEvent = { type: "payReplied", payer: m2 };
	const lies: RoundEvent[] = [
		bare,
		{ type: "payReplied", payer: m2, preimage: invoiceFor("someone-else").preimage },
		{ type: "payReplied", payer: m2, preimage: preimage("0".repeat(64)) },
	];
	lies.forEach((lie, i) => {
		w.SendPay(m2);
		assert.equal(w.feed(lie).ok, true);
		assert.deepEqual(w.contribution(m2), { ...c, step: "lookup", tries: i + 1, lastErr: "PAYMENT_FAILED" }, JSON.stringify(lie));
		assert.equal(w.EndRound().ok, false, "the round cannot close on a reply that proves nothing");
		w.LookupInvoice(m2);
	});
	w.SendPay(m2);
	w.WalletSends(m2);
	w.PaymentArrives(m2);
	w.RecordReply(m2);
	const { preimage: real } = invoiceFor("member2-0");
	assert.deepEqual(w.contribution(m2), { state: "paid", payer: m2, invoice: c.invoice, proof: { by: "preimage", preimage: real } });
	assert.equal(w.EndRound().ok, true);
	assert.equal(w.round.phase, "complete");
});

test("CompleteMeansEveryonePaid: the payee's lookup reporting settled is proof without a preimage", () => {
	const w = new World();
	w.Start();
	w.MakeInvoice(m2);
	w.SendPay(m2);
	w.WalletSends(m2);
	w.ReplyTimesOut(m2);
	w.LatePaymentArrives();
	w.RecordReply(m2);
	w.LookupInvoice(m2);
	assert.deepEqual(w.contribution(m2), {
		state: "paid",
		payer: m2,
		invoice: invoiceFor("member2-0").invoice,
		proof: { by: "payeeLookup" },
	});
});

test("NoPayerChargedTwice: an invoice whose payment hash another payer holds is rejected", () => {
	const w = new World(["member2", "member3"]);
	w.Start();
	w.MakeInvoice(m2);
	const taken = w.contribution(m2);
	assert.equal(taken.state, "invoiced");
	assert.equal(w.feed({ type: "invoiceMade", payer: m3, invoice: taken.invoice }).ok, false);
	assert.deepEqual(w.contribution(m3), { state: "pending", payer: m3 });
});

test("RecordMatchesWalletAtEnd: a lookup reply about another invoice is rejected", () => {
	const w = new World();
	w.Start();
	w.MakeInvoice(m2);
	w.SendPay(m2);
	w.WalletRefuses(m2, "QUOTA_EXCEEDED");
	w.RecordReply(m2);
	const c = w.contribution(m2);
	const stale = invoiceFor("an-old-invoice").invoice.paymentHash;
	for (const invoice of ["settled", "expired", "open"] as const) {
		assert.equal(w.feed({ type: "lookupReplied", payer: m2, paymentHash: stale, invoice }).ok, false, invoice);
		assert.deepEqual(w.contribution(m2), c);
	}
	w.LookupInvoice(m2);
	assert.deepEqual(next(w.round), [{ type: "pay", payer: m2, invoice: invoiceFor("member2-0").invoice }]);
});

test("PayeeGetsAtMostThePot: an invoice for any amount but the contribution is rejected", () => {
	const w = new World();
	w.Start();
	const { invoice } = invoiceFor("too-much", sats(1001));
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
