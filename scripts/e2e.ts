import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SimplePool } from "nostr-tools/pool";
import { verifyEvent } from "nostr-tools/pure";
import { balanceMsat, type Hub, loadStack, type Stack } from "./stack.ts";

// The contract with the round runner. `node src/run-round.ts <round>` exits 0 once the round has run,
// complete or partial, and prints this report as its last stdout line.
export type RoundReport = {
	round: number;
	payee: string;
	state: "complete" | "partial";
	contributions: { member: string; state: "paid" | "failed"; paymentHash?: string; error?: string }[];
};

const RUNNER = "src/run-round.ts";
const RECEIPT_TAG = "ajo-receipt";
const root = fileURLToPath(new URL("..", import.meta.url));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sat = (msat: number) => `${msat / 1000} sat`;

export async function expectDelta(hub: Hub, beforeMsat: number, deltaMsat: number, timeoutMs = 10_000) {
	const deadline = Date.now() + timeoutMs;
	let now = await balanceMsat(hub);
	while (now - beforeMsat !== deltaMsat && Date.now() < deadline) {
		await sleep(250);
		now = await balanceMsat(hub);
	}
	if (now - beforeMsat !== deltaMsat) {
		throw new Error(`${hub.name} moved by ${sat(now - beforeMsat)}, expected ${sat(deltaMsat)}`);
	}
}

export async function expectSteady(hub: Hub, msat: number, forMs = 3_000) {
	const deadline = Date.now() + forMs;
	do {
		const now = await balanceMsat(hub);
		if (now !== msat) throw new Error(`${hub.name} moved by ${sat(now - msat)}, expected no change`);
		await sleep(250);
	} while (Date.now() < deadline);
}

function runRound(round: number): RoundReport {
	const r = spawnSync(process.execPath, [RUNNER, String(round)], { cwd: root, encoding: "utf8" });
	if (r.status !== 0) {
		throw new Error(`${RUNNER} ${round} exited ${r.status}: ${r.stderr.trim().split("\n").at(-1) ?? ""}`);
	}
	return JSON.parse(r.stdout.trim().split("\n").at(-1) ?? "");
}

const snapshot = async (hubs: Hub[]) => new Map(await Promise.all(hubs.map(async (h) => [h.name, await balanceMsat(h)] as const)));
const byName = (stack: Stack, name: string) => {
	const m = stack.members.find((x) => x.name === name);
	if (!m) throw new Error(`round report names ${name}, who is not a member`);
	return m;
};
const plain = (s = "") => s.length > 0 && !/[A-Z]{2,}_[A-Z]{2,}|Nip47|Error:/.test(s);

async function receiptsOnRelay(stack: Stack, report: RoundReport) {
	const pool = new SimplePool();
	const events = await pool.querySync([stack.relayUrl], { "#t": [RECEIPT_TAG] }, { maxWait: 5_000 });
	pool.close([stack.relayUrl]);
	const paid = report.contributions.filter((c) => c.state === "paid");
	for (const c of paid) {
		const hash = c.paymentHash ?? "";
		const matching = events.filter((e) => hash && (e.content.includes(hash) || JSON.stringify(e.tags).includes(hash)));
		if (matching.length !== 1) throw new Error(`${matching.length} receipts for ${c.member}'s payment, expected 1`);
		if (!verifyEvent(matching[0])) throw new Error(`the receipt for ${c.member}'s payment has a bad signature`);
	}
	return `${paid.length} signed receipts on ${stack.relayUrl}`;
}

let round1: RoundReport;
const checks: [number, (stack: Stack) => Promise<string>][] = [
	[
		1,
		async (stack) => {
			const before = await snapshot(stack.members);
			round1 = runRound(1);
			const payee = byName(stack, round1.payee);
			const want = (stack.members.length - 1) * stack.contributionSat * 1000;
			await expectDelta(payee, before.get(payee.name) ?? 0, want);
			return `${payee.name} rose by ${sat(want)} on its hub`;
		},
	],
	[3, (stack) => receiptsOnRelay(stack, round1)],
	[
		4,
		async (stack) => {
			const before = await snapshot(stack.members);
			runRound(1);
			for (const m of stack.members) await expectSteady(m, before.get(m.name) ?? 0);
			return "rerunning round 1 moved no member's balance";
		},
	],
	// Pay budgets allow one contribution a month, so every round 1 payer is over its cap in round 2.
	[
		2,
		async (stack) => {
			const before = await snapshot(stack.members);
			const report = runRound(2);
			const failed = report.contributions.filter((c) => c.state === "failed");
			if (report.state !== "partial") throw new Error(`round 2 is ${report.state}, expected partial`);
			if (failed.length === 0) throw new Error("round 2 has no failed contribution");
			for (const c of failed) {
				if (!plain(c.error)) throw new Error(`${c.member}'s error is not plain language: ${JSON.stringify(c.error)}`);
				await expectSteady(byName(stack, c.member), before.get(c.member) ?? 0, 1_000);
			}
			return `round 2 is partial and ${failed.map((c) => c.member).join(", ")} got a plain-language error`;
		},
	],
];

async function main() {
	if (!existsSync(`${root}/${RUNNER}`)) {
		console.log("FAIL check 1 no round runner yet");
		return 1;
	}
	let n = 1;
	try {
		const stack = loadStack();
		for (const [id, check] of checks) {
			n = id;
			console.log(`PASS check ${n} ${await check(stack)}`);
		}
		return 0;
	} catch (e) {
		console.log(`FAIL check ${n} ${(e as Error).message}`);
		return 1;
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(await main());
