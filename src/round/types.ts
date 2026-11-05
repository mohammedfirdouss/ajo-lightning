declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type Sats = Brand<number, "Sats">;
export type MemberId = Brand<string, "MemberId">;
export type RoundId = Brand<number, "RoundId">;

export function sats(n: number): Sats {
	if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`not a whole number of sats: ${n}`);
	return n as Sats;
}

export function memberId(s: string): MemberId {
	if (!/^[a-z0-9-]{1,32}$/.test(s)) throw new RangeError(`not a member id: ${JSON.stringify(s)}`);
	return s as MemberId;
}

export function roundId(n: number): RoundId {
	if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`not a round number: ${n}`);
	return n as RoundId;
}

/** A wallet refusal moves no money. `PAYMENT_FAILED` and `TIMEOUT` only mean no reply proved a payment. */
export type FailReason = "QUOTA_EXCEEDED" | "INSUFFICIENT_BALANCE" | "PAYMENT_FAILED" | "TIMEOUT";

/** `expiresAt` is in unix seconds, as NWC `make_invoice` returns it. */
export type Invoice = { paymentHash: string; bolt11: string; amount: Sats; expiresAt: number };

export type Pending = { state: "pending"; payer: MemberId };
/** `lastErr` never fails a contribution. Only a lookup that finds the invoice expired does. */
export type Invoiced = {
	state: "invoiced";
	payer: MemberId;
	invoice: Invoice;
	step: "pay" | "paying" | "lookup" | "lookupAtExpiry";
	tries: number;
	lastErr?: FailReason;
};
export type Paid = { state: "paid"; payer: MemberId; invoice: Invoice };
export type Failed = { state: "failed"; payer: MemberId; invoice: Invoice; reason: FailReason };
export type Contribution = Pending | Invoiced | Paid | Failed;

type Common = { id: RoundId; payee: MemberId; contribution: Sats; maxTries: number; reruns: number };

export type Round =
	| (Common & { phase: "scheduled"; contributions: readonly Pending[] })
	| (Common & { phase: "collecting"; contributions: readonly Contribution[] })
	| (Common & { phase: "complete"; contributions: readonly Paid[] })
	| (Common & { phase: "partial"; contributions: readonly (Paid | Failed)[] });

/** A crash has no event. The next process feeds `restarted`, which turns every invoiced contribution into a lookup. */
export type RoundEvent =
	| { type: "start" }
	| { type: "invoiceMade"; payer: MemberId; invoice: Invoice }
	| { type: "paySent"; payer: MemberId }
	| { type: "payReplied"; payer: MemberId; error?: FailReason }
	| { type: "lookupReplied"; payer: MemberId; invoice: "open" | "settled" | "expired" }
	| { type: "restarted" }
	| { type: "rerun" }
	| { type: "close" };

/**
 * Persist `paySent` before calling `pay_invoice`, so a crash mid-call leads to a lookup, not a second pay.
 * A lookup runs on the payee's wallet, never the payer's. A lookup with `waitUntil` (unix seconds) has no pay left
 * to try, so nothing changes before the invoice settles late or expires, and the runner can wait until then.
 */
export type Command =
	| { type: "makeInvoice"; payer: MemberId; amount: Sats }
	| { type: "pay"; payer: MemberId; invoice: Invoice }
	| { type: "lookup"; payer: MemberId; invoice: Invoice; waitUntil?: number }
	| { type: "close" };

export type Applied = { ok: true; round: Round } | { ok: false; round: Round; reason: string };
