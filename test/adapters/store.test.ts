import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { memberId, roundId } from "../../src/round/types.ts";
import { openStore, pseudonym } from "../../src/store/sqlite.ts";

test("the database file holds no member name and no NWC secret in plain text", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "ajo-store-"));
	t.after(() => rmSync(dir, { recursive: true }));
	const key = randomBytes(32);
	const secret = "nostr+walletconnect://abc?relay=ws://relay:8080&secret=00ff";
	const store = openStore(join(dir, "ajo.db"), key);
	store.addMembers([{ name: "Adaeze Okafor", pay: secret, receive: secret }]);
	assert.deepEqual(store.members(), [{ id: pseudonym(key, "Adaeze Okafor"), name: "Adaeze Okafor", pay: secret, receive: secret }]);
	store.close();
	const bytes = Buffer.concat([readFileSync(join(dir, "ajo.db")), readFileSync(join(dir, "ajo.db-wal"), { flag: "a+" })]).toString("latin1");
	assert.ok(!bytes.includes("Adaeze"), "member name in the database file");
	assert.ok(!bytes.includes("nostr+walletconnect://"), "NWC secret in the database file");
});

test("only the owner can read or write the database file", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "ajo-store-"));
	t.after(() => rmSync(dir, { recursive: true }));
	const store = openStore(join(dir, "ajo.db"), randomBytes(32));
	store.addMembers([{ name: "Adaeze Okafor", pay: "p", receive: "r" }]);
	for (const f of ["ajo.db", "ajo.db-wal"]) assert.equal(statSync(join(dir, f)).mode & 0o777, 0o600, f);
	store.close();
});

test("a database opened with another key names the fix, not the cipher error", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "ajo-store-"));
	t.after(() => rmSync(dir, { recursive: true }));
	const sealed = openStore(join(dir, "ajo.db"), randomBytes(32));
	sealed.addMembers([{ name: "Adaeze Okafor", pay: "p", receive: "r" }]);
	sealed.close();
	const other = openStore(join(dir, "ajo.db"), randomBytes(32));
	t.after(() => other.close());
	assert.throws(() => other.members(), (e: Error) => /different AJO_SECRET_KEY/.test(e.message) && /docker compose down -v/.test(e.message) && !/authenticate|Unsupported state/.test(e.message));
});

test("a payer's hold preimage is made once, survives a reopen, and is sealed in the file", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "ajo-store-"));
	t.after(() => rmSync(dir, { recursive: true }));
	const key = randomBytes(32);
	const [round, ada, bola] = [roundId(1), memberId("ada"), memberId("bola")];
	const store = openStore(join(dir, "ajo.db"), key);
	const first = store.holdPreimage(round, ada);
	assert.equal(store.holdPreimage(round, ada), first);
	assert.notEqual(store.holdPreimage(round, bola), first);
	assert.notEqual(store.holdPreimage(roundId(2), ada), first);
	assert.equal(store.settleSent(round, ada), false);
	store.markSettleSent(round, ada);
	store.close();
	const bytes = Buffer.concat([readFileSync(join(dir, "ajo.db")), readFileSync(join(dir, "ajo.db-wal"), { flag: "a+" })]).toString("latin1");
	assert.ok(!bytes.includes(first), "preimage in the database file");
	const again = openStore(join(dir, "ajo.db"), key);
	t.after(() => again.close());
	assert.equal(again.holdPreimage(round, ada), first);
	assert.equal(again.settleSent(round, ada), true);
	assert.equal(again.settleSent(round, bola), false);
});
