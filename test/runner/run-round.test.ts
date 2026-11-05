import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import type { Event } from "nostr-tools/pure";
import type { RoundReport } from "../../scripts/e2e.ts";
import { type RoundStore, runRound } from "../../src/run-round.ts";
import { type FailReason, type Invoice, memberId, type PaymentHash, paymentHash, type Preimage, preimage, roundId, sats } from "../../src/round/types.ts";
import type { Member } from "../../src/store/sqlite.ts";
import type { HoldState, Wallet } from "../../src/wallet/nwc.ts";

const members: Member[] = ["ada", "bola", "chidi"].map((n) => ({ id: memberId(n), name: n, pay: `pay:${n}`, receive: `receive:${n}` }));

function fakeStore(): RoundStore {
	const rounds = new Map<number, string>();
	const invoices = new Map<string, number>();
	const receipts = new Map<string, { event: Event; published: boolean }>();
	const holds = new Map<string, { preimage: Preimage; settleSent: boolean }>();
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
		holdPreimage(round, payer) {
			const key = `${round}:${payer}`;
			if (!holds.has(key)) holds.set(key, { preimage: preimage(randomBytes(32).toString("hex")), settleSent: false });
			return holds.get(key)?.preimage as Preimage;
		},
		markSettleSent(round, payer) {
			const h = holds.get(`${round}:${payer}`);
			if (h) h.settleSent = true;
		},
		settleSent: (round, payer) => holds.get(`${round}:${payer}`)?.settleSent === true,
	};
}

type PayReply = Awaited<ReturnType<Wallet["pay"]>>;
/**
 * `landed` puts the payment on hold at the payee's hub. `stuck` leaves it in the network until `deliver`.
 * `lost` holds it but the payer's wallet never replies. A reply object is a refusal that sends nothing.
 */
type Behavior = { pay?: (uri: string, invoice: Invoice) => PayReply | "landed" | "stuck" | "lost" | undefined; settled?: () => void };

type Htlc = { payer: string; state: "network" | "held" | "settled" | "refunded"; reply?: (r: PayReply) => void };
type Hold = { invoice: Invoice; cancelled: boolean; htlc?: Htlc };

const nameOf = (uri: string) => uri.slice(uri.indexOf(":") + 1);
const hashOf = (p: string) => paymentHash(createHash("sha256").update(Buffer.from(p, "hex")).digest("hex"));

/**
 * One Lightning network shared by every member's wallet, on a clock that only the runner's `sleep` and the waits
 * of a silent wallet move. The payee's hub holds each payment until the runner settles or cancels it. Like Alby Hub
 * v1.24.6, it also holds a payment that arrives after a cancel, where no later cancel reaches it.
 */
