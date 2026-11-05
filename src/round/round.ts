import { createHash } from "node:crypto";
import type { Applied, Command, Contribution, Failed, Invoice, MemberId, Paid, Round, RoundEvent, RoundId, Sats } from "./types.ts";

export type RoundSetup = { id: RoundId; payee: MemberId; payers: readonly MemberId[]; contribution: Sats; maxTries?: number };

export function newRound({ id, payee, payers, contribution, maxTries = 2 }: RoundSetup): Round {
	if (payers.length === 0) throw new RangeError("a round needs at least one payer");
	if (payers.includes(payee)) throw new RangeError(`the payee ${payee} cannot also pay`);
	if (new Set(payers).size !== payers.length) throw new RangeError("a payer is listed twice");
	if (!Number.isSafeInteger(maxTries) || maxTries < 1) throw new RangeError(`maxTries must be at least 1, got ${maxTries}`);
	const contributions = payers.map((payer) => ({ state: "pending" as const, payer }));
	return { id, payee, contribution, maxTries, reruns: 0, retired: [], phase: "scheduled", contributions };
}

const proves = (invoice: Invoice, preimage: unknown) =>
	typeof preimage === "string" && createHash("sha256").update(Buffer.from(preimage, "hex")).digest("hex") === invoice.paymentHash;

const usedHashes = (round: Round) =>
	[...round.contributions, ...round.retired].flatMap((c) => ("invoice" in c ? [c.invoice.paymentHash] : []));

function step(c: Contribution, event: Extract<RoundEvent, { payer: MemberId }>, round: Round): Contribution | string {
	switch (event.type) {
		case "invoiceMade":
			if (c.state !== "pending") return `${c.payer} already has an invoice for this round`;
			if (event.invoice.amount !== round.contribution) {
				return `the invoice asks ${event.invoice.amount} sat, the contribution is ${round.contribution} sat`;
			}
			if (usedHashes(round).includes(event.invoice.paymentHash))
				return `payment hash ${event.invoice.paymentHash} is already used in this round`;
			return { state: "invoiced", payer: c.payer, invoice: event.invoice, step: "pay", tries: 0 };
		case "paySent":
			if (c.state !== "invoiced" || c.step !== "pay") return `${c.payer} has no payment to send`;
			return { ...c, step: "paying", tries: c.tries + 1 };
		case "payReplied":
			if (c.state !== "invoiced" || c.step !== "paying") return `${c.payer} has no pay call outstanding`;
			if ("error" in event) return { ...c, step: "lookup", lastErr: event.error };
			if (!proves(c.invoice, event.preimage)) return { ...c, step: "lookup", lastErr: "PAYMENT_FAILED" };
			return { state: "paid", payer: c.payer, invoice: c.invoice, proof: { by: "preimage", preimage: event.preimage } };
		case "lookupReplied":
			if (c.state !== "invoiced" || (c.step !== "lookup" && c.step !== "lookupAtExpiry")) return `${c.payer} has no lookup to record`;
			if (event.invoice === "settled") return { state: "paid", payer: c.payer, invoice: c.invoice, proof: { by: "payeeLookup" } };
			if (event.invoice === "expired") return { state: "failed", payer: c.payer, invoice: c.invoice, reason: c.lastErr ?? "TIMEOUT" };
			return { ...c, step: c.tries < round.maxTries ? "pay" : "lookupAtExpiry" };
	}
}

const settled = (c: Contribution): c is Paid | Failed => c.state === "paid" || c.state === "failed";
const isPaid = (c: Contribution): c is Paid => c.state === "paid";

/** A rejected event changes nothing, so the runner can feed a replayed or stale event again safely. */
export function apply(round: Round, event: RoundEvent): Applied {
	const reject = (reason: string): Applied => ({ ok: false, round, reason });
	switch (event.type) {
		case "start":
			if (round.phase !== "scheduled") return reject(`round ${round.id} is ${round.phase}, not scheduled`);
			return { ok: true, round: { ...round, phase: "collecting" } };
		case "restarted": {
			if (round.phase !== "collecting") return { ok: true, round };
			const contributions = round.contributions.map((c) => (c.state === "invoiced" ? { ...c, step: "lookup" as const } : c));
			return { ok: true, round: { ...round, contributions } };
		}
		case "rerun": {
			if (round.phase !== "partial") return reject(`only a partial round runs again, round ${round.id} is ${round.phase}`);
			const failed = round.contributions.filter((c): c is Failed => c.state === "failed");
			const contributions = round.contributions.map((c) => (c.state === "failed" ? { state: "pending" as const, payer: c.payer } : c));
			const retired = [...round.retired, ...failed];
			return { ok: true, round: { ...round, phase: "collecting", reruns: round.reruns + 1, retired, contributions } };
		}
		case "close": {
			if (round.phase !== "collecting") return reject(`round ${round.id} is ${round.phase}, not collecting`);
			const open = round.contributions.find((c) => !settled(c));
			if (open) return reject(`${open.payer} is still ${open.state}`);
			const done = round.contributions.filter(settled);
			const paid = done.filter(isPaid);
			if (paid.length === done.length) return { ok: true, round: { ...round, phase: "complete", contributions: paid } };
			return { ok: true, round: { ...round, phase: "partial", contributions: done } };
		}
		default: {
			if (round.phase !== "collecting") return reject(`round ${round.id} is ${round.phase}, not collecting`);
			const c = round.contributions.find((x) => x.payer === event.payer);
			if (!c) return reject(`${event.payer} does not pay in round ${round.id}`);
			const out = step(c, event, round);
			if (typeof out === "string") return reject(out);
			return { ok: true, round: { ...round, contributions: round.contributions.map((x) => (x === c ? out : x)) } };
		}
	}
}

export function next(round: Round): Command[] {
	if (round.phase !== "collecting") return [];
	const commands: Command[] = [];
	for (const c of round.contributions) {
		if (c.state === "pending") commands.push({ type: "makeInvoice", payer: c.payer, amount: round.contribution });
		if (c.state === "invoiced" && c.step === "pay") commands.push({ type: "pay", payer: c.payer, invoice: c.invoice });
		if (c.state === "invoiced" && c.step === "lookup") commands.push({ type: "lookup", payer: c.payer, invoice: c.invoice });
		if (c.state === "invoiced" && c.step === "lookupAtExpiry") {
			commands.push({ type: "lookup", payer: c.payer, invoice: c.invoice, waitUntil: c.invoice.expiresAt });
		}
	}
	if (round.contributions.every(settled)) commands.push({ type: "close" });
	return commands;
}
