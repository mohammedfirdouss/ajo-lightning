import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { apply, newRound, next } from "../../src/round/round.ts";
import {
	type Applied,
	type Command,
	type FailReason,
	type Invoice,
	type MemberId,
	memberId,
	type Preimage,
	paymentHash,
	preimage,
	type Round,
	type RoundEvent,
	roundId,
	type Sats,
	sats,
} from "../../src/round/types.ts";

/** Every action in the `Next` relation of the TLA+ model AjoRound.tla, which lands in PR6, except the stuttering `Done`. */
export const MODEL_ACTIONS = [
	"Start",
	"MakeInvoice",
	"SendPay",
	"WalletRefuses",
	"WalletSends",
	"PaymentArrives",
	"ReplyTimesOut",
	"LatePaymentArrives",
	"RecordReply",
	"LookupInvoice",
	"InvoiceExpires",
	"CoordinatorCrashes",
	"CoordinatorRetries",
	"RoundRunsAgain",
	"EndRound",
] as const;
export type ModelAction = (typeof MODEL_ACTIONS)[number];

export const REFUSALS = ["QUOTA_EXCEEDED", "INSUFFICIENT_BALANCE"] as const satisfies FailReason[];
const C = 1000;
export const EXPIRES_AT = 1_800_000_000;

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** A payee invoice whose hash commits to a preimage derived from `tag`, so runs replay the same hashes. */
export function invoiceFor(tag: string, amount: Sats = sats(C)): { invoice: Invoice; preimage: Preimage } {
	const pre = preimage(sha256(Buffer.from(tag)));
	const hash = paymentHash(sha256(Buffer.from(pre, "hex")));
	return { invoice: { paymentHash: hash, bolt11: `lnbcrt-${tag}`, amount, expiresAt: EXPIRES_AT }, preimage: pre };
}

type Call = { at: "sent" | "routing"; hash: string } | { at: "replied"; hash: string; error?: FailReason };
type Move = { action: ModelAction; run: () => void };

/** The app, driven only through `next`, plus the wallets, invoices, and crashes the model lets act on their own. */
export class World {
	round: Round;
	up = true;
	crashes = 0;
	readonly invoices = new Map<string, { payer: MemberId; preimage: Preimage; state: "open" | "settled" | "expired" }>();
	readonly charged = new Map<MemberId, number>();
	received = 0;
	readonly calls = new Map<MemberId, Call>();
	/** Payers whose last pay call has neither a recorded reply nor a lookup since, so the app cannot know its outcome. */
	readonly unresolved = new Set<MemberId>();
	readonly late: string[] = [];
	readonly trace: string[] = [];
	readonly payers: MemberId[];

	constructor(names = ["member2"], maxTries = 2) {
		this.payers = names.map(memberId);
		this.round = newRound({ id: roundId(1), payee: memberId("member1"), payers: this.payers, contribution: sats(C), maxTries });
	}

	feed(event: RoundEvent): Applied {
		const r = apply(this.round, event);
		this.round = r.round;
		this.trace.push(`${JSON.stringify(event)} -> ${r.ok ? r.round.phase : `rejected: ${r.reason}`}`);
		return r;
	}

	private must(event: RoundEvent) {
		const r = this.feed(event);
		if (!r.ok) throw new Error(`the app rejected its own step ${event.type}: ${r.reason}`);
	}

	private command<T extends Command["type"]>(type: T, payer: MemberId) {
		const c = next(this.round).find((x) => x.type === type && "payer" in x && x.payer === payer);
		if (!c) throw new Error(`the app would not ${type} ${payer} now`);
		return c as Extract<Command, { type: T }>;
	}

	contribution(payer: MemberId) {
		const c = this.round.contributions.find((x) => x.payer === payer);
		if (!c) throw new Error(`no contribution for ${payer}`);
		return c;
	}

	private settle(hash: string) {
		const inv = this.invoices.get(hash);
		if (inv?.state !== "open") return;
		inv.state = "settled";
		this.charged.set(inv.payer, (this.charged.get(inv.payer) ?? 0) + C);
		this.received += C;
	}

	private call(payer: MemberId, at: Call["at"]) {
		const call = this.calls.get(payer);
		if (call?.at !== at) throw new Error(`${payer} has no call ${at}`);
		return call;
	}

	Start() {
		this.must({ type: "start" });
	}

	MakeInvoice(payer: MemberId) {
		const cmd = this.command("makeInvoice", payer);
		const { invoice, preimage } = invoiceFor(`${payer}-${this.invoices.size}`, cmd.amount);
		this.invoices.set(invoice.paymentHash, { payer, preimage, state: "open" });
		this.must({ type: "invoiceMade", payer, invoice });
	}

	SendPay(payer: MemberId) {
		const cmd = this.command("pay", payer);
		this.must({ type: "paySent", payer });
		this.unresolved.add(payer);
		this.calls.set(payer, { at: "sent", hash: cmd.invoice.paymentHash });
	}

	WalletRefuses(payer: MemberId, error: (typeof REFUSALS)[number]) {
		const { hash } = this.call(payer, "sent");
		this.calls.set(payer, { at: "replied", hash, error });
	}

	WalletSends(payer: MemberId) {
		const { hash } = this.call(payer, "sent");
		this.calls.set(payer, { at: "routing", hash });
	}

	PaymentArrives(payer: MemberId) {
		const { hash } = this.call(payer, "routing");
		const wasOpen = this.invoices.get(hash)?.state === "open";
		this.settle(hash);
		this.calls.set(payer, wasOpen ? { at: "replied", hash } : { at: "replied", hash, error: "TIMEOUT" });
	}

	ReplyTimesOut(payer: MemberId) {
		const { hash } = this.call(payer, "routing");
		this.late.push(hash);
		this.calls.set(payer, { at: "replied", hash, error: "TIMEOUT" });
	}

