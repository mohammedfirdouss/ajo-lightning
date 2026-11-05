import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { chmodSync, closeSync, openSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Event } from "nostr-tools/pure";
import { type MemberId, memberId, type PaymentHash, type Round, type RoundId } from "../round/types.ts";

export type MemberSecrets = { name: string; pay: string; receive: string };
export type Member = MemberSecrets & { id: MemberId };

/** AES-256-GCM. A stolen database file without `.env` yields no name and no NWC secret. */
function seal(key: Buffer, plain: string) {
	const iv = randomBytes(12);
	const c = createCipheriv("aes-256-gcm", key, iv);
	const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
	return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}

function open(key: Buffer, sealed: string) {
	const raw = Buffer.from(sealed, "base64");
	const d = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
	d.setAuthTag(raw.subarray(12, 28));
	try {
		return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
	} catch {
		throw new Error(KEY_MISMATCH);
	}
}

const KEY_MISMATCH =
	"this database was sealed with a different AJO_SECRET_KEY: restore the original .env, or run docker compose down -v to start fresh. An AJO_SECRET_KEY exported in your shell overrides the one in .env, so unset it too";

/** The id the core, the database, and receipts use. It is stable for a name and reveals nothing without the key. */
export const pseudonym = (key: Buffer, name: string) => memberId(createHmac("sha256", key).update(`member:${name}`).digest("hex").slice(0, 16));

export function openStore(file: string, key: Buffer) {
	if (key.length !== 32) throw new RangeError("the secret key must be 32 bytes");
	closeSync(openSync(file, "a", 0o600));
	chmodSync(file, 0o600);
	const db = new DatabaseSync(file);
	db.exec(`
		PRAGMA journal_mode = WAL;
		CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, position INTEGER NOT NULL UNIQUE, sealed TEXT NOT NULL);
		CREATE TABLE IF NOT EXISTS rounds (id INTEGER PRIMARY KEY, round TEXT NOT NULL);
		CREATE TABLE IF NOT EXISTS invoices (payment_hash TEXT PRIMARY KEY, round INTEGER NOT NULL);
		CREATE TABLE IF NOT EXISTS receipts (payment_hash TEXT PRIMARY KEY, event TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 0);
	`);
	const tx = (fn: () => void) => {
		db.exec("BEGIN IMMEDIATE");
		try {
			fn();
			db.exec("COMMIT");
		} catch (e) {
			db.exec("ROLLBACK");
			throw e;
		}
	};

	return {
		members(): Member[] {
			const rows = db.prepare("SELECT id, sealed FROM members ORDER BY position").all() as { id: string; sealed: string }[];
			return rows.map((r) => ({ id: memberId(r.id), ...(JSON.parse(open(key, r.sealed)) as MemberSecrets) }));
		},
		addMembers(list: MemberSecrets[]) {
			const insert = db.prepare("INSERT INTO members (id, position, sealed) VALUES (?, ?, ?)");
			tx(() => {
				for (const [i, m] of list.entries()) insert.run(pseudonym(key, m.name), i, seal(key, JSON.stringify(m)));
			});
		},
		round(id: RoundId): Round | undefined {
			const row = db.prepare("SELECT round FROM rounds WHERE id = ?").get(id) as { round: string } | undefined;
			return row && (JSON.parse(row.round) as Round);
		},
		roundOfInvoice(hash: PaymentHash): number | undefined {
			return (db.prepare("SELECT round FROM invoices WHERE payment_hash = ?").get(hash) as { round: number } | undefined)?.round;
		},
		saveRound(round: Round, newInvoice?: PaymentHash) {
			tx(() => {
				db.prepare("INSERT INTO rounds (id, round) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET round = excluded.round").run(round.id, JSON.stringify(round));
				if (newInvoice) db.prepare("INSERT INTO invoices (payment_hash, round) VALUES (?, ?)").run(newInvoice, round.id);
			});
		},
		hasReceipt: (hash: PaymentHash) => db.prepare("SELECT 1 FROM receipts WHERE payment_hash = ?").get(hash) !== undefined,
		addReceipt(hash: PaymentHash, event: Event) {
			db.prepare("INSERT INTO receipts (payment_hash, event) VALUES (?, ?)").run(hash, JSON.stringify(event));
		},
		unpublishedReceipts(): Event[] {
			const rows = db.prepare("SELECT event FROM receipts WHERE published = 0").all() as { event: string }[];
			return rows.map((r) => JSON.parse(r.event) as Event);
		},
		markPublished(events: Event[]) {
			const mark = db.prepare("UPDATE receipts SET published = 1 WHERE json_extract(event, '$.id') = ?");
			tx(() => {
				for (const e of events) mark.run(e.id);
			});
		},
		close: () => db.close(),
	};
}

export type Store = ReturnType<typeof openStore>;
