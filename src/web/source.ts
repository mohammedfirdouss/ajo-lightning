import type { RoundReport } from "../../scripts/e2e.ts";
import type { MemberId, Round, RoundId, Sats } from "../round/types.ts";

declare const nwc: unique symbol;
/** A `nostr+walletconnect://` link. It holds a spending secret, so no page, log or error ever shows it. */
export type NwcLink = string & { readonly [nwc]: true };

const NWC = /^nostr\+walletconnect:\/\/[0-9a-f]{64}\?(?=.*\brelay=)(?=.*\bsecret=[0-9a-f]{64}\b)\S+$/;

export function nwcLink(s: string): NwcLink | undefined {
	const t = s.trim();
	return NWC.test(t) ? (t as NwcLink) : undefined;
}

export type Cadence = "weekly" | "monthly";
/** `capSat` is what the member's pay connection lets the app spend each period, as their wallet reports it. */
export type Member = { id: MemberId; name: string; capSat: Sats };
/** `members` is the payout order. Round n pays `members[(n - 1) % members.length]`. */
export type Circle = {
	name: string;
	contribution: Sats;
	cadence: Cadence;
	members: readonly Member[];
	pubkey: string;
	relayUrl: string;
};
export type NewCircle = Pick<Circle, "name" | "contribution" | "cadence">;
export type NewMember = { name: string; pay: NwcLink; receive: NwcLink };
export type Joined = { ok: true; member: Member } | { ok: false; reason: string };

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
}
