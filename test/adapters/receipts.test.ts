import assert from "node:assert/strict";
import { test } from "node:test";
import { generateSecretKey, getPublicKey, verifyEvent } from "nostr-tools/pure";
import { RECEIPT_TAG, receiptEvent } from "../../src/receipts/nostr.ts";
import { memberId, paymentHash, roundId, sats } from "../../src/round/types.ts";

const key = generateSecretKey();
const receipt = { round: roundId(3), payer: memberId("1f0e2d3c4b5a6978"), amount: sats(1000), paymentHash: paymentHash("ab".repeat(32)) };

test("a receipt carries only the round, pseudonymous payer, amount, and payment hash", () => {
	const e = receiptEvent(key, receipt, 1_700_000_000);
	assert.deepEqual(Object.keys(e).sort(), ["content", "created_at", "id", "kind", "pubkey", "sig", "tags"]);
	assert.deepEqual(e.tags.map(([k]) => k).sort(), ["amount", "payer", "payment_hash", "round", "t"]);
	assert.ok(e.tags.every((t) => t.length === 2));
	assert.deepEqual(Object.fromEntries(e.tags), { t: RECEIPT_TAG, round: "3", payer: receipt.payer, amount: "1000", payment_hash: receipt.paymentHash });
	assert.equal(e.content, "Ajo round 3: 1000 sat paid over Lightning");
});

test("a receipt is signed by the circle's key", () => {
	const e = receiptEvent(key, receipt, 1_700_000_000);
	assert.equal(e.pubkey, getPublicKey(key));
	assert.ok(verifyEvent(e));
});
