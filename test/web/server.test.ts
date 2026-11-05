import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import { fakeSource } from "../../src/web/fake.ts";
import { createApp } from "../../src/web/server.ts";
import type { RoundSource } from "../../src/web/source.ts";

const link = () => `nostr+walletconnect://${randomBytes(32).toString("hex")}?relay=ws%3A%2F%2Frelay%3A8080&secret=${randomBytes(32).toString("hex")}`;
const form = (fields: Record<string, string>) => ({ method: "POST", body: new URLSearchParams(fields) });
const names = ["Ada", "Bola", "Chidi", "Dayo", "Efe"];

async function circleOfFive(source: RoundSource) {
	const app = createApp(source, 1.5);
	assert.equal((await app.request("/circle", form({ name: "Market ajo", contribution: "1000", cadence: "monthly" }))).status, 303);
	for (const name of names) assert.equal((await app.request("/join", form({ name, pay: link(), receive: link() }))).status, 303);
	return app;
}

async function until(read: () => Promise<string>, done: RegExp) {
	for (let i = 0; i < 200; i++) {
		const page = await read();
		if (done.test(page)) return page;
		await new Promise((r) => setTimeout(r, 5));
	}
	throw new Error(`never matched ${done}`);
}

test("pressing collect twice starts the round once, and every payer row ends paid", async () => {
	const source = fakeSource({ stepMs: 1 });
	let calls = 0;
	const counted: RoundSource = { ...source, collect: (n) => {
		calls++;
		return source.collect(n);
	} };
	const app = await circleOfFive(counted);
	const [a, b] = await Promise.all([app.request("/round/1/collect", { method: "POST" }), app.request("/round/1/collect", { method: "POST" })]);
	assert.equal(a.headers.get("location"), "/round/1");
	assert.equal(b.status, 303);
	const page = await until(async () => (await app.request("/round/1")).text(), /data-live="0"/);
	assert.equal(page.match(/class="row paid"/g)?.length, 4);
	assert.match(page, /4,000 sat of 4,000 sat/);
	await app.request("/round/1/collect", { method: "POST" });
	assert.equal(calls, 1);
});

test("a payer past their limit shows over your limit and the round is partly paid", async () => {
	const app = await circleOfFive(fakeSource({ spentSat: { member3: 1000 } }));
	await app.request("/round/1/collect", { method: "POST" });
	const page = await until(async () => (await app.request("/round/1")).text(), /data-live="0"/);
	assert.match(page, /data-member="member3"><b>Chidi<\/b><span><span class="word">Not paid<\/span>, over your limit/);
	assert.match(page, /Partly paid/);
	assert.match(page, /Try the unpaid members again/);
});

test("a bad link is refused with a plain message that never echoes what was pasted", async () => {
	const app = await circleOfFive(fakeSource());
	const secret = randomBytes(32).toString("hex");
	const res = await app.request("/join", form({ name: "Femi", pay: `nostr+walletconnect://abc?secret=${secret}`, receive: link() }));
	assert.equal(res.status, 422);
	const body = await res.text();
	assert.match(body, /must be a whole nostr\+walletconnect:\/\/ link/);
	assert.doesNotMatch(body, new RegExp(secret));
	const same = link();
	assert.match(await (await app.request("/join", form({ name: "Femi", pay: same, receive: same }))).text(), /must be different links/);
});

test("the circle closes to new members once round 1 has run", async () => {
	const app = await circleOfFive(fakeSource());
	await app.request("/round/1/collect", { method: "POST" });
	const res = await app.request("/join", form({ name: "Femi", pay: link(), receive: link() }));
	assert.equal(res.status, 422);
	assert.match(await res.text(), /closed to new members/);
});

test("pages carry a policy of self only plus the inlined stylesheet and script, and an unknown round is a 404", async () => {
	const app = await circleOfFive(fakeSource());
	const res = await app.request("/round/1");
	const csp = res.headers.get("content-security-policy") ?? "";
	assert.match(csp, /default-src 'self'/);
	const page = await res.text();
	const hash = (tag: string) => `'sha256-${createHash("sha256").update(page.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? "").digest("base64")}'`;
	assert.ok(csp.includes(`style-src ${hash("style")}`), "the policy lets the inlined stylesheet apply");
	assert.ok(csp.includes(`script-src ${hash("script")}`), "the policy lets the inlined script run");
	assert.equal((await app.request("/round/6")).status, 404);
	assert.equal((await app.request("/round/0")).status, 404);
});
