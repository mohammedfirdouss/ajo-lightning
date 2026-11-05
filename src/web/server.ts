import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { RoundReport } from "../../scripts/e2e.ts";
import { roundId, sats } from "../round/types.ts";
import { money } from "./copy.ts";
import { fakeSource } from "./fake.ts";
import { circlePage, createPage } from "./pages/circle.ts";
import { joinPage } from "./pages/join.ts";
import { receiptsPage } from "./pages/receipts.ts";
import { roundPage } from "./pages/round.ts";
import { nwcLink, type RoundSource } from "./source.ts";

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const name = (v: unknown) => {
	const s = text(v);
	return s.length >= 1 && s.length <= 40 ? s : undefined;
};

const publicDir = fileURLToPath(new URL("../../public/", import.meta.url));
const asset = (file: string, type: string) => ({ body: readFileSync(publicDir + file, "utf8"), type });

export function createApp(source: RoundSource, nairaPerSat: number) {
	const m = money(nairaPerSat);
	const assets = { "/app.css": asset("app.css", "text/css"), "/app.js": asset("app.js", "text/javascript") };
	const collecting = new Map<number, Promise<RoundReport>>();
	const app = new Hono();

	app.use(
		secureHeaders({
			contentSecurityPolicy: { defaultSrc: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"], imgSrc: ["'self'", "blob:"] },
		}),
	);

	for (const [path, a] of Object.entries(assets)) {
		app.get(path, (c) => c.body(a.body, 200, { "content-type": `${a.type}; charset=utf-8`, "cache-control": "public, max-age=300" }));
	}

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
		if (!circle) return c.html(createPage());
		return c.html(circlePage(circle, await rounds(circle.members.length), m));
	});

	app.post("/circle", async (c) => {
		const body = await c.req.parseBody();
		const n = name(body.name);
		const contribution = Number(text(body.contribution));
		const cadence = text(body.cadence);
		if (!n || !Number.isSafeInteger(contribution) || contribution < 1 || contribution > 1_000_000 || (cadence !== "weekly" && cadence !== "monthly")) {
			return c.html(createPage("Give the circle a name, a whole number of sats from 1 to 1,000,000, and how often members pay."), 422);
		}
		if (await source.circle()) return c.redirect("/", 303);
		await source.create({ name: n, contribution: sats(contribution), cadence });
		return c.redirect("/", 303);
	});

	app.get("/join", async (c) => {
		const circle = await source.circle();
		return circle ? c.html(joinPage(circle, m)) : c.redirect("/", 303);
	});

	app.post("/join", async (c) => {
		const circle = await source.circle();
		if (!circle) return c.redirect("/", 303);
		const body = await c.req.parseBody();
		const n = name(body.name);
		const pay = nwcLink(text(body.pay));
		const receive = nwcLink(text(body.receive));
		const fail = (msg: string) => c.html(joinPage(circle, m, msg, text(body.name).slice(0, 40)), 422);
		if (!n) return fail("Type your name, up to 40 letters.");
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
		return c.html(roundPage(found.circle, found.round, m));
	});

	app.post("/round/:n/collect", async (c) => {
		const found = await roundParam(c.req.param("n"));
		if (!found) return c.notFound();
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
	if (env.AJO_SOURCE !== "fake") {
		throw new Error("no round runner is wired in yet. Set AJO_SOURCE=fake to run the pages on in-memory wallets.");
	}
	const spentSat = Object.fromEntries((env.AJO_FAKE_SPENT ?? "").split(",").filter(Boolean).map((kv) => kv.split(":")).map(([k, v]) => [k, Number(v)]));
	return fakeSource({ stepMs: Number(env.AJO_FAKE_STEP_MS ?? 400), spentSat });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const rate = Number(process.env.AJO_NAIRA_PER_SAT ?? 1.5);
	if (!(rate > 0)) throw new Error(`AJO_NAIRA_PER_SAT must be a positive number, got ${process.env.AJO_NAIRA_PER_SAT}`);
	const port = Number(process.env.PORT ?? 8000);
	const hostname = process.env.HOST ?? "127.0.0.1";
	serve({ fetch: createApp(sourceFromEnv(process.env), rate).fetch, port, hostname }, () => console.log(`ajo web on http://${hostname}:${port}`));
}
