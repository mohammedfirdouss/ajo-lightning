import assert from "node:assert/strict";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { reminder, TIMEOUT_MS } from "../../src/reminders/reminders.ts";
import { LANGUAGES, type Lang, reminderInput } from "../../src/reminders/templates.ts";
import { sats } from "../../src/round/types.ts";

const input = (lang: Lang) => reminderInput({ lang, amount: sats(4000), due: "2026-11-12", member: 3 });

const reply = (text: string) =>
	new Response(
		JSON.stringify({
			id: "msg_1",
			type: "message",
			role: "assistant",
			model: "claude-opus-5-5",
			content: [{ type: "text", text }],
			stop_reason: "end_turn",
			usage: { input_tokens: 1, output_tokens: 1 },
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);

function fakeClient(respond: (body: string, signal?: AbortSignal | null) => Promise<Response>) {
	const bodies: string[] = [];
	const client = new Anthropic({
		apiKey: "sk-test",
		fetch: (async (_url: string, init: RequestInit) => {
			bodies.push(String(init.body));
			return respond(String(init.body), init.signal);
		}) as typeof fetch,
	});
	return { client, bodies };
}

test("every language has a template that names the amount and due date", () => {
	for (const lang of Object.keys(LANGUAGES) as Lang[]) {
		const text = LANGUAGES[lang].template(input(lang));
		assert.ok(text.includes("4000 sats") && text.includes("2026-11-12"), `${lang}: ${text}`);
	}
});

test("without a client the reminder is the template in the chosen language", async () => {
	assert.deepEqual(await reminder(input("yo"), undefined), { text: LANGUAGES.yo.template(input("yo")), source: "template" });
});

test("the request body holds no member name or phone number, even when the caller passes them", async () => {
	const { client, bodies } = fakeClient(async () => reply("Member 3, pay 4000 sats by 2026-11-12."));
	const leaky = { ...input("fr"), name: "Aminata Diallo", phone: "+221770000000", nwc: "nostr+walletconnect://secret" };
	const r = await reminder(leaky, client);
	assert.equal(r.source, "ai");
	assert.equal(bodies.length, 1);
	for (const secret of ["Aminata", "Diallo", "+221770000000", "walletconnect", "secret"]) assert.ok(!bodies[0].includes(secret), `body leaks ${secret}`);
	assert.ok(bodies[0].includes("French") && bodies[0].includes("4000 sats"));
});

test("a call that hangs falls back to the template in under 5 seconds", async () => {
	const { client } = fakeClient(
		(_body, signal) => new Promise((_, reject) => signal?.addEventListener("abort", () => reject(signal.reason))),
	);
	const start = performance.now();
	const r = await reminder(input("wo"), client);
	const ms = performance.now() - start;
	assert.equal(r.source, "template");
	assert.equal(r.text, LANGUAGES.wo.template(input("wo")));
	assert.ok(ms >= TIMEOUT_MS && ms < 5000, `fell back after ${Math.round(ms)} ms`);
});

test("a failed call falls back to the template", async () => {
	const { client, bodies } = fakeClient(async () => new Response('{"type":"error","error":{"type":"overloaded_error","message":"x"}}', { status: 529 }));
	assert.equal((await reminder(input("pcm"), client)).source, "template");
	assert.equal(bodies.length, 1, "no retry eats into the time limit");
});

test("a reply that drops the amount, due date, or seat falls back to the template", async () => {
	for (const text of ["Please pay soon.", "Member 3, please pay soon.", "Hi, pay 4000 sats by 2026-11-12.", "Member 31, pay 4000 sats by 2026-11-12."]) {
		const { client } = fakeClient(async () => reply(text));
		assert.equal((await reminder(input("en"), client)).source, "template", text);
	}
});

test("round state outside the domain is rejected before any reminder", () => {
	assert.throws(() => reminderInput({ lang: "de", amount: sats(1), due: "2026-11-12", member: 1 }), /not a language/);
	assert.throws(() => reminderInput({ lang: "en", amount: sats(1), due: "12/11/2026", member: 1 }), /YYYY-MM-DD/);
	assert.throws(() => reminderInput({ lang: "en", amount: sats(1), due: "2026-11-12", member: 0 }), /member seat/);
	assert.throws(() => reminderInput({ lang: "en", amount: sats(0), due: "2026-11-12", member: 1 }), /positive amount/);
	for (const due of ["2026-02-31", "2026-04-31", "2026-02-29", "2026-13-01"]) {
		assert.throws(() => reminderInput({ lang: "en", amount: sats(1), due, member: 1 }), /YYYY-MM-DD/, due);
	}
	assert.equal(reminderInput({ lang: "en", amount: sats(1), due: "2028-02-29", member: 1 }).due, "2028-02-29");
});
