import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import type { Event } from "nostr-tools/pure";
import type { RoundReport } from "../../scripts/e2e.ts";
import { type RoundStore, runRound } from "../../src/run-round.ts";
import { type FailReason, type Invoice, memberId, paymentHash, type Preimage, type RoundId, roundId, sats } from "../../src/round/types.ts";
import type { Member } from "../../src/store/sqlite.ts";
import type { LookupState, Wallet } from "../../src/wallet/nwc.ts";

const members: Member[] = ["ada", "bola", "chidi"].map((n) => ({ id: memberId(n), name: n, pay: `pay:${n}`, receive: `receive:${n}` }));

function fakeStore(): RoundStore {
	const rounds = new Map<number, string>();
	const invoices = new Map<string, number>();
	const receipts = new Map<string, { event: Event; published: boolean }>();
	return {
		round: (id) => {
			const r = rounds.get(id);
			return r === undefined ? undefined : JSON.parse(r);
		},
		roundOfInvoice: (hash) => invoices.get(hash),
		saveRound(round, newInvoice) {
			rounds.set(round.id, JSON.stringify(round));
			if (newInvoice) invoices.set(newInvoice, round.id);
		},
		hasReceipt: (hash) => receipts.has(hash),
		addReceipt: (hash, event) => receipts.set(hash, { event, published: false }),
		unpublishedReceipts: () => [...receipts.values()].filter((r) => !r.published).map((r) => r.event),
		markPublished(events) {
			for (const r of receipts.values()) if (events.some((e) => e.id === r.event.id)) r.published = true;
		},
	};
}

type PayReply = Awaited<ReturnType<Wallet["pay"]>>;
type Behavior = {
	mint?: (fresh: Invoice) => Invoice;
	pay?: (uri: string, invoice: Invoice) => PayReply | "landed" | "lost" | "hang" | undefined;
	lookup?: (invoice: Invoice, expiredFromSec: number) => LookupState | undefined;
};

/** One Lightning network shared by every member's wallet, on a clock that only `sleep` and failed lookups move. */
function lightning(clock = { ms: 1_700_000_000_000 }) {
	const preimages = new Map<string, Preimage>();
	const settled = new Set<string>();
	const calls = { mints: [] as Invoice[], pays: [] as { uri: string; hash: string }[], lookups: [] as string[] };
	let behavior: Behavior = {};
	const settle = (invoice: Invoice) => {
		settled.add(invoice.paymentHash);
		return { preimage: preimages.get(invoice.paymentHash) as Preimage };
	};
	const wallet = (uri: string): Wallet => ({
		async makeInvoice(amount, _description, expirySec) {
			const pre = randomBytes(32).toString("hex") as Preimage;
			const hash = paymentHash(createHash("sha256").update(Buffer.from(pre, "hex")).digest("hex"));
			preimages.set(hash, pre);
			const fresh = { paymentHash: hash, bolt11: `lnbcrt-${hash}`, amount, expiresAt: Math.floor(clock.ms / 1000) + expirySec };
			const invoice = behavior.mint?.(fresh) ?? fresh;
			calls.mints.push(invoice);
			return invoice;
		},
		async pay(invoice) {
			calls.pays.push({ uri, hash: invoice.paymentHash });
			const reply = behavior.pay?.(uri, invoice) ?? "landed";
			if (reply === "hang") return new Promise(() => {});
			if (reply === "landed") return settle(invoice);
			if (reply === "lost") {
				settle(invoice);
				return new Promise(() => {});
			}
			return reply;
		},
		async lookup(invoice, expiredFromSec) {
			calls.lookups.push(invoice.paymentHash);
			if (behavior.lookup) return behavior.lookup(invoice, expiredFromSec);
			if (settled.has(invoice.paymentHash)) return "settled";
			return clock.ms / 1000 >= expiredFromSec ? "expired" : "open";
		},
		close() {},
	});
	const published: Event[] = [];
	let relayDown = false;
	const run = (id: number, store: RoundStore, b: Behavior = {}) => {
		behavior = b;
		return runRound(roundId(id) as RoundId, {
			store,
			members,
			connect: wallet,
			publish: async (events) => {
				if (relayDown) throw new Error("relay down");
				published.push(...events);
			},
			circleKey: randomBytes(32),
			contribution: sats(1000),
			now: () => clock.ms,
			sleep: async (ms) => {
				clock.ms += ms;
			},
		});
	};
	return { run, calls, clock, published, setRelayDown: (down: boolean) => (relayDown = down) };
}

const hashes = (r: RoundReport) => r.contributions.map((c) => c.paymentHash).sort();
const tick = () => new Promise((r) => setImmediate(r));
const refuse =
	(who: string, error: FailReason) =>
	(uri: string): PayReply | undefined =>
		uri === `pay:${who}` ? { error } : undefined;

