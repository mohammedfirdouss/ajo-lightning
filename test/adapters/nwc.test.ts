import assert from "node:assert/strict";
import { test } from "node:test";
import { Nip47NetworkError, Nip47PublishTimeoutError, Nip47ReplyTimeoutError, type Nip47Transaction, Nip47WalletError } from "@getalby/sdk/nwc";
import { type Invoice, paymentHash, sats } from "../../src/round/types.ts";
import { failReason, lookupState, parseInvoice } from "../../src/wallet/nwc.ts";

const hash = paymentHash("ab".repeat(32));
const invoice: Invoice = { paymentHash: hash, bolt11: "lnbcrt10u1...", amount: sats(1000), expiresAt: 1_000 };

test("a wallet refusal maps by its code, whatever the message says", () => {
	const cases: [string, string][] = [
		["QUOTA_EXCEEDED", "QUOTA_EXCEEDED"],
		["INSUFFICIENT_BALANCE", "INSUFFICIENT_BALANCE"],
		["PAYMENT_FAILED", "PAYMENT_FAILED"],
		["RESTRICTED", "PAYMENT_FAILED"],
		["NOT_FOUND", "PAYMENT_FAILED"],
		["RATE_LIMITED", "PAYMENT_FAILED"],
		["INTERNAL", "PAYMENT_FAILED"],
		["OTHER", "PAYMENT_FAILED"],
	];
	for (const [code, reason] of cases) {
		assert.equal(failReason(new Nip47WalletError("Your app does not have enough budget remaining", code)), reason, code);
	}
});

test("no reply, or no way to send the request, maps to TIMEOUT so the runner looks the invoice up", () => {
	for (const e of [new Nip47ReplyTimeoutError("reply timeout", "OTHER"), new Nip47PublishTimeoutError("publish timeout", "OTHER"), new Nip47NetworkError("relay down", "OTHER"), new Error("socket hang up")]) {
		assert.equal(failReason(e), "TIMEOUT", e.message);
	}
});

const tx = (over: Partial<Nip47Transaction>) => ({ state: "pending", payment_hash: hash, ...over }) as Nip47Transaction;

test("a lookup counts an unpaid invoice expired only from the time the caller names", () => {
	const from = invoice.expiresAt + 60;
	assert.equal(lookupState(tx({ state: "settled" }), invoice, from + 1, from), "settled");
	assert.equal(lookupState(tx({ state: "failed" }), invoice, 0, from), "expired");
	assert.equal(lookupState(tx({ state: "pending" }), invoice, from - 1, from), "open");
	assert.equal(lookupState(tx({ state: "accepted" }), invoice, from - 1, from), "open");
	assert.equal(lookupState(tx({ state: "pending" }), invoice, from, from), "expired");
});

test("a lookup reply about another invoice is refused", () => {
	assert.throws(() => lookupState(tx({ payment_hash: "cd".repeat(32) }), invoice, 0, 0), /looked up/);
});

test("a minted invoice must ask for the contribution, in whole sats", () => {
	const made = tx({ invoice: "lnbcrt10u1...", amount: 1_000_000, expires_at: 1_000 });
	assert.deepEqual(parseInvoice(made, sats(1000)), invoice);
	assert.throws(() => parseInvoice({ ...made, amount: 999_000 }, sats(1000)), /minted 999 sat/);
	assert.throws(() => parseInvoice({ ...made, amount: 1_000_500 }, sats(1000)), /without/);
	assert.throws(() => parseInvoice({ ...made, payment_hash: "nothex" }, sats(1000)), /not a payment hash/);
});
