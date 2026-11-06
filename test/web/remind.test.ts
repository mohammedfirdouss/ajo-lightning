import assert from "node:assert/strict";
import { test } from "node:test";
import type { Reminder } from "../../src/reminders/reminders.ts";
import { roundId, sats } from "../../src/round/types.ts";
import { dueDate, reminders } from "../../src/web/remind.ts";

const input = { lang: "fr" as const, amount: sats(1000), due: "2026-11-05", member: 3 };

test("a page gets the template at once while the model writes, then the model's text", async () => {
	let finish: (r: Reminder) => void = () => {};
	let calls = 0;
	const remind = reminders(() => {
		calls++;
		return new Promise((r) => {
			finish = r;
		});
	});
	assert.match(remind(input), /^Bonjour Membre 3, votre cotisation de 1000 sats/);
	assert.match(remind(input), /^Bonjour Membre 3/, "still the template while the call runs");
	finish({ text: "Membre 3, 1000 sats pour le 2026-11-05.", source: "ai" });
	await new Promise((r) => setImmediate(r));
	assert.equal(remind(input), "Membre 3, 1000 sats pour le 2026-11-05.");
	assert.equal(calls, 1);
});

test("a model call that fails leaves the template and no unhandled rejection", async (t) => {
	const unhandled: unknown[] = [];
	const onUnhandled = (e: unknown) => unhandled.push(e);
	process.on("unhandledRejection", onUnhandled);
	t.after(() => process.off("unhandledRejection", onUnhandled));
	const remind = reminders(() => Promise.reject(new Error("model down")));
	assert.match(remind(input), /^Bonjour Membre 3/);
	await new Promise((r) => setTimeout(r, 10));
	assert.match(remind(input), /^Bonjour Membre 3/);
	assert.deepEqual(unhandled, []);
});

test("round n falls due n - 1 weeks or months after the start", () => {
	assert.equal(dueDate("2026-11-05", "weekly", roundId(1)), "2026-11-05");
	assert.equal(dueDate("2026-11-05", "weekly", roundId(3)), "2026-11-19");
	assert.equal(dueDate("2026-11-05", "monthly", roundId(3)), "2027-01-05");
});