test("each invoice is in the store before the payer's wallet is asked to pay it", async () => {
	const ln = lightning();
	const store = fakeStore();
	const seen: unknown[] = [];
	await ln.run(1, store, {
		pay: (_uri, invoice) => {
			const c = store.round(roundId(1))?.contributions.find((x) => "invoice" in x && x.invoice.paymentHash === invoice.paymentHash);
			seen.push([c?.state, store.roundOfInvoice(invoice.paymentHash)]);
			return "landed";
		},
	});
	assert.deepEqual(seen, [
		["invoiced", 1],
		["invoiced", 1],
	]);
});

test("a run killed mid-pay resumes by looking up every open invoice, and mints no new one", async () => {
	const ln = lightning();
	const store = fakeStore();
	void ln.run(1, store, { pay: (uri) => (uri === "pay:bola" ? "lost" : "hang") });
	while (ln.calls.pays.length < 2) await tick();
	const minted = ln.calls.mints.map((i) => i.paymentHash).sort();

	const report = await ln.run(1, store);
	assert.deepEqual(ln.calls.lookups.slice(0, 2).sort(), minted);
	assert.equal(ln.calls.mints.length, 2);
	assert.equal(report.state, "complete");
	assert.deepEqual(hashes(report), minted);
});

test("a partial round looks up its failed invoices on at most three reruns", async () => {
	const ln = lightning();
	const store = fakeStore();
	const first = await ln.run(1, store, { pay: refuse("chidi", "QUOTA_EXCEEDED") });
	assert.equal(first.state, "partial");
	const looked: boolean[] = [];
	for (let i = 0; i < 4; i++) {
		const before = ln.calls.lookups.length;
		const r = await ln.run(1, store);
		assert.equal(r.state, "partial");
		looked.push(ln.calls.lookups.length > before);
	}
	assert.deepEqual(looked, [true, true, true, false]);
	assert.equal(ln.calls.mints.length, 2);
});

test("a payee hash used in an earlier round is refused before anyone pays it", async () => {
	const ln = lightning();
	const store = fakeStore();
	await ln.run(1, store);
	const reused = ln.calls.mints[0];
	const paysBefore = ln.calls.pays.length;
	await assert.rejects(ln.run(2, store, { mint: (fresh) => ({ ...fresh, paymentHash: reused.paymentHash }) }), /already used in round 1/);
	assert.equal(ln.calls.pays.length, paysBefore);
});

test("each paid contribution reaches the relay once, across a failed publish and reruns", async () => {
	const ln = lightning();
	const store = fakeStore();
	ln.setRelayDown(true);
	await assert.rejects(ln.run(1, store), /relay down/);
	ln.setRelayDown(false);
	const report = await ln.run(1, store);
	await ln.run(1, store);
	const tagged = ln.published.map((e) => e.tags.find((t) => t[0] === "payment_hash")?.[1]).sort();
	assert.deepEqual(tagged, hashes(report));
});

test("lookups that fail at once stay at least 500 ms apart after the invoice's expiry", async () => {
	const clock = { ms: 1_700_000_000_000 };
	const ln = lightning(clock);
	const start = clock.ms;
	const chidisHash = () => ln.calls.pays.find((p) => p.uri === "pay:chidi")?.hash;
	await assert.rejects(
		ln.run(1, fakeStore(), {
			pay: refuse("chidi", "QUOTA_EXCEEDED"),
			lookup: (invoice) => {
				clock.ms += 1;
				return invoice.paymentHash === chidisHash() ? undefined : "settled";
			},
		}),
		/still collecting/,
	);
	const chidi = ln.calls.lookups.filter((h) => h === chidisHash()).length;
	assert.ok(chidi <= (clock.ms - start) / 500, `${chidi} lookups in ${clock.ms - start} ms`);
});

test("a payment whose wallet never answers ends failed once the run's wait is over", async () => {
	const ln = lightning();
	const report = await ln.run(1, fakeStore(), { pay: (uri) => (uri === "pay:bola" ? { error: "TIMEOUT" } : "landed") });
	assert.equal(report.state, "partial");
	assert.deepEqual(
		report.contributions.map((c) => [c.member, c.state]),
		[
			["bola", "failed"],
			["chidi", "paid"],
		],
	);
});

test("a payment not seen before the runner's expiry says a rerun can still pick it up, and a refusal does not", async () => {
	const ln = lightning();
	const report = await ln.run(1, fakeStore(), { pay: (uri) => (uri === "pay:bola" ? { error: "TIMEOUT" } : { error: "QUOTA_EXCEEDED" }) });
	const error = (who: string) => {
		const c = report.contributions.find((x) => x.member === who);
		return c?.state === "failed" ? (c.error ?? "") : "";
	};
	assert.match(error("bola"), /no payment seen before the invoice expired; a rerun will pick it up if it still lands/i);
	assert.doesNotMatch(error("chidi"), /rerun/);
});
