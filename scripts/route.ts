import { nip47 } from "nostr-tools";
import { decrypt, encrypt, getConversationKey } from "nostr-tools/nip44";
import { finalizeEvent } from "nostr-tools/pure";
import { Relay } from "nostr-tools/relay";
import { hexToBytes } from "nostr-tools/utils";
import { expectDelta, loadStack, type Member, sat, snapshot } from "./stack.ts";

type NwcReply = {
	error?: { code: string; message: string };
	result?: { invoice?: string; payment_hash?: string };
};

async function nwc(relay: Relay, uri: string, method: string, params: object): Promise<NwcReply> {
	const wallet = nip47.parseConnectionString(uri);
	const sk = hexToBytes(wallet.secret);
	const key = getConversationKey(sk, wallet.pubkey);
	const request = finalizeEvent(
		{
			kind: 23194,
			created_at: Math.floor(Date.now() / 1000),
			tags: [
				["p", wallet.pubkey],
				["encryption", "nip44_v2"],
			],
			content: encrypt(JSON.stringify({ method, params }), key),
		},
		sk,
	);
	return new Promise((resolve, reject) => {
		const sub = relay.subscribe([{ kinds: [23195], authors: [wallet.pubkey], "#e": [request.id] }], {
			onevent(e) {
				clearTimeout(timer);
				sub.close();
				resolve(JSON.parse(decrypt(e.content, key)));
			},
		});
		const timer = setTimeout(() => {
			sub.close();
			reject(new Error(`${method} got no reply within 30s`));
		}, 30_000);
		relay.publish(request).catch(reject);
	});
}

async function main() {
	const stack = loadStack();
	const [payee] = stack.members;
	const payer = stack.members.find((m) => m.name === (process.argv[2] ?? "member2") && m !== payee);
	if (!payer)
		throw new Error(
			`usage: scripts/route [payer], where payer is one of ${stack.members
				.slice(1)
				.map((m) => m.name)
				.join(", ")}`,
		);
	const amountMsat = stack.contributionSat * 1000;
	const feeMsat = 1000;
	const relay = await Relay.connect(stack.relayUrl);
	const invoice = async (m: Member) => {
		const r = await nwc(relay, m.receive.uri, "make_invoice", {
			amount: amountMsat,
			description: "ajo route check",
			expiry: 60,
		});
		if (!r.result?.invoice) throw new Error(`${m.name} make_invoice failed: ${r.error?.code}`);
		return r.result;
	};
	const pay = async (from: string, to: Member) => {
		const { invoice: bolt11, payment_hash } = await invoice(to);
		const r = await nwc(relay, from, "pay_invoice", { invoice: bolt11 });
		return {
			code: r.error?.code,
			text: r.error ? `refused ${r.error.code}` : `paid, hash ${payment_hash?.slice(0, 16)}...`,
		};
	};
	let ok = true;
	const report = (pass: boolean, line: string) => {
		ok &&= pass;
		console.log(`${pass ? "ok  " : "FAIL"} ${line}`);
	};

	const hubs = [payer, payee, stack.router];
	const want = new Map([
		[payer.name, -(amountMsat + feeMsat)],
		[payee.name, amountMsat],
		[stack.router.name, feeMsat],
	]);
	const before = await snapshot(hubs);
	const paid = await pay(payer.pay.uri, payee);
	report(!paid.code, `${payer.name} pays ${payee.name} ${sat(amountMsat)} through the router: ${paid.text}`);
	const settled = await Promise.all(
		hubs.map((h) =>
			expectDelta(h, before.get(h.name) ?? 0, want.get(h.name) ?? 0).then(
				() => true,
				() => false,
			),
		),
	);
	const again = await pay(payer.pay.uri, payee);
	report(again.code === "QUOTA_EXCEEDED", `${payer.name} pays ${payee.name} again in the same month: ${again.text}`);
	const scoped = await pay(payee.receive.uri, payer);
	report(scoped.code === "RESTRICTED", `${payee.name}'s receive connection tries to pay: ${scoped.text}`);
	relay.close();

	const after = await snapshot(hubs);
	hubs.forEach((h, i) => {
		const [b, a] = [before.get(h.name) ?? 0, after.get(h.name) ?? 0];
		report(
			settled[i] && a - b === want.get(h.name),
			`${h.name} before ${sat(b)}, after ${sat(a)}, delta ${sat(a - b)}, expected ${sat(want.get(h.name) ?? 0)}`,
		);
	});
	return ok ? 0 : 1;
}

process.exit(
	await main().catch((e) => {
		console.log(`FAIL ${(e as Error).message}`);
		return 1;
	}),
);
