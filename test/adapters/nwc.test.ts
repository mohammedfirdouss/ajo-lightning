import assert from "node:assert/strict";
import { test } from "node:test";
import { NWCClient, Nip47NetworkError, Nip47PublishTimeoutError, Nip47ReplyTimeoutError, type Nip47Transaction, Nip47WalletError } from "@getalby/sdk/nwc";
import { type Invoice, paymentHash, sats } from "../../src/round/types.ts";
import { failReason, firstAlone, holdState, parseInvoice } from "../../src/wallet/nwc.ts";

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

test("a retry the hub refuses because the first pay is still in flight maps to TIMEOUT, not a failed payment", () => {
	assert.equal(failReason(new Nip47WalletError("there is already a payment pending for this invoice", "INTERNAL")), "TIMEOUT");
	assert.equal(failReason(new Nip47WalletError("received payment failed event: RecipientRejected", "INTERNAL")), "PAYMENT_FAILED");
});

test("no reply, or no way to send the request, maps to TIMEOUT so the runner looks the invoice up", () => {
	for (const e of [new Nip47ReplyTimeoutError("reply timeout", "OTHER"), new Nip47PublishTimeoutError("publish timeout", "OTHER"), new Nip47NetworkError("relay down", "OTHER"), new Error("socket hang up")]) {
		assert.equal(failReason(e), "TIMEOUT", e.message);
	}
});

const tx = (over: Partial<Nip47Transaction>) => ({ state: "pending", payment_hash: hash, ...over }) as Nip47Transaction;

test("a lookup reports a held payment as accepted, and a cancelled or expired invoice as gone", () => {
	assert.equal(holdState(tx({ state: "settled" }), invoice), "settled");
	assert.equal(holdState(tx({ state: "accepted" }), invoice), "accepted");
	assert.equal(holdState(tx({ state: "pending" }), invoice), "open");
	assert.equal(holdState(tx({ state: "failed" }), invoice), "gone");
	assert.equal(holdState(tx({ state: "expired" as Nip47Transaction["state"] }), invoice), "gone");
});

test("a lookup reply about another invoice is refused", () => {
	assert.throws(() => holdState(tx({ payment_hash: "cd".repeat(32) }), invoice), /looked up/);
});

test("a minted hold invoice must carry the runner's hash and ask for the contribution, in whole sats", () => {
	const made = tx({ invoice: "lnbcrt10u1...", amount: 1_000_000, expires_at: 1_000 });
	assert.deepEqual(parseInvoice(made, sats(1000), hash), invoice);
	assert.throws(() => parseInvoice(made, sats(1000), paymentHash("cd".repeat(32))), /minted payment hash/);
	assert.throws(() => parseInvoice({ ...made, amount: 999_000 }, sats(1000), hash), /minted 999 sat/);
	assert.throws(() => parseInvoice({ ...made, amount: 1_000_500 }, sats(1000), hash), /without/);
	assert.throws(() => parseInvoice({ ...made, payment_hash: "nothex" }, sats(1000), hash), /not a payment hash/);
});

test("a wallet refusal leaves no SDK stack trace on stderr, and other errors still print", async (t) => {
	const written: string[] = [];
	t.mock.method(process.stderr, "write", (chunk: string) => written.push(String(chunk)) > 0);
	const client = new NWCClient({ nostrWalletConnectUrl: `nostr+walletconnect://${"ab".repeat(32)}?relay=ws://127.0.0.1:9&secret=${"cd".repeat(32)}` });
	t.after(() => client.close());
	t.mock.method(client as unknown as { executeNip47Request: () => Promise<never> }, "executeNip47Request", async () => {
		throw new Nip47WalletError("Insufficient budget", "QUOTA_EXCEEDED");
	});
	await assert.rejects(client.payInvoice({ invoice: "lnbcrt10u1..." }), Nip47WalletError);
	console.error("run-round: something else");
	assert.deepEqual(written, ["run-round: something else\n"]);
});

test("a client's first request runs alone, and once a wallet has answered, requests run at once", async () => {
	const send = firstAlone();
	const started: string[] = [];
	const answers = new Map<string, () => void>();
	const req = (name: string, fail?: Error) => () => {
		started.push(name);
		return new Promise<string>((resolve, reject) => answers.set(name, () => (fail ? reject(fail) : resolve(name))));
	};
	const tick = () => new Promise((r) => setImmediate(r));

	const lost = send(req("a", new Error("no info event (kind 13194) returned from relay")));
	const b = send(req("b"));
	const c = send(req("c"));
	await tick();
	assert.deepEqual(started, ["a"]);
	answers.get("a")?.();
	await assert.rejects(lost);
	await tick();
	assert.deepEqual(started, ["a", "b"]);
	answers.get("b")?.();
	assert.equal(await b, "b");
	await tick();
	assert.deepEqual(started, ["a", "b", "c"]);
	const d = send(req("d"));
	const e = send(req("e", new Nip47WalletError("not found", "NOT_FOUND")));
	await tick();
	assert.deepEqual(started, ["a", "b", "c", "d", "e"]);
	for (const k of ["c", "d", "e"]) answers.get(k)?.();
	assert.deepEqual(await Promise.allSettled([c, d, e]).then((r) => r.map((x) => x.status)), ["fulfilled", "fulfilled", "rejected"]);
});