function lightning(clock = { ms: 1_700_000_000_000 }) {
	const holds = new Map<PaymentHash, Hold>();
	const balance = new Map<string, number>();
	const calls = { mints: [] as Invoice[], pays: [] as { uri: string; hash: string }[], lookups: [] as string[], settles: [] as string[], cancels: [] as string[] };
	const waiting: { until: number; reply: (r: PayReply) => void }[] = [];
	let behavior: Behavior = {};
	let payeeSilent = false;
	let epoch = 0;
	const dead = new Set<number>();
	const never = <T>() => new Promise<T>(() => {});

	const move = (who: string, sat: number) => balance.set(who, (balance.get(who) ?? 0) + sat);
	const arrive = (hold: Hold) => {
		if (hold.htlc?.state === "network") hold.htlc.state = "held";
	};
	const refund = (hold: Hold) => {
		const h = hold.htlc;
		if (!h || (h.state !== "held" && h.state !== "network")) return;
		h.state = "refunded";
		h.reply?.({ error: "PAYMENT_FAILED" });
	};
	/** Moves the clock, then times out every pay whose wallet has waited past its limit. */
	const advance = (ms: number) => {
		clock.ms += ms;
		for (const w of waiting.splice(0)) {
			if (w.until <= clock.ms) w.reply({ error: "TIMEOUT" });
			else waiting.push(w);
		}
	};

	const wallet = (e: number) => (uri: string): Wallet => {
		const payee = async <T>(ms: number, answer: () => T): Promise<T | undefined> => {
			if (dead.has(e)) return never();
			if (!payeeSilent) return answer();
			advance(ms);
			return undefined;
		};
		return {
			async makeHoldInvoice(amount, _description, expirySec, hash, ms) {
				const invoice = await payee(ms, () => {
					const minted = { paymentHash: hash, bolt11: `lnbcrt-${hash}`, amount, expiresAt: Math.floor(clock.ms / 1000) + expirySec };
					holds.set(hash, { invoice: minted, cancelled: false });
					calls.mints.push(minted);
					return minted;
				});
				if (!invoice) throw new Error("no reply");
				return invoice;
			},
			async pay(invoice, ms) {
				if (dead.has(e)) return never();
				calls.pays.push({ uri, hash: invoice.paymentHash });
				const how = behavior.pay?.(uri, invoice) ?? "landed";
				if (typeof how === "object") return how;
				const hold = holds.get(invoice.paymentHash);
				if (!hold || hold.htlc) return { error: "PAYMENT_FAILED" };
				return new Promise<PayReply>((resolve) => {
					const reply = (r: PayReply) => {
						if (!dead.has(e)) resolve(r);
					};
					hold.htlc = { payer: nameOf(uri), state: "network", reply: how === "lost" ? undefined : reply };
					if (how !== "stuck") arrive(hold);
					waiting.push({ until: clock.ms + Math.min(20_000, ms), reply });
				});
			},
			async lookup(invoice, ms) {
				return payee(ms, (): HoldState => {
					calls.lookups.push(invoice.paymentHash);
					const hold = holds.get(invoice.paymentHash);
					if (hold?.htlc?.state === "settled") return "settled";
					if (!hold || hold.cancelled) return "gone";
					return hold.htlc?.state === "held" ? "accepted" : "open";
				});
			},
			async settle(pre, ms) {
				await payee(ms, () => {
					const hold = holds.get(hashOf(pre));
					calls.settles.push(hashOf(pre));
					const h = hold?.htlc;
					if (!hold || hold.cancelled || h?.state !== "held") return;
					h.state = "settled";
					move(h.payer, -hold.invoice.amount);
					move(nameOf(uri), hold.invoice.amount);
					h.reply?.({ preimage: pre });
					behavior.settled?.();
				});
			},
			async cancel(invoice, ms) {
				await payee(ms, () => {
					const hold = holds.get(invoice.paymentHash);
					calls.cancels.push(invoice.paymentHash);
					if (!hold || hold.cancelled || hold.htlc?.state === "settled") return;
					hold.cancelled = true;
					if (hold.htlc?.state === "held") refund(hold);
				});
			},
			close() {},
		};
	};
	const published: Event[] = [];
	let relayDown = false;
	const run = (id: number, store: RoundStore, b: Behavior = {}) => {
		behavior = b;
		const e = ++epoch;
		return runRound(roundId(id), {
			store,
			members,
			connect: wallet(e),
			publish: async (events) => {
				if (relayDown) throw new Error("relay down");
				published.push(...events);
			},
			circleKey: randomBytes(32),
			contribution: sats(1000),
			now: () => clock.ms,
			sleep: async (ms) => {
				if (dead.has(e)) return never();
				advance(ms);
			},
		});
	};
	return {
		run,
		calls,
		clock,
		published,
		balance: (who: string) => balance.get(who) ?? 0,
		/** Stops the latest run where it stands, as a killed process would. */
		kill: () => dead.add(epoch),
		/** A payment that was `stuck` in the network reaches the payee's hub now. */
		deliver: (hash: string) => {
			const hold = holds.get(paymentHash(hash));
			if (hold) arrive(hold);
		},
		setPayeeSilent: (silent: boolean) => (payeeSilent = silent),
		setRelayDown: (down: boolean) => (relayDown = down),
	};
}

const hashes = (r: RoundReport) => r.contributions.map((c) => c.paymentHash).sort();
const tick = () => new Promise((r) => setImmediate(r));
const refuse =
	(who: string, error: FailReason) =>
	(uri: string): PayReply | undefined =>
		uri === `pay:${who}` ? { error } : undefined;
