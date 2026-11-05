import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import { roundId } from "../../src/round/types.ts";
import { fakeSource } from "../../src/web/fake.ts";
import { limiter } from "../../src/web/passcode.ts";
import { type AppOptions, createApp } from "../../src/web/server.ts";
import { nwcLink, type RoundSource } from "../../src/web/source.ts";

const link = () => `nostr+walletconnect://${randomBytes(32).toString("hex")}?relay=ws%3A%2F%2Frelay%3A8080&secret=${randomBytes(32).toString("hex")}`;
const form = (fields: Record<string, string>) => ({ method: "POST", body: new URLSearchParams(fields) });
const names = ["Ada", "Bola", "Chidi", "Dayo", "Efe"];
const passcode = "market-day";
const collect = (code = passcode) => form({ passcode: code });

async function circleOfFive(source: RoundSource, options?: AppOptions) {
	const app = createApp(source, 1.5, { remind: () => "template", ...options });
	assert.equal((await app.request("/circle", form({ name: "Market ajo", contribution: "1000", cadence: "monthly", lang: "en", passcode }))).status, 303);
	for (const name of names) assert.equal((await app.request("/join", form({ name, passcode, pay: link(), receive: link() }))).status, 303);
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
	const [a, b] = await Promise.all([app.request("/round/1/collect", collect()), app.request("/round/1/collect", collect())]);
	assert.equal(a.headers.get("location"), "/round/1");
	assert.equal(b.status, 303);
	const page = await until(async () => (await app.request("/round/1")).text(), /data-live="0"/);
	assert.equal(page.match(/class="row paid"/g)?.length, 4);
	assert.match(page, /4,000 sat of 4,000 sat/);
	await app.request("/round/1/collect", collect());
	assert.equal(calls, 1);
});

test("a payer past their limit shows over your limit and the round is partly paid", async () => {
	const app = await circleOfFive(fakeSource({ spentSat: { member3: 1000 } }));
	await app.request("/round/1/collect", collect());
	const page = await until(async () => (await app.request("/round/1")).text(), /data-live="0"/);
	assert.match(page, /data-member="member3"><b>Chidi<\/b><span><span class="word">Not paid<\/span>, over your limit/);
	assert.match(page, /Partly paid/);
	assert.match(page, /Try the unpaid members again/);
});

test("a bad link is refused with a plain message that never echoes what was pasted", async () => {
	const app = await circleOfFive(fakeSource());
	const secret = randomBytes(32).toString("hex");
	const res = await app.request("/join", form({ name: "Femi", passcode, pay: `nostr+walletconnect://abc?secret=${secret}`, receive: link() }));
	assert.equal(res.status, 422);
	const body = await res.text();
	assert.match(body, /must be a whole nostr\+walletconnect:\/\/ link/);
	assert.doesNotMatch(body, new RegExp(secret));
	const same = link();
	assert.match(await (await app.request("/join", form({ name: "Femi", passcode, pay: same, receive: same }))).text(), /must be different links/);
});

test("the circle closes to new members once round 1 has run", async () => {
	const app = await circleOfFive(fakeSource());
	await app.request("/round/1/collect", collect());
	const res = await app.request("/join", form({ name: "Femi", passcode, pay: link(), receive: link() }));
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

test("joining and collecting need the circle's passcode, and the receipts stay public", async () => {
	const source = fakeSource({ stepMs: 1 });
	const app = await circleOfFive(source);
	const join = await app.request("/join", form({ name: "Femi", passcode: "guessing", pay: link(), receive: link() }));
	assert.equal(join.status, 403);
	assert.match(await join.text(), /That passcode is not this circle&#39;s/);
	const res = await app.request("/round/1/collect", collect("guessing"));
	assert.equal(res.status, 403);
	assert.equal((await source.round(roundId(1)))?.phase, "scheduled", "a wrong passcode starts no round");
	assert.equal((await app.request("/receipts")).status, 200);
	assert.equal((await app.request("/round/1/collect", collect())).status, 303);
});

test("a circle needs a passcode of at least 6 characters, and the store keeps only its hash", async () => {
	const source = fakeSource();
	const app = createApp(source, 1.5, { remind: () => "template" });
	const short = await app.request("/circle", form({ name: "Market ajo", contribution: "1000", cadence: "monthly", lang: "en", passcode: "12345" }));
	assert.equal(short.status, 422);
	assert.match(await short.text(), /passcode of 6 to 64 characters/);
	await app.request("/circle", form({ name: "Market ajo", contribution: "1000", cadence: "monthly", lang: "en", passcode }));
	const lock = (await source.circle())?.lock;
	assert.ok(lock && !JSON.stringify(lock).includes(passcode));
	assert.match(lock.hash, /^[0-9a-f]{64}$/);
});

test("after five wrong passcodes even the right one waits out the window", async () => {
	let now = 0;
	const app = await circleOfFive(fakeSource(), { wrong: limiter({ max: 5, windowMs: 60_000, now: () => now }) });
	for (let i = 0; i < 5; i++) assert.equal((await app.request("/round/1/collect", collect("guessing"))).status, 403);
	const locked = await app.request("/round/1/collect", collect());
	assert.equal(locked.status, 429);
	assert.match(await locked.text(), /Too many wrong passcodes. Try again in 1 minute\./);
	now = 60_001;
	assert.equal((await app.request("/round/1/collect", collect())).status, 303);
});

test("a waiting payer's reminder comes from the reminder writer for their seat, language and due date", async () => {
	const asked: unknown[] = [];
	const app = await circleOfFive(fakeSource({ spentSat: { member3: 1000 } }), {
		remind: (input) => {
			asked.push(input);
			return `Member ${input.member} owes ${input.amount}`;
		},
	});
	await app.request("/round/1/collect", collect());
	const page = await until(async () => (await app.request("/round/1")).text(), /data-live="0"/);
	assert.match(page, /data-member="member3">[\s\S]*?Member 3 owes 1000[\s\S]*?Copy for WhatsApp/);
	assert.deepEqual(asked.at(-1), { lang: "en", amount: 1000, due: new Date().toISOString().slice(0, 10), member: 3 });
});

test("the demo wallets join through the same checks as pasted links", async () => {
	const demo = [{ pay: nwcLink(link()), receive: nwcLink(link()) }] as RoundSource["demo"];
	const joined: string[] = [];
	const source = { ...fakeSource(), demo };
	const app = await circleOfFive({
		...source,
		join: (x) => {
			joined.push(x.pay);
			return source.join(x);
		},
	});
	const res = await app.request("/join", form({ name: "Femi", passcode, use: "demo", demo: "1" }));
	assert.equal(res.status, 303);
	assert.equal(joined.at(-1), demo?.[0].pay);
	assert.equal((await app.request("/join", form({ name: "Gbenga", passcode, use: "demo", demo: "9" }))).status, 422);
});
