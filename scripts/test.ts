import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const filters = process.argv.slice(2);
const files = ["scripts", "src", "test"]
	.filter((dir) => existsSync(dir))
	.flatMap((dir) => readdirSync(dir, { recursive: true }).map((f) => join(dir, String(f))))
	.filter((f) => f.endsWith(".test.ts") && (filters.length === 0 || filters.some((x) => f.includes(x))));
if (files.length === 0) {
	console.error(`no *.test.ts file matches ${filters.join(" ") || "anything"}`);
	process.exit(1);
}
process.exit(spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" }).status ?? 1);