const states = (r: RoundReport) => r.contributions.map((c) => [c.member, c.state]);

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

test("the runner settles each held payment with the preimage only it holds, and the payee gets every contribution", async () => {
	const ln = lightning();
	const report = await ln.run(1, fakeStore());
	assert.equal(report.state, "complete");
	assert.deepEqual(ln.calls.settles.sort(), hashes(report));
	assert.deepEqual([ln.balance("ada"), ln.balance("bola"), ln.balance("chidi")], [2000, -1000, -1000]);
});

test("a run killed mid-pay resumes by looking up every open invoice, settles what the payee holds, and mints no new one", async () => {
	const ln = lightning();
	const store = fakeStore();
	void ln.run(1, store, {
		pay: (uri) => {
			if (ln.calls.pays.length === 2) ln.kill();
			return uri === "pay:bola" ? "lost" : "stuck";
		},
	});
	while (ln.calls.pays.length < 2) await tick();
	const minted = ln.calls.mints.map((i) => i.paymentHash).sort();
	const lookupsBefore = ln.calls.lookups.length;

	const report = await ln.run(1, store);
	assert.deepEqual(ln.calls.lookups.slice(lookupsBefore, lookupsBefore + 2).sort(), minted);
	assert.equal(ln.calls.mints.length, 2);
	assert.deepEqual(hashes(report), minted);
	assert.deepEqual(states(report), [
		["bola", "paid"],
		["chidi", "failed"],
	]);
	assert.equal(ln.balance("bola"), -1000);
	assert.equal(ln.balance("chidi"), 0);
});

test("a payment that reaches the payee's hub after the runner failed it is never settled, and the payer's balance does not move", async () => {
	const ln = lightning();
	const store = fakeStore();
	const first = await ln.run(1, store, { pay: (uri) => (uri === "pay:bola" ? "stuck" : "landed") });
	assert.deepEqual(states(first), [
		["bola", "failed"],
		["chidi", "paid"],
	]);
	const bolas = ln.calls.pays.find((p) => p.uri === "pay:bola")?.hash ?? assert.fail();
	assert.ok(ln.calls.cancels.includes(bolas), "the expired invoice is cancelled");

	ln.deliver(bolas);
	const rerun = await ln.run(1, store);
	assert.deepEqual(states(rerun), states(first));
	assert.ok(!ln.calls.settles.includes(bolas), "no settle for the failed payment");
	assert.equal(ln.balance("bola"), 0);
	assert.equal(ln.balance("ada"), 1000);
});

test("a payment the payee's hub took while it missed the cancel is refunded by the rerun's cancel, not settled", async () => {
	const ln = lightning();
	const store = fakeStore();
	const first = await ln.run(1, store, { pay: (uri) => (uri === "pay:bola" ? "stuck" : "landed"), settled: () => ln.setPayeeSilent(true) });
	assert.deepEqual(states(first), [
		["bola", "failed"],
		["chidi", "paid"],
	]);
	const bolas = ln.calls.pays.find((p) => p.uri === "pay:bola")?.hash ?? assert.fail();
	assert.ok(!ln.calls.cancels.includes(bolas), "the silent hub never got the cancel");

	ln.setPayeeSilent(false);
	ln.deliver(bolas);
	const rerun = await ln.run(1, store);
	assert.deepEqual(states(rerun), states(first));
	assert.ok(ln.calls.cancels.includes(bolas), "the rerun cancels the held payment");
	assert.ok(!ln.calls.settles.includes(bolas), "no settle for the failed payment");
	assert.equal(ln.balance("bola"), 0, "the held payment went back to bola");
});

test("a rerun of a partial round cancels its failed invoices again and pays, settles, and mints nothing", async () => {
	const ln = lightning();
	const store = fakeStore();
	const first = await ln.run(1, store, { pay: refuse("chidi", "QUOTA_EXCEEDED") });
	assert.equal(first.state, "partial");
	const before = { ...ln.calls, pays: ln.calls.pays.length, mints: ln.calls.mints.length, settles: ln.calls.settles.length, cancels: ln.calls.cancels.length };
	const rerun = await ln.run(1, store);
	assert.deepEqual(states(rerun), states(first));
	assert.deepEqual(
		[ln.calls.pays.length, ln.calls.mints.length, ln.calls.settles.length, ln.calls.cancels.length],
		[before.pays, before.mints, before.settles, before.cancels + 1],
	);
});

