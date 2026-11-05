import { NWCClient, type Nip47Transaction, Nip47TimeoutError, Nip47WalletError } from "@getalby/sdk/nwc";
import { type FailReason, HEX32, type Invoice, type Preimage, paymentHash, type RoundEvent, type Sats, sats } from "../round/types.ts";

export type LookupState = Extract<RoundEvent, { type: "lookupReplied" }>["invoice"];

/** A wallet refusal names a code. Anything else means no reply proved the payment either way. */
export function failReason(e: unknown): FailReason {
	if (e instanceof Nip47WalletError) {
		if (e.code === "QUOTA_EXCEEDED") return "QUOTA_EXCEEDED";
		if (e.code === "INSUFFICIENT_BALANCE") return "INSUFFICIENT_BALANCE";
		return "PAYMENT_FAILED";
	}
	return "TIMEOUT";
}

export function parseInvoice(tx: Nip47Transaction, amount: Sats): Invoice {
	if (typeof tx?.invoice !== "string" || !Number.isSafeInteger(tx.expires_at) || !Number.isSafeInteger(tx.amount) || tx.amount % 1000 !== 0) {
		throw new Error("the payee's wallet returned an invoice without a bolt11, amount, or expiry");
	}
	const invoice = { paymentHash: paymentHash(tx.payment_hash), bolt11: tx.invoice, amount: sats(tx.amount / 1000), expiresAt: tx.expires_at };
	if (invoice.amount !== amount) throw new Error(`the payee's wallet minted ${invoice.amount} sat, not ${amount} sat`);
	return invoice;
}

/**
 * The payee's hub keeps an unpaid invoice `pending` after it expires, so the expiry is read from the clock.
 * The grace covers an HTLC that the hub accepted just before expiry and settles just after.
 */
export const EXPIRY_GRACE_SEC = 5;

export function lookupState(tx: Pick<Nip47Transaction, "state" | "payment_hash">, invoice: Invoice, nowSec: number): LookupState {
	if (tx?.payment_hash !== invoice.paymentHash) throw new Error(`the payee's wallet looked up ${tx?.payment_hash}, not ${invoice.paymentHash}`);
	if (tx.state === "settled") return "settled";
	if (tx.state === "failed" || nowSec >= invoice.expiresAt + EXPIRY_GRACE_SEC) return "expired";
	return "open";
}

/** The SDK waits 60 seconds for a pay reply. A round has 120 in all, so a silent wallet counts as a timeout sooner. */
const PAY_REPLY_MS = 20_000;

function within<T>(ms: number, p: Promise<T>): Promise<T> {
	p.catch(() => {});
	let timer: NodeJS.Timeout | undefined;
	const late = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Nip47TimeoutError(`no reply in ${ms} ms`, "TIMEOUT")), ms);
	});
	return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

export type Wallet = ReturnType<typeof connect>;

export function connect(uri: string) {
	const client = new NWCClient({ nostrWalletConnectUrl: uri });
	return {
		async makeInvoice(amount: Sats, description: string, expirySec: number): Promise<Invoice> {
			return parseInvoice(await client.makeInvoice({ amount: amount * 1000, description, expiry: expirySec }), amount);
		},
		async pay(invoice: Invoice): Promise<{ preimage: Preimage } | { error: FailReason }> {
			try {
				const { preimage } = await within(PAY_REPLY_MS, client.payInvoice({ invoice: invoice.bolt11 }));
				return typeof preimage === "string" && HEX32.test(preimage) ? { preimage: preimage as Preimage } : { error: "PAYMENT_FAILED" };
			} catch (e) {
				return { error: failReason(e) };
			}
		},
		async lookup(invoice: Invoice): Promise<LookupState | undefined> {
			try {
				return lookupState(await client.lookupInvoice({ payment_hash: invoice.paymentHash }), invoice, Date.now() / 1000);
			} catch (e) {
				if (e instanceof Nip47WalletError || e instanceof Nip47TimeoutError) return undefined;
				throw e;
			}
		},
		close: () => client.close(),
	};
}
