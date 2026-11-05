import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SimplePool } from "nostr-tools/pool";
import { type Event, verifyEvent } from "nostr-tools/pure";
import { expectDelta, expectSteady, hubGet, loadStack, type Stack, sat, snapshot } from "./stack.ts";

/**
 * The contract with the round runner. `node src/run-round.ts <round>` exits 0 once the round has run,
 * complete or partial, and prints this report as its last stdout line.
 *
 * - The runner reads the stack from `connections.json` in the seed's `state` volume, most simply through
 *   `loadStack()` in `scripts/stack.ts`. Each member has a `pay` and a `receive` NWC connection.
 * - Round N pays members[(N - 1) % n], in the order of `members` in `connections.json`. Every other
 *   member pays that round's payee once.
 * - Each paid entry carries `paymentHash`, 64 lowercase hex: the payment hash of the invoice the payee's
 *   receive connection minted. No two payers share a hash. The payee's hub must hold that hash as a
 *   settled incoming payment of exactly `contributionSat` sats.
 * - For each paid entry the runner publishes one Nostr event to `relayUrl`, signed by the key whose hex
 *   public key is `circlePubkey`, with the tags `["t", "ajo-receipt"]` and `["payment_hash", <paymentHash>]`.
 * - A rerun of a round reports the same hashes and mints no new invoice. The rerun state is a SQLite file,
 *   `/state/ajo.db` in the seed's `state` volume, so `docker compose down -v` clears it with the stack.
 *   The host command runs the round in the compose `app` service, which mounts that volume.
 * - The circle's Nostr key is `AJO_CIRCLE_KEY` in `.env`, beside `AJO_SECRET_KEY`, which encrypts member
 *   names and NWC secrets in that file. The first host run writes both to `.env` if they are missing.
 * - The runner must finish within RUNNER_TIMEOUT_MS, so it mints invoices with an expiry well under that
 *   and never waits out an unpaid one.
 */
export type RoundReport = {
	round: number;
	payee: string;
	circlePubkey: string;
	state: "complete" | "partial";
	contributions: (
		| { member: string; state: "paid"; paymentHash: string }
		| { member: string; state: "failed"; paymentHash?: string; error?: string }
	)[];
};

const RUNNER = "src/run-round.ts";
const RUNNER_TIMEOUT_MS = 120_000;
const RECEIPT_TAG = "ajo-receipt";
const HASH = /^[0-9a-f]{64}$/;
const root = fileURLToPath(new URL("..", import.meta.url));

export function parseReport(round: number, line = ""): RoundReport {
	let v: RoundReport;
	try {
		v = JSON.parse(line);
	} catch {
		throw new Error(`${RUNNER} ${round} did not print a JSON report as its last stdout line`);
	}
	const ok =
		v?.round === round &&
		typeof v.payee === "string" &&
		HASH.test(v.circlePubkey) &&
		(v.state === "complete" || v.state === "partial") &&
		Array.isArray(v.contributions) &&
		v.contributions.every(
			(c) => typeof c?.member === "string" && ((c.state === "paid" && HASH.test(c.paymentHash)) || c.state === "failed"),
		);
	if (!ok) throw new Error(`${RUNNER} ${round} printed a report that does not match RoundReport: ${line.slice(0, 200)}`);
	return v;
}

function runRound(round: number): RoundReport {
	const r = spawnSync(process.execPath, [RUNNER, String(round)], {
		cwd: root,
		encoding: "utf8",
		timeout: RUNNER_TIMEOUT_MS,
		maxBuffer: 64 * 1024 * 1024,
	});
	if (r.error) throw new Error(`${RUNNER} ${round} did not finish: ${r.error.message}`);
	if (r.status !== 0) {
		throw new Error(`${RUNNER} ${round} exited ${r.status}: ${r.stderr.trim().split("\n").at(-1) ?? ""}`);
	}
	return parseReport(round, r.stdout.trim().split("\n").at(-1));
}

