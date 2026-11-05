import type { RoundReport } from "../../scripts/e2e.ts";
import type { Lang } from "../reminders/templates.ts";
import { newRound } from "../round/round.ts";
import type { MemberId, Round, RoundId, Sats } from "../round/types.ts";
import type { Lock } from "./passcode.ts";

declare const nwc: unique symbol;
/** A `nostr+walletconnect://` link. It holds a spending secret, so no page, log or error ever shows it. */
export type NwcLink = string & { readonly [nwc]: true };

const NWC = /^nostr\+walletconnect:\/\/[0-9a-f]{64}\?(?=.*\brelay=)(?=.*\bsecret=[0-9a-f]{64}\b)\S+$/;

export function nwcLink(s: string): NwcLink | undefined {
	const t = s.trim();
	return NWC.test(t) ? (t as NwcLink) : undefined;
}

/** A pay link must cover the contribution plus the routing fee the hub reserves for it, max(1%, 10 sat). */
export const payBudget = (contribution: number) => contribution + Math.max(Math.ceil(contribution / 100), 10);
export const maxContribution = (budget: number) => Math.min(budget - 10, Math.floor((100 * budget) / 101));

export type Cadence = "weekly" | "monthly";
/** `capSat` is what the member's pay connection lets the app spend each period, as their wallet reports it. */
export type Member = { id: MemberId; name: string; capSat: Sats };
/**
 * `members` is the payout order. Round n pays `members[(n - 1) % members.length]` and falls due `n - 1` periods
 * after `start`, a YYYY-MM-DD date. `lang` is the language of the reminders.
 */
export type Circle = {
	name: string;
	contribution: Sats;
	cadence: Cadence;
	lang: Lang;
	start: string;
	lock: Lock;
	members: readonly Member[];
	pubkey: string;
	relayUrl: string;
};
export type NewCircle = Omit<Circle, "members" | "pubkey" | "relayUrl">;
export type Links = { pay: NwcLink; receive: NwcLink };
export type NewMember = Links & { name: string };
/** The seeded regtest wallets, and the most each one may pay a week. */
export type Demo = { wallets: readonly Links[]; capSat: Sats };
export type Joined = { ok: true; member: Member } | { ok: false; reason: string };

/** A round nobody has collected yet. Undefined when the circle has no round `n`. */
export function scheduled(circle: Circle, n: RoundId): Round | undefined {
	const ms = circle.members;
	if (ms.length < 2 || n > ms.length) return undefined;
	const payee = ms[(n - 1) % ms.length].id;
	return newRound({ id: n, payee, payers: ms.map((x) => x.id).filter((x) => x !== payee), contribution: circle.contribution });
}

/**
 * What the pages need from the round runner. `round(n)` reads the stored state, so a page can poll it while
 * `collect(n)` runs. `collect` resolves once the round is complete or partial, and a second call reruns it under
 * the runner contract in `scripts/e2e.ts`.
 */
export interface RoundSource {
	circle(): Promise<Circle | undefined>;
	create(circle: NewCircle): Promise<Circle>;
	join(member: NewMember): Promise<Joined>;
	round(n: RoundId): Promise<Round | undefined>;
	collect(n: RoundId): Promise<RoundReport>;
	/** Lets a demo join members without copying links. Absent outside the demo stack. */
	demo?: Demo;
}
