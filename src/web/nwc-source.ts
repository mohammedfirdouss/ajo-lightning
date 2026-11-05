import type { Event } from "nostr-tools/pure";
import { circlePubkey } from "../receipts/nostr.ts";
import { type RunEnv, runRound } from "../run-round.ts";
import { roundId, type Sats, sats } from "../round/types.ts";
import type { Store } from "../store/sqlite.ts";
import type { LinkInfo } from "../wallet/nwc.ts";
import { type Circle, type Demo, type Member, type NewCircle, type RoundSource, scheduled } from "./source.ts";

export type NwcSourceEnv = {
	store: Store;
	circleKey: Uint8Array;
	/** The relay as members see it, for the receipts page. The runner publishes through `publish`. */
	relayUrl: string;
	publish: (events: Event[]) => Promise<void>;
	connect: RunEnv["connect"];
	linkInfo: (uri: string) => Promise<LinkInfo>;
	demo?: Demo;
};

const fix = (what: string) => `Make a new ${what} in your wallet and paste it again.`;

export type LinkCheck = { ok: true; capSat: Sats } | { ok: false; reason: string };

/** Judges a pair of links by what their wallets report, in words a member can act on. `undefined` means no answer. */
export function checkLinks(pay: LinkInfo | undefined, receive: LinkInfo | undefined, contribution: Sats): LinkCheck {
	const no = (reason: string): LinkCheck => ({ ok: false, reason });
	if (!pay) return no("Ajo could not reach the wallet behind your pay link. Check that your wallet is online, then try again.");
	if (!receive) return no("Ajo could not reach the wallet behind your receive link. Check that your wallet is online, then try again.");
	if (receive.methods.includes("pay_invoice")) return no(`Your receive link can spend money, so Ajo will not keep it. ${fix("receive link that can only create invoices and look them up")}`);
	if (!receive.methods.includes("make_invoice") || !receive.methods.includes("lookup_invoice")) return no(`Your receive link cannot create invoices and look them up. ${fix("receive link with those two permissions")}`);
	if (pay.methods.includes("make_invoice")) return no(`Your pay link can also create invoices. ${fix("pay link that can only pay")}`);
	if (!pay.methods.includes("pay_invoice")) return no(`Your pay link cannot pay. ${fix("pay link with permission to pay")}`);
	if (pay.budgetSat === undefined) return no(`Your pay link has no spending limit. ${fix("pay link with a limit")}`);
	if (pay.budgetSat < contribution) return no(`Your pay link's limit of ${pay.budgetSat} sat is less than the ${contribution} sat each member pays. ${fix("pay link with a higher limit")}`);
	return { ok: true, capSat: sats(pay.budgetSat) };
}

export function nwcSource({ store, circleKey, relayUrl, publish, connect, linkInfo, demo }: NwcSourceEnv): RoundSource {
	const circle = (): Circle | undefined => {
		const c = store.circle() as NewCircle | undefined;
		if (!c) return undefined;
		const members = store.members().map((m) => ({ id: m.id, name: m.name, capSat: sats(m.capSat ?? 0) }));
		return { ...c, members, pubkey: circlePubkey(circleKey), relayUrl };
	};
	const reach = (uri: string) => linkInfo(uri).catch(() => undefined);

	return {
		circle: async () => circle(),
		create: async (c) => {
			store.createCircle(c);
			return circle() as Circle;
		},
		join: async ({ name, pay, receive }) => {
			const c = store.circle() as NewCircle | undefined;
			if (!c) return { ok: false, reason: "Start a circle first." };
			const refusal = () => {
				if (store.round(roundId(1))) return "This circle has started its rounds, so it is closed to new members.";
				const members = store.members();
				if (members.some((m) => m.name === name)) return "Someone in this circle already has that name. Add a surname or an initial.";
				if (members.some((m) => [m.pay, m.receive].some((l) => l === pay || l === receive))) {
					return "One of these links already belongs to a member of this circle. Each member joins with their own wallet.";
				}
			};
			const early = refusal();
			if (early) return { ok: false, reason: early };
			const [payInfo, receiveInfo] = await Promise.all([reach(pay), reach(receive)]);
			const check = checkLinks(payInfo, receiveInfo, c.contribution);
			if (!check.ok) return check;
			const late = refusal();
			if (late) return { ok: false, reason: late };
			store.addMembers([{ name, pay, receive, capSat: check.capSat }]);
			return { ok: true, member: circle()?.members.find((m) => m.name === name) as Member };
		},
		round: async (n) => {
			const c = circle();
			return c && (store.round(n) ?? scheduled(c, n));
		},
		collect: async (n) => {
			const c = circle();
			if (!c || !scheduled(c, n)) throw new RangeError(`round ${n} is not in this circle`);
			return runRound(n, { store, members: store.members(), connect, publish, circleKey, contribution: c.contribution });
		},
		demo,
	};
}
