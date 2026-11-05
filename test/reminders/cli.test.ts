import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const { ANTHROPIC_API_KEY: _, ...env } = process.env;
const remind = (...args: string[]) => spawnSync("scripts/remind", args, { encoding: "utf8", env });
const round = ["--due", "2026-11-12", "--member", "3"];

test("a valid round state prints the template and exits 0", () => {
	const r = remind("--lang", "fr", "--amount", "4000", ...round);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /Membre 3.*4000 sats.*2026-11-12/);
});

for (const [why, args] of [
	["an unknown flag", ["--amount", "4000", ...round, "--name", "Aminata"]],
	["an extra positional", ["--amount", "4000", ...round, "extra"]],
	["a missing flag", ["--amount", "4000", "--due", "2026-11-12"]],
	["a negative amount", ["--amount", "-5", ...round]],
	["a hex amount", ["--amount", "0x10", ...round]],
	["an exponent amount", ["--amount", "1e3", ...round]],
	["a zero amount", ["--amount", "0", ...round]],
	["an impossible date", ["--amount", "4000", "--due", "2026-02-31", "--member", "3"]],
] as const) {
	test(`${why} prints the usage line and exits 2 without a stack trace`, () => {
		const r = remind(...args);
		assert.equal(r.status, 2, r.stderr);
		assert.match(r.stderr, /^usage: scripts\/remind/m);
		assert.doesNotMatch(r.stderr, /^\s+at /m);
		assert.equal(r.stdout, "");
	});
}