	LatePaymentArrives(index = 0) {
		const [hash] = this.late.splice(index, 1);
		if (hash === undefined) throw new Error("no late payment in flight");
		this.settle(hash);
	}

	RecordReply(payer: MemberId) {
		const { hash, error } = this.call(payer, "replied") as Extract<Call, { at: "replied" }>;
		this.calls.delete(payer);
		this.unresolved.delete(payer);
		const inv = this.invoices.get(hash);
		if (!inv) throw new Error(`the payee's wallet never made ${hash}`);
		this.must(error ? { type: "payReplied", payer, error } : { type: "payReplied", payer, preimage: inv.preimage });
	}

	LookupInvoice(payer: MemberId) {
		const cmd = this.command("lookup", payer);
		const state = this.invoices.get(cmd.invoice.paymentHash)?.state;
		if (!state) throw new Error(`the payee's wallet never made ${cmd.invoice.paymentHash}`);
		this.unresolved.delete(payer);
		this.must({ type: "lookupReplied", payer, invoice: state });
	}

	InvoiceExpires(hash: string) {
		const inv = this.invoices.get(hash);
		if (inv?.state !== "open") throw new Error(`invoice ${hash} is not open`);
		inv.state = "expired";
	}

	CoordinatorCrashes() {
		this.up = false;
		this.crashes++;
		for (const call of this.calls.values()) if (call.at === "routing") this.late.push(call.hash);
		this.calls.clear();
	}

	CoordinatorRetries() {
		this.up = true;
		this.must({ type: "restarted" });
	}

	/** As in the model, every unpaid payer goes back to a lookup of its stored invoice, and nobody gets a new one. */
	RoundRunsAgain() {
		const unpaid = this.round.contributions.filter((c) => c.state !== "paid");
		this.must({ type: "rerun" });
		for (const c of unpaid) {
			const asked = next(this.round).filter((cmd) => "payer" in cmd && cmd.payer === c.payer);
			const stored = "invoice" in c ? c.invoice : undefined;
			assert.deepEqual(asked, [{ type: "lookup", payer: c.payer, invoice: stored }], `the rerun must look up ${c.payer}'s stored invoice`);
		}
	}

	EndRound() {
		return this.feed({ type: "close" });
	}

	/**
	 * Judges the model's five safety rules on what the wallets hold, plus NoPayWhileUnresolved, and returns the broken ones.
	 * Reusing one invoice hides a blind second pay from the wallet rules, so NoPayWhileUnresolved watches the commands instead.
	 */
	brokenRules(): string[] {
		const paidFor = (p: MemberId) => (this.charged.get(p) ?? 0) > 0;
		const { phase, contributions } = this.round;
		const ended = phase === "complete" || phase === "partial";
		const refused = (c: (typeof contributions)[number]) => c.state === "failed" && (REFUSALS as readonly string[]).includes(c.reason);
		const broken: string[] = [];
		if (this.payers.some((p) => (this.charged.get(p) ?? 0) > C)) broken.push("NoPayerChargedTwice");
		if (this.received > this.payers.length * C) broken.push("PayeeGetsAtMostThePot");
		if (phase === "complete" && !this.payers.every(paidFor)) broken.push("CompleteMeansEveryonePaid");
		if (ended && contributions.some((c) => (c.state === "paid") !== paidFor(c.payer))) broken.push("RecordMatchesWalletAtEnd");
		if (contributions.some((c) => refused(c) && paidFor(c.payer))) broken.push("RefusedMeansNoMoneyMoved");
		if (next(this.round).some((cmd) => cmd.type === "pay" && this.unresolved.has(cmd.payer))) broken.push("NoPayWhileUnresolved");
		return broken;
	}

	moves(limits = { crashes: 1, reruns: 1 }): Move[] {
		const moves: Move[] = [];
		const add = (action: ModelAction, run: () => unknown) => moves.push({ action, run: () => void run() });
		const live = this.up && this.round.phase === "collecting";
		if (this.up && this.round.phase === "scheduled") add("Start", () => this.Start());
		if (live) {
			for (const cmd of next(this.round)) {
				if (cmd.type === "close") add("EndRound", () => this.EndRound());
				else if (cmd.type === "makeInvoice") add("MakeInvoice", () => this.MakeInvoice(cmd.payer));
				else if (this.calls.has(cmd.payer)) continue;
				else if (cmd.type === "pay") add("SendPay", () => this.SendPay(cmd.payer));
				else add("LookupInvoice", () => this.LookupInvoice(cmd.payer));
			}
		}
		for (const [payer, call] of this.calls) {
			if (call.at === "sent") {
				add("WalletSends", () => this.WalletSends(payer));
				for (const r of REFUSALS) add("WalletRefuses", () => this.WalletRefuses(payer, r));
			}
			if (call.at === "routing") {
				add("PaymentArrives", () => this.PaymentArrives(payer));
				add("ReplyTimesOut", () => this.ReplyTimesOut(payer));
			}
			if (call.at === "replied" && live) add("RecordReply", () => this.RecordReply(payer));
		}
		for (let i = 0; i < this.late.length; i++) add("LatePaymentArrives", () => this.LatePaymentArrives(i));
		for (const [hash, inv] of this.invoices) if (inv.state === "open") add("InvoiceExpires", () => this.InvoiceExpires(hash));
		if (live && this.crashes < limits.crashes) add("CoordinatorCrashes", () => this.CoordinatorCrashes());
		if (!this.up) add("CoordinatorRetries", () => this.CoordinatorRetries());
		if (this.up && this.round.phase === "partial" && this.round.reruns < limits.reruns) add("RoundRunsAgain", () => this.RoundRunsAgain());
		return moves;
	}
}
