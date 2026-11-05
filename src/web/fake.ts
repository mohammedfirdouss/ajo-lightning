import { createHash, randomBytes } from "node:crypto";
import type { RoundReport } from "../../scripts/e2e.ts";
import { reasonCopy } from "./copy.ts";
import { apply, newRound, next } from "../round/round.ts";
import { type Command, type Invoice, type MemberId, memberId, type PaymentHash, type Preimage, type Round, type RoundEvent, type RoundId, sats } from "../round/types.ts";
import type { Circle, RoundSource } from "./source.ts";

/**
 * A stand-in for the NWC runner, for tests and live lanes only. It drives the real round reducer against
 * in-memory wallets: each pay spends from the member's cap and fails with QUOTA_EXCEEDED past it.
 */
export type FakeOptions = { stepMs?: number; spentSat?: Partial<Record<string, number>> };

const hex = () => randomBytes(32).toString("hex");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function fakeSource({ stepMs = 0, spentSat = {} }: FakeOptions = {}): RoundSource {
	let circle: Circle | undefined;
	const rounds = new Map<number, Round>();
	const spent = new Map<MemberId, number>();
	const preimages = new Map<PaymentHash, Preimage>();
	const settled = new Set<PaymentHash>();

	const schedule = (n: RoundId): Round | undefined => {
		const ms = circle?.members ?? [];
		if (!circle || ms.length < 2 || n > ms.length) return undefined;
		const payee = ms[(n - 1) % ms.length].id;
		return newRound({ id: n, payee, payers: ms.map((x) => x.id).filter((x) => x !== payee), contribution: circle.contribution });
	};

	const feed = (round: Round, event: RoundEvent) => {
		const out = apply(round, event);
		if (!out.ok) throw new Error(`fake runner fed a rejected event: ${out.reason}`);
		rounds.set(round.id, out.round);
		return out.round;
	};

	const pay = (payer: MemberId, invoice: Invoice): RoundEvent => {
		const cap = circle?.members.find((x) => x.id === payer)?.capSat ?? 0;
		const used = spent.get(payer) ?? 0;
		if (used + invoice.amount > cap) return { type: "payReplied", payer, error: "QUOTA_EXCEEDED" };
		spent.set(payer, used + invoice.amount);
		settled.add(invoice.paymentHash);
		return { type: "payReplied", payer, preimage: preimages.get(invoice.paymentHash) as Preimage };
	};

	const run = (cmd: Command): RoundEvent[] => {
		switch (cmd.type) {
			case "makeInvoice": {
				const pre = hex() as Preimage;
				const paymentHash = createHash("sha256").update(Buffer.from(pre, "hex")).digest("hex") as PaymentHash;
				preimages.set(paymentHash, pre);
				const invoice = { paymentHash, bolt11: `lnbcrt${cmd.amount}fake`, amount: cmd.amount, expiresAt: Math.floor(Date.now() / 1000) + 60 };
				return [{ type: "invoiceMade", payer: cmd.payer, invoice }];
			}
			case "pay":
				return [{ type: "paySent", payer: cmd.payer }, pay(cmd.payer, cmd.invoice)];
			case "lookup": {
				const hash = cmd.invoice.paymentHash;
				const invoice = settled.has(hash) ? "settled" : cmd.waitUntil ? "expired" : "open";
				return [{ type: "lookupReplied", payer: cmd.payer, paymentHash: hash, invoice }];
			}
			case "close":
				return [{ type: "close" }];
		}
	};

	const report = (r: Round): RoundReport => ({
		round: r.id,
		payee: r.payee,
		circlePubkey: circle?.pubkey ?? "",
		state: r.phase === "complete" ? "complete" : "partial",
		contributions: r.contributions.map((c) =>
			c.state === "paid"
				? { member: c.payer, state: "paid", paymentHash: c.invoice.paymentHash }
				: { member: c.payer, state: "failed", paymentHash: "invoice" in c ? c.invoice.paymentHash : undefined, error: c.state === "failed" ? reasonCopy[c.reason] : undefined },
		),
	});

	return {
		circle: async () => circle,
		create: async ({ name, contribution, cadence }) => {
			circle = { name, contribution, cadence, members: [], pubkey: hex(), relayUrl: "ws://127.0.0.1:7100" };
			return circle;
		},
		join: async ({ name }) => {
			if (!circle) return { ok: false, reason: "Start a circle first." };
			if (rounds.size > 0) return { ok: false, reason: "This circle has started its rounds, so it is closed to new members." };
			const id = memberId(`member${circle.members.length + 1}`);
			spent.set(id, spentSat[id] ?? 0);
			const member = { id, name, capSat: sats(circle.contribution + Math.max(Math.ceil(circle.contribution / 100), 10)) };
			circle = { ...circle, members: [...circle.members, member] };
			return { ok: true, member };
		},
		round: async (n) => rounds.get(n) ?? schedule(n),
		collect: async (n) => {
			let r = rounds.get(n) ?? schedule(n);
			if (!r) throw new RangeError(`round ${n} is not in this circle`);
			if (r.phase === "scheduled") r = feed(r, { type: "start" });
			if (r.phase === "partial") r = feed(r, { type: "rerun" });
			for (let cmds = next(r); cmds.length > 0; cmds = next(r)) {
				for (const event of run(cmds[0])) {
					await sleep(stepMs);
					r = feed(r, event);
				}
			}
			return report(r);
		},
	};
}
