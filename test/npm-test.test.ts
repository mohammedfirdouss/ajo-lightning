import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const { NODE_TEST_CONTEXT, ...env } = process.env;
const npmTest = (name: string) => spawnSync("npm", ["test", "--", name], { encoding: "utf8", env });

test("npm test with a name runs only the test files whose path has that name", () => {
	const r = npmTest("e2e-selftest");
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /^ℹ pass 12$/m);
});

test("npm test exits non-zero when a name matches no test file", () => {
	const r = npmTest("no-test-file-has-this-name");
	assert.notEqual(r.status, 0);
	assert.match(r.stderr, /no test file matches no-test-file-has-this-name/);
});
