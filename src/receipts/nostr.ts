import { type Event, finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { Relay } from "nostr-tools/relay";
import type { MemberId, PaymentHash, RoundId, Sats } from "../round/types.ts";

export type Receipt = { round: RoundId; payer: MemberId; amount: Sats; paymentHash: PaymentHash };

/** A plain text note, so any Nostr client shows it. `payer` is the pseudonym, never a name. */
export const RECEIPT_KIND = 1;
export const RECEIPT_TAG = "ajo-receipt";

export function receiptEvent(circleKey: Uint8Array, r: Receipt, createdAt: number): Event {
	return finalizeEvent(
		{
			kind: RECEIPT_KIND,
			created_at: createdAt,
			content: `Ajo round ${r.round}: ${r.amount} sat paid over Lightning`,
			tags: [
				["t", RECEIPT_TAG],
				["round", String(r.round)],
				["payer", r.payer],
				["amount", String(r.amount)],
				["payment_hash", r.paymentHash],
			],
		},
		circleKey,
	);
}

export const circlePubkey = (circleKey: Uint8Array) => getPublicKey(circleKey);

/** A relay drops an event it already holds, so publishing a stored event again leaves one receipt. */
export async function publish(relayUrl: string, events: Event[]) {
	if (events.length === 0) return;
	const relay = await Relay.connect(relayUrl);
	try {
		await Promise.all(events.map((e) => relay.publish(e)));
	} finally {
		relay.close();
	}
}
