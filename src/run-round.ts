import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { circlePubkey, publish, receiptEvent } from "./receipts/nostr.ts";
import { apply, newRound, next } from "./round/round.ts";
import type { RoundReport } from "../scripts/e2e.ts";
import { loadStack } from "../scripts/stack.ts";
import { type Command, type Contribution, type FailReason, HEX32, type Invoice, type MemberId, type Round, type RoundEvent, type RoundId, roundId, sats } from "./round/types.ts";
import { openStore, pseudonym, type Store } from "./store/sqlite.ts";
import { connect, type LookupState, type Wallet } from "./wallet/nwc.ts";

/** A partial round may run again this many times. Each rerun only looks up stored invoices, so more cannot help. */
const MAX_RERUNS = 3;
/** Short enough that waiting out a refused member's invoice ends well inside the e2e's 120 seconds. */
const INVOICE_EXPIRY_SEC = 30;
/** Covers an HTLC that the payee's hub accepted just before expiry and settles just after. */
const EXPIRY_GRACE_SEC = 5;
const LOOKUP_POLL_MS = 3_000;
const RUN_BUDGET_MS = 100_000;
const KEYS = ["AJO_SECRET_KEY", "AJO_CIRCLE_KEY"] as const;

const root = fileURLToPath(new URL("..", import.meta.url));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PLAIN: Record<FailReason, string> = {
	QUOTA_EXCEEDED: "This payment is over the monthly spending cap on this member's wallet connection.",
	INSUFFICIENT_BALANCE: "This member's wallet did not have enough sats for the payment.",
	PAYMENT_FAILED: "The payment did not reach the payee, and the invoice expired unpaid.",
	TIMEOUT: "The wallet did not answer in time, and the invoice expired unpaid.",
};

/**
 * Only a refusal proves no HTLC left the payer's wallet. After any other reply, or a crash mid-pay, an HTLC can
 * still be in flight, and the payee's hub accepts one well past the invoice's expiry, so its expiry is not final.
 */
const refused = (reason: FailReason | undefined) => reason === "QUOTA_EXCEEDED" || reason === "INSUFFICIENT_BALANCE";
const mayBeInFlight = (c: Contribution) =>
	(c.state === "invoiced" && c.tries > 0 && (c.step === "paying" || !refused(c.lastErr))) || (c.state === "failed" && !refused(c.reason));

function hexKey(name: (typeof KEYS)[number]) {
	const v = process.env[name] ?? "";
	if (!HEX32.test(v)) throw new Error(`${name} must be 64 lowercase hex in .env, run node src/run-round.ts from the host once to create it`);
	return Buffer.from(v, "hex");
}

type Seed = { contributionSat: number; members: { name: string; pay: { uri: string }; receive: { uri: string } }[] };

function circleMembers(store: Store, seed: Seed) {
	if (store.members().length === 0) {
		store.addMembers(seed.members.map((m) => ({ name: m.name, pay: m.pay.uri, receive: m.receive.uri })));
	}
	return store.members();
}

/** Resume where the stored round stopped. A crash leaves it collecting, and `restarted` turns open pays into lookups. */
function resume(round: Round): Round {
	const event: RoundEvent | undefined =
		round.phase === "scheduled" ? { type: "start" } : round.phase === "collecting" ? { type: "restarted" } : round.phase === "partial" && round.reruns < MAX_RERUNS ? { type: "rerun" } : undefined;
	if (!event) return round;
	const a = apply(round, event);
	if (!a.ok) throw new Error(a.reason);
	return a.round;
}

