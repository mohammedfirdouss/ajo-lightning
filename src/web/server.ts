import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { type Context, Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { RoundReport } from "../../scripts/e2e.ts";
import { publish } from "../receipts/nostr.ts";
import type { ReminderInput } from "../reminders/templates.ts";
import { stateKeys } from "../run-round.ts";
import { type MemberId, type Round, roundId, sats } from "../round/types.ts";
import { openStore } from "../store/sqlite.ts";
import { connect, linkInfo } from "../wallet/nwc.ts";
import { money, status } from "./copy.ts";
import { fakeSource } from "./fake.ts";
import { nwcSource } from "./nwc-source.ts";
import { circlePage, createPage } from "./pages/circle.ts";
import { joinPage } from "./pages/join.ts";
import { receiptsPage } from "./pages/receipts.ts";
import { inlineHashes } from "./pages/layout.ts";
import { roundPage } from "./pages/round.ts";
import { limiter, lock, opens, PASSCODE } from "./passcode.ts";
import { dueDate, reminders } from "./remind.ts";
import { type Circle, type Links, maxContribution, nwcLink, payBudget, type RoundSource } from "./source.ts";

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const name = (v: unknown) => {
	const s = text(v);
	return s.length >= 1 && s.length <= 40 ? s : undefined;
};

const LANGS = new Set(["en", "pcm", "yo", "fr", "wo"]);

export type AppOptions = { remind?: (input: ReminderInput) => string; wrong?: ReturnType<typeof limiter> };

export function createApp(source: RoundSource, nairaPerSat: number, { remind = reminders(), wrong = limiter() }: AppOptions = {}) {
	const m = money(nairaPerSat);
	const collecting = new Map<number, Promise<RoundReport>>();
	const app = new Hono();

	const addr = (c: Context) => {
		try {
			return getConnInfo(c).remote.address ?? "unknown";
		} catch {
			return "unknown";
		}
	};
	/** Undefined when the passcode opens the circle, otherwise the words to show. */
	const refuse = async (c: Context, circle: Circle, code: unknown) => {
		const wait = wrong.wait(addr(c));
		if (wait > 0) {
			const mins = Math.ceil(wait / 60_000);
			return { status: 429 as const, text: `Too many wrong passcodes. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` };
		}
		if (typeof code === "string" && code.length <= PASSCODE.max && (await opens(circle.lock, code))) {
			wrong.clear(addr(c));
			return undefined;
		}
		wrong.fail(addr(c));
		return { status: 403 as const, text: "That passcode is not this circle's. Ask the organiser for it." };
	};

	const remindersFor = (circle: Circle, round: Round) => {
		const seat = new Map(circle.members.map((x, i) => [x.id, i + 1]));
		const due = dueDate(circle.start, circle.cadence, round.id);
		const out = new Map<MemberId, string>();
		for (const c of round.contributions) {
			if (status(c).tone === "paid") continue;
			out.set(c.payer, remind({ lang: circle.lang, amount: round.contribution, due, member: seat.get(c.payer) ?? 0 }));
		}
		return out;
	};

	app.use(
		secureHeaders({
			contentSecurityPolicy: { defaultSrc: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"], imgSrc: ["'self'", "blob:"], styleSrc: [inlineHashes.style], scriptSrc: [inlineHashes.script] },
		}),
	);

	const rounds = async (count: number) => {
		const out = [];
		for (let n = 1; n <= count; n++) {
			const r = await source.round(roundId(n));
			if (r) out.push(r);
		}
		return out;
	};

	app.get("/", async (c) => {
		const circle = await source.circle();
		if (!circle) return c.html(createPage({ capSat: source.demo?.capSat }));
		return c.html(circlePage(circle, await rounds(circle.members.length), m));
	});

	app.post("/circle", async (c) => {
		const body = await c.req.parseBody();
		const n = name(body.name);
		const contribution = Number(text(body.contribution));
		const cadence = text(body.cadence);
		const lang = text(body.lang);
		const code = typeof body.passcode === "string" ? body.passcode : "";
		const fail = (error: string) => c.html(createPage({ error, capSat: source.demo?.capSat }), 422);
		if (!n || !Number.isSafeInteger(contribution) || contribution < 1 || contribution > 1_000_000 || (cadence !== "weekly" && cadence !== "monthly") || !LANGS.has(lang)) {
			return fail("Give the circle a name, a whole number of sats from 1 to 1,000,000, how often members pay, and a reminder language.");
		}
		if (code.length < PASSCODE.min || code.length > PASSCODE.max) {
			return fail(`Choose a passcode of ${PASSCODE.min} to ${PASSCODE.max} characters.`);
		}
		const cap = source.demo?.capSat;
		if (cap !== undefined && payBudget(contribution) > cap) {
			return fail(`On this demo stack each wallet can pay up to ${cap} sat a week, fee included. Choose ${maxContribution(cap)} sat or less.`);
		}
		if (await source.circle()) return c.redirect("/", 303);
		const start = new Date().toISOString().slice(0, 10);
		await source.create({ name: n, contribution: sats(contribution), cadence, lang: lang as Circle["lang"], start, lock: await lock(code) });
		return c.redirect("/", 303);
	});

	app.get("/join", async (c) => {
		const circle = await source.circle();
		return circle ? c.html(joinPage(circle, m, { demo: source.demo?.wallets.length })) : c.redirect("/", 303);
	});

	app.post("/join", async (c) => {
		const circle = await source.circle();
		if (!circle) return c.redirect("/", 303);
		const body = await c.req.parseBody();
		const n = name(body.name);
		const fail = (error: string, code: 403 | 422 | 429 = 422) => c.html(joinPage(circle, m, { error, name: text(body.name).slice(0, 40), demo: source.demo?.wallets.length }), code);
		if (!n) return fail("Type your name, up to 40 letters.");
		const refused = await refuse(c, circle, body.passcode);
		if (refused) return fail(refused.text, refused.status);
		let links: Partial<Links> = { pay: nwcLink(text(body.pay)), receive: nwcLink(text(body.receive)) };
		if (body.use === "demo") {
			const seat = Number(text(body.demo));
			links = source.demo?.wallets[seat - 1] ?? {};
			if (!links.pay) return fail("Pick one of the demo wallets.");
		}
		const { pay, receive } = links;
		if (!pay || !receive) return fail("Each link must be a whole nostr+walletconnect:// link from your wallet. Paste both again.");
		if (pay === receive) return fail("The pay link and the receive link must be different links.");
		const joined = await source.join({ name: n, pay, receive });
		return joined.ok ? c.redirect("/", 303) : fail(joined.reason);
	});

	const roundParam = async (raw: string) => {
		const circle = await source.circle();
		const n = /^[1-9][0-9]{0,5}$/.test(raw) ? roundId(Number(raw)) : undefined;
		const round = circle && n ? await source.round(n) : undefined;
		return circle && round ? { circle, round } : undefined;
	};

	app.get("/round/:n", async (c) => {
		const found = await roundParam(c.req.param("n"));
		if (!found) return c.notFound();
		const stalled = found.round.phase === "collecting" && !collecting.has(found.round.id);
		return c.html(roundPage(found.circle, found.round, m, { reminders: remindersFor(found.circle, found.round), stalled }));
	});

	app.post("/round/:n/collect", async (c) => {
		const found = await roundParam(c.req.param("n"));
		if (!found) return c.notFound();
		const refused = await refuse(c, found.circle, (await c.req.parseBody()).passcode);
		if (refused) return c.html(roundPage(found.circle, found.round, m, { error: refused.text, reminders: remindersFor(found.circle, found.round) }), refused.status);
		const n = found.round.id;
		if (!collecting.has(n) && found.round.phase !== "complete") {
			const run = source.collect(n).finally(() => collecting.delete(n));
			run.catch((e: Error) => console.error(`round ${n} stopped: ${e.message}`));
			collecting.set(n, run);
		}
		return c.redirect(`/round/${n}`, 303);
	});

	app.get("/receipts", async (c) => {
		const circle = await source.circle();
		if (!circle) return c.redirect("/", 303);
		return c.html(receiptsPage(circle, await rounds(circle.members.length), m));
	});

	return app;
}

function sourceFromEnv(env: NodeJS.ProcessEnv): RoundSource {
	if (env.AJO_SOURCE === "fake") {
		const spentSat = Object.fromEntries((env.AJO_FAKE_SPENT ?? "").split(",").filter(Boolean).map((kv) => kv.split(":")).map(([k, v]) => [k, Number(v)]));
		return fakeSource({ stepMs: Number(env.AJO_FAKE_STEP_MS ?? 400), spentSat });
	}
	const dir = env.AJO_STATE_DIR;
	if (!dir) throw new Error("set AJO_STATE_DIR to the stack's state directory, or run docker compose up, which serves the pages on the regtest stack. AJO_SOURCE=fake runs them on in-memory wallets.");
	const { secretKey, circleKey } = stateKeys(dir);
	const relay = env.AJO_RELAY_URL ?? "ws://relay:8080";
	const seeded = `${dir}/connections.json`;
	const stack = existsSync(seeded) ? (JSON.parse(readFileSync(seeded, "utf8")) as { budgetSat: number; members: { pay: { uri: string }; receive: { uri: string } }[] }) : undefined;
	const demo = stack && {
		capSat: sats(stack.budgetSat),
		wallets: stack.members.flatMap((x) => {
			const pay = nwcLink(x.pay.uri);
			const receive = nwcLink(x.receive.uri);
			return pay && receive ? [{ pay, receive }] : [];
		}),
	};
	return nwcSource({
		store: openStore(`${dir}/ajo.db`, secretKey),
		circleKey,
		relayUrl: env.AJO_PUBLIC_RELAY_URL ?? relay,
		publish: (events) => publish(relay, events),
		connect,
		linkInfo,
		demo,
	});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const rate = Number(process.env.AJO_NAIRA_PER_SAT ?? 1.5);
	if (!(rate > 0)) throw new Error(`AJO_NAIRA_PER_SAT must be a positive number, got ${process.env.AJO_NAIRA_PER_SAT}`);
	const port = Number(process.env.PORT ?? 8000);
	const hostname = process.env.HOST ?? "127.0.0.1";
	serve({ fetch: createApp(sourceFromEnv(process.env), rate).fetch, port, hostname }, () => console.log(`ajo web on http://${hostname}:${port}`));
}
