import assert from "node:assert/strict";
import { test } from "node:test";
import { apply, next } from "../../src/round/round.ts";
import { type FailReason, memberId, type RoundEvent, sats } from "../../src/round/types.ts";
import { MODEL_ACTIONS, type ModelAction, World } from "./world.ts";

const RUNS = Number(process.env.ROUND_PROPS_RUNS ?? 1000);
const SEED = Number(process.env.ROUND_PROPS_SEED ?? 1);
const MAX_STEPS = 400;

function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const pick = <T>(rand: () => number, xs: readonly T[]) => xs[Math.floor(rand() * xs.length)] as T;

test(`the five model rules hold and every round ends, over ${RUNS} random runs of the model's actions`, () => {
	const seen = new Set<ModelAction>();
	for (let run = 0; run < RUNS; run++) {
		const seed = SEED * 1_000_003 + run;
		const rand = rng(seed);
		const w = new World(["member2", "member3", "member4"].slice(0, 1 + (run % 3)), 1 + (run % 2));
		let steps = 0;
		for (; steps < MAX_STEPS; steps++) {
			const moves = w.moves();
			if (moves.length === 0) break;
			const move = pick(rand, moves);
			seen.add(move.action);
			move.run();
			assert.deepEqual(w.brokenRules(), [], `seed ${seed}, step ${steps + 1}, ${move.action}\n${w.trace.join("\n")}`);
		}
		assert.ok(steps < MAX_STEPS, `seed ${seed} did not settle in ${MAX_STEPS} steps\n${w.trace.join("\n")}`);
		assert.ok(
			w.round.phase === "complete" || w.round.phase === "partial",
			`seed ${seed} stopped in ${w.round.phase}\n${w.trace.join("\n")}`,
		);
	}
	assert.deepEqual(
		MODEL_ACTIONS.filter((a) => !seen.has(a)),
		[],
		"every model action was taken at least once",
	);
});

test(`random events in any order never replace an invoice or reopen a settled contribution, over ${RUNS} runs`, () => {
	const payers = ["member2", "member3"].map(memberId);
	const reasons: FailReason[] = ["QUOTA_EXCEEDED", "INSUFFICIENT_BALANCE", "PAYMENT_FAILED", "TIMEOUT"];
	for (let run = 0; run < RUNS; run++) {
		const seed = SEED * 7_919 + run;
		const rand = rng(seed);
		let round = new World(["member2", "member3"]).round;
		const log: string[] = [];
		for (let i = 0; i < 60; i++) {
			const payer = pick(rand, payers);
			const event = pick<RoundEvent>(rand, [
				{ type: "start" },
				{ type: "invoiceMade", payer, invoice: { paymentHash: `${payer}-${i}`, bolt11: "lnbcrt", amount: sats(1000) } },
				{ type: "paySent", payer },
				{ type: "payReplied", payer },
				{ type: "payReplied", payer, error: pick(rand, reasons) },
				{ type: "lookupReplied", payer, invoice: pick(rand, ["open", "settled", "expired"] as const) },
				{ type: "restarted" },
				{ type: "rerun" },
				{ type: "close" },
			]);
			const before = round.contributions.find((c) => c.payer === payer);
			const r = apply(round, event);
			log.push(`${JSON.stringify(event)} -> ${r.ok ? r.round.phase : "rejected"}`);
			const why = `seed ${seed}\n${log.join("\n")}`;
			if (!r.ok) assert.deepEqual(r.round, round, `a rejected event changed the round, ${why}`);
			round = r.round;
			const after = round.contributions.find((c) => c.payer === payer);
			if (before && before.state !== "pending") assert.deepEqual(after && "invoice" in after && after.invoice, before.invoice, why);
			if (before?.state === "paid" || before?.state === "failed") assert.deepEqual(after, before, why);
			if (round.phase === "complete")
				assert.ok(
					round.contributions.every((c) => c.state === "paid"),
					why,
				);
			if (round.phase !== "collecting") assert.deepEqual(next(round), [], why);
		}
	}
});