const byName = (stack: Stack, name: string) => {
	const m = stack.members.find((x) => x.name === name);
	if (!m) throw new Error(`round report names ${name}, who is not a member`);
	return m;
};
const plain = (s = "") => s.length > 0 && !/[A-Z]{2,}_[A-Z]{2,}|Nip47|Error:/.test(s);
const paidIn = (report: RoundReport) => report.contributions.filter((c) => c.state === "paid");

export function checkReceipts(stack: Stack, report: RoundReport, events: Event[]) {
	const paid = paidIn(report);
	const payers = stack.members.filter((m) => m.name !== report.payee).map((m) => m.name).sort();
	const named = paid.map((c) => c.member).sort();
	if (named.join() !== payers.join()) {
		throw new Error(`round ${report.round} reports ${paid.length} paid contributions (${named.join(", ")}), expected one from each of ${payers.join(", ")}`);
	}
	const hashes = new Set(paid.map((c) => c.paymentHash));
	if (hashes.size !== paid.length) {
		throw new Error(`round ${report.round} reports ${paid.length} paid contributions under ${hashes.size} payment hashes, expected one hash per payer`);
	}
	for (const c of paid) {
		const matching = events.filter((e) => e.tags.some(([k, v]) => k === "payment_hash" && v === c.paymentHash));
		if (matching.length !== 1) throw new Error(`${matching.length} receipts for ${c.member}'s payment, expected 1`);
		const [receipt] = matching;
		if (receipt.pubkey !== report.circlePubkey) {
			throw new Error(`the receipt for ${c.member}'s payment is signed by ${receipt.pubkey}, not the circle's key ${report.circlePubkey}`);
		}
		if (!verifyEvent(receipt)) throw new Error(`the receipt for ${c.member}'s payment has a bad signature`);
	}
	return `${paid.length} receipts signed by the circle's key`;
}

export function checkRerun(first: RoundReport, rerun: RoundReport) {
	const failed = rerun.contributions.filter((c) => c.state === "failed").map((c) => c.member);
	if (failed.length > 0) throw new Error(`the rerun reports ${failed.join(", ")} as failed, expected round ${first.round}'s payments to stand`);
	for (const c of paidIn(first)) {
		const again = rerun.contributions.find((x) => x.member === c.member);
		if (again?.state !== "paid" || again.paymentHash !== c.paymentHash) {
			throw new Error(`the rerun lists ${c.member} as ${again?.state ?? "missing"} with hash ${again?.paymentHash}, expected paid with hash ${c.paymentHash}`);
		}
	}
}

type Transaction = { type: string; state: string; paymentHash: string; amountMsat: number };

export async function checkSettled(stack: Stack, report: RoundReport) {
	const payee = byName(stack, report.payee);
	const want = stack.contributionSat * 1000;
	for (const c of paidIn(report)) {
		const tx = await hubGet<Transaction>(payee, `/api/transactions/${c.paymentHash}`).catch(() => undefined);
		if (tx?.type !== "incoming" || tx.state !== "settled" || tx.paymentHash !== c.paymentHash || tx.amountMsat !== want) {
			throw new Error(`${payee.name}'s hub has no settled incoming ${sat(want)} payment with ${c.member}'s hash ${c.paymentHash}`);
		}
	}
}

async function receiptsOnRelay(stack: Stack, report: RoundReport) {
	await checkSettled(stack, report);
	const pool = new SimplePool();
	const events = await pool.querySync([stack.relayUrl], { "#t": [RECEIPT_TAG] }, { maxWait: 5_000 });
	pool.close([stack.relayUrl]);
	return `every paid hash settled on ${report.payee}'s hub, and ${checkReceipts(stack, report, events)} on ${stack.relayUrl}`;
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
			checkRerun(round1, runRound(1));
			for (const m of stack.members) await expectSteady(m, before.get(m.name) ?? 0);
			return "rerunning round 1 kept every payment and its hash and moved no member's balance";
		},
	],
	[
		2,
		async (stack) => {
			if (stack.budgetSat >= 2 * stack.contributionSat) {
				throw new Error(`a ${stack.budgetSat} sat pay budget covers two contributions, so no round 2 payer is over its cap`);
			}
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