test("each paid contribution reaches the relay once, across a failed publish and reruns", async () => {
	const ln = lightning();
	const store = fakeStore();
	ln.setRelayDown(true);
	await assert.rejects(ln.run(1, store), /relay did not take the receipts/);
	ln.setRelayDown(false);
	const report = await ln.run(1, store);
	await ln.run(1, store);
	const tagged = ln.published.map((e) => e.tags.find((t) => t[0] === "payment_hash")?.[1]).sort();
	assert.deepEqual(tagged, hashes(report));
});

test("a payee hub that stops answering after minting fails the open payments by the runner's clock, inside the budget", async () => {
	const ln = lightning();
	const start = ln.clock.ms;
	const report = await ln.run(1, fakeStore(), {
		pay: () => {
			ln.setPayeeSilent(true);
			return "stuck";
		},
	});
	assert.deepEqual(states(report), [
		["bola", "failed"],
		["chidi", "failed"],
	]);
	assert.ok(ln.clock.ms - start <= 100_000, `the round took ${(ln.clock.ms - start) / 1000} s`);
	assert.equal(ln.balance("bola") + ln.balance("chidi"), 0);
});

test("a payee hub that never answers ends the run with a resume hint inside the budget", async () => {
	const ln = lightning();
	const start = ln.clock.ms;
	ln.setPayeeSilent(true);
	await assert.rejects(ln.run(1, fakeStore()), /no reply/);
	assert.ok(ln.clock.ms - start <= 100_000, `the run took ${(ln.clock.ms - start) / 1000} s`);
});

test("once a settle has left the runner, its clock never fails the payment, and a rerun finds it paid", async () => {
	const ln = lightning();
	const store = fakeStore();
	const start = ln.clock.ms;
	const lostThenSilent = { pay: (uri: string) => (uri === "pay:bola" ? ("lost" as const) : { error: "QUOTA_EXCEEDED" as const }), settled: () => ln.setPayeeSilent(true) };
	await assert.rejects(ln.run(1, store, lostThenSilent), /still collecting/);
	assert.ok(ln.clock.ms - start <= 100_000, `the run took ${(ln.clock.ms - start) / 1000} s`);
	ln.setPayeeSilent(false);
	const report = await ln.run(1, store);
	assert.deepEqual(states(report), [
		["bola", "paid"],
		["chidi", "failed"],
	]);
});

test("lookups that fail at once stay at least 500 ms apart, and the runner's clock fails the payment at expiry", async () => {
	const ln = lightning();
	const store = fakeStore();
	const start = ln.clock.ms;
	const report = await ln.run(1, store, { pay: refuse("chidi", "QUOTA_EXCEEDED") });
	const chidisHash = ln.calls.pays.find((p) => p.uri === "pay:chidi")?.hash;
	const chidi = ln.calls.lookups.filter((h) => h === chidisHash).length;
	assert.ok(chidi <= (ln.clock.ms - start) / 500, `${chidi} lookups in ${ln.clock.ms - start} ms`);
	assert.deepEqual(states(report), [
		["bola", "paid"],
		["chidi", "failed"],
	]);
});

test("a payment whose wallet never answers ends failed at expiry and says its invoice was cancelled, and a refusal does not", async () => {
	const ln = lightning();
	const report = await ln.run(1, fakeStore(), { pay: (uri) => (uri === "pay:bola" ? { error: "TIMEOUT" } : { error: "QUOTA_EXCEEDED" }) });
	const error = (who: string) => {
		const c = report.contributions.find((x) => x.member === who);
		return c?.state === "failed" ? (c.error ?? "") : "";
	};
	assert.match(error("bola"), /did not answer in time. Ajo cancelled the invoice when it expired, so this payment can no longer land/);
	assert.doesNotMatch(error("chidi"), /cancelled/);
});
