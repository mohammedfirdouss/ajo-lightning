import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
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
	assert.throws(() => openStore(join(dir, "ajo.db"), randomBytes(32)).members(), /unable to authenticate|Unsupported state/);
});

test("only the owner can read or write the database file", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "ajo-store-"));
	t.after(() => rmSync(dir, { recursive: true }));
	const store = openStore(join(dir, "ajo.db"), randomBytes(32));
	store.addMembers([{ name: "Adaeze Okafor", pay: "p", receive: "r" }]);
	for (const f of ["ajo.db", "ajo.db-wal"]) assert.equal(statSync(join(dir, f)).mode & 0o777, 0o600, f);
	store.close();
});