async function runRound(id: RoundId, stateDir: string): Promise<RoundReport> {
	const deadline = Date.now() + RUN_BUDGET_MS;
	const key = hexKey("AJO_SECRET_KEY");
	const circleKey = hexKey("AJO_CIRCLE_KEY");
	const relayUrl = process.env.AJO_RELAY_URL ?? "ws://relay:8080";
	const store = openStore(`${stateDir}/ajo.db`, key);
	const seed = JSON.parse(readFileSync(`${stateDir}/connections.json`, "utf8")) as Seed;
	const members = circleMembers(store, seed);
	const byId = new Map(members.map((m) => [m.id, m]));
	const member = (id: MemberId) => {
		const m = byId.get(id);
		if (!m) throw new Error(`member ${id} is in the round but not in the circle`);
		return m;
	};
	const payee = members[(id - 1) % members.length];

	const stored = store.round(id);
	const inFlight = new Set(stored?.contributions.filter(mayBeInFlight).map((c) => c.payer));
	let round = resume(
		stored ?? newRound({ id, payee: payee.id, payers: members.filter((m) => m !== payee).map((m) => m.id), contribution: sats(seed.contributionSat) }),
	);
	store.saveRound(round);

	const feed = (event: RoundEvent, newInvoice?: Invoice) => {
		const a = apply(round, event);
		if (!a.ok) throw new Error(a.reason);
		round = a.round;
		store.saveRound(round, newInvoice?.paymentHash);
	};

	const wallets = new Map<string, Wallet>();
	const wallet = (uri: string) => {
		const w = wallets.get(uri) ?? connect(uri);
		wallets.set(uri, w);
		return w;
	};
	const receive = () => wallet(payee.receive);

	async function settledOrExpired(payer: MemberId, invoice: Invoice, waitForExpiry: boolean): Promise<LookupState> {
		const expiredFromSec = inFlight.has(payer) ? deadline / 1000 : invoice.expiresAt + EXPIRY_GRACE_SEC;
		const until = waitForExpiry ? (expiredFromSec + 1) * 1000 : Date.now() + LOOKUP_POLL_MS;
		for (let delay = 500; ; delay = Math.min(delay * 2, 4_000)) {
			const state = await receive().lookup(invoice, expiredFromSec);
			if (state === "settled" || state === "expired") return state;
			if (Date.now() >= until) return "open";
			await sleep(Math.min(delay, Math.max(until - Date.now(), 0)));
		}
	}

	async function run(cmd: Exclude<Command, { type: "close" }>) {
		if (cmd.type === "makeInvoice") {
			const invoice = await receive().makeInvoice(cmd.amount, `Ajo round ${id}`, INVOICE_EXPIRY_SEC);
			const earlier = store.roundOfInvoice(invoice.paymentHash);
			if (earlier !== undefined) throw new Error(`the payee's wallet returned payment hash ${invoice.paymentHash}, already used in round ${earlier}`);
			feed({ type: "invoiceMade", payer: cmd.payer, invoice }, invoice);
		} else if (cmd.type === "pay") {
			feed({ type: "paySent", payer: cmd.payer });
			const reply = await wallet(member(cmd.payer).pay).pay(cmd.invoice);
			feed({ type: "payReplied", payer: cmd.payer, ...reply });
			const c = round.contributions.find((x) => x.payer === cmd.payer);
			if (c && mayBeInFlight(c)) inFlight.add(cmd.payer);
		} else {
			const state = await settledOrExpired(cmd.payer, cmd.invoice, cmd.waitUntil !== undefined);
			feed({ type: "lookupReplied", payer: cmd.payer, paymentHash: cmd.invoice.paymentHash, invoice: state });
		}
	}

	async function drive(payer: MemberId) {
		for (;;) {
			const cmd = next(round).find((c) => c.type !== "close" && c.payer === payer);
			if (!cmd || cmd.type === "close") return;
			if (Date.now() > deadline) throw new Error(`round ${id} is still collecting after ${RUN_BUDGET_MS / 1000}s, run it again to resume`);
			await run(cmd);
		}
	}

	try {
		await Promise.all(round.contributions.map((c) => drive(c.payer)));
		if (round.phase === "collecting") feed({ type: "close" });
		if (round.phase !== "complete" && round.phase !== "partial") throw new Error(`round ${id} ended ${round.phase}`);

		for (const c of round.contributions) {
			if (c.state === "paid" && !store.hasReceipt(c.invoice.paymentHash)) {
				const event = receiptEvent(circleKey, { round: id, payer: c.payer, amount: c.invoice.amount, paymentHash: c.invoice.paymentHash }, Math.floor(Date.now() / 1000));
				store.addReceipt(c.invoice.paymentHash, event);
			}
		}
		const unpublished = store.unpublishedReceipts();
		await publish(relayUrl, unpublished);
		store.markPublished(unpublished);

		return {
			round: id,
			payee: round.payee,
			circlePubkey: circlePubkey(circleKey),
			state: round.phase,
			contributions: round.contributions.map((c) =>
				c.state === "paid"
					? { member: c.payer, state: "paid", paymentHash: c.invoice.paymentHash }
					: { member: c.payer, state: "failed", paymentHash: c.invoice.paymentHash, error: PLAIN[c.reason] },
			),
		};
	} finally {
		for (const w of wallets.values()) w.close();
		store.close();
	}
}

/** The keys live in `.env`, which compose hands to the app container. The first host run creates them. */
function ensureKeys() {
	const file = `${root}/.env`;
	let text = existsSync(file) ? readFileSync(file, "utf8") : "";
	const missing = KEYS.filter((k) => !new RegExp(`^${k}=[0-9a-f]{64}$`, "m").test(text));
	if (missing.length > 0) {
		text += `${text && !text.endsWith("\n") ? "\n" : ""}${missing.map((k) => `${k}=${randomBytes(32).toString("hex")}\n`).join("")}`;
		writeFileSync(file, text, { mode: 0o600 });
		chmodSync(file, 0o600);
	}
	return Buffer.from(/^AJO_SECRET_KEY=([0-9a-f]{64})$/m.exec(text)?.[1] ?? "", "hex");
}

/** The container reports pseudonyms, so its log never holds a name. The host puts the names back for the caller. */
function withNames(report: RoundReport, key: Buffer): RoundReport {
	const names = new Map(loadStack().members.map((m) => [pseudonym(key, m.name) as string, m.name]));
	const name = (id: string) => names.get(id) ?? id;
	return { ...report, payee: name(report.payee), contributions: report.contributions.map((c) => ({ ...c, member: name(c.member) })) };
}

async function main(arg: string | undefined) {
	const id = roundId(Number(arg));
	const stateDir = process.env.AJO_STATE_DIR;
	if (!stateDir) {
		const key = ensureKeys();
		const r = spawnSync("docker", ["compose", "run", "--rm", "--no-deps", "-T", "app", "node", "src/run-round.ts", String(id)], {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "inherit"],
		});
		const lines = (r.stdout ?? "").trim().split("\n");
		if (r.status !== 0) {
			process.stdout.write(r.stdout ?? "");
			return r.status ?? 1;
		}
		console.log(lines.slice(0, -1).concat(JSON.stringify(withNames(JSON.parse(lines.at(-1) ?? ""), key))).join("\n"));
		return 0;
	}
	console.log(JSON.stringify(await runRound(id, stateDir)));
	return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main(process.argv[2]).then(
		(code) => process.exit(code),
		(e: Error) => {
			console.error(`run-round: ${e.message}`);
			process.exit(1);
		},
	);
}
