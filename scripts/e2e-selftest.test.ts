import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { expectDelta, expectSteady } from "./e2e.ts";

let balanceSat = 150_000;
const server = createServer((req, res) => {
	res.setHeader("content-type", "application/json");
	res.end(JSON.stringify(req.url === "/api/channels" ? [{ active: true, localBalanceMsat: balanceSat * 1000 }] : {}));
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
after(() => server.close());
const hub = { name: "fakehub", url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, token: "t" };
const later = (ms: number, sat: number) => setTimeout(() => (balanceSat = sat), ms);

test("the delta check passes once the hub balance rises by exactly the contribution total", async () => {
	balanceSat = 150_000;
	later(600, 154_000);
	await expectDelta(hub, 150_000_000, 4_000_000, 3_000);
});

test("the delta check fails when the hub balance rises by any other amount", async () => {
	balanceSat = 153_000;
	await assert.rejects(expectDelta(hub, 150_000_000, 4_000_000, 500), /fakehub moved by 3000 sat, expected 4000 sat/);
	balanceSat = 155_000;
	await assert.rejects(expectDelta(hub, 150_000_000, 4_000_000, 500), /moved by 5000 sat, expected 4000 sat/);
});

test("the no-double-charge check passes while the balance holds and fails when it moves", async () => {
	balanceSat = 149_000;
	await expectSteady(hub, 149_000_000, 600);
	later(300, 147_999);
	await assert.rejects(expectSteady(hub, 149_000_000, 1_000), /moved by -1001 sat, expected no change/);
});
