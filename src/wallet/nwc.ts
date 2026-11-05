import { NWCClient, Nip47Error, type Nip47Transaction, Nip47TimeoutError, Nip47WalletError } from "@getalby/sdk/nwc";
import { type FailReason, HEX32, type Invoice, type PaymentHash, type Preimage, paymentHash, type Sats, sats } from "../round/types.ts";

/** What the payee's hub says about a hold invoice. `gone` is cancelled or expired on the hub, so it can never settle. */
export type HoldState = "open" | "accepted" | "settled" | "gone";

/** A wallet refusal names a code. Anything else means no reply proved the payment either way. */
export function failReason(e: unknown): FailReason {
	if (e instanceof Nip47WalletError) {
		if (e.code === "QUOTA_EXCEEDED") return "QUOTA_EXCEEDED";
		if (e.code === "INSUFFICIENT_BALANCE") return "INSUFFICIENT_BALANCE";
		return "PAYMENT_FAILED";
	}
	return "TIMEOUT";
}

export function parseInvoice(tx: Nip47Transaction, amount: Sats, hash: PaymentHash): Invoice {
	if (typeof tx?.invoice !== "string" || !Number.isSafeInteger(tx.expires_at) || !Number.isSafeInteger(tx.amount) || tx.amount % 1000 !== 0) {
		throw new Error("the payee's wallet returned an invoice without a bolt11, amount, or expiry");
	}
	const invoice = { paymentHash: paymentHash(tx.payment_hash), bolt11: tx.invoice, amount: sats(tx.amount / 1000), expiresAt: tx.expires_at };
	if (invoice.paymentHash !== hash) throw new Error(`the payee's wallet minted payment hash ${invoice.paymentHash}, not ${hash}`);
	if (invoice.amount !== amount) throw new Error(`the payee's wallet minted ${invoice.amount} sat, not ${amount} sat`);
	return invoice;
}

/** The hub also reports `expired`, which the SDK's type leaves out. */
export function holdState(tx: Pick<Nip47Transaction, "state" | "payment_hash">, invoice: Invoice): HoldState {
	if (tx?.payment_hash !== invoice.paymentHash) throw new Error(`the payee's wallet looked up ${tx?.payment_hash}, not ${invoice.paymentHash}`);
	const state: string = tx.state;
	if (state === "settled" || state === "accepted") return state;
	if (state === "failed" || state === "expired") return "gone";
	return "open";
}

/** The SDK waits 60 seconds for a pay reply. A round has 100 in all, so a silent wallet counts as a timeout sooner. */
const PAY_REPLY_MS = 20_000;

export function within<T>(ms: number, p: Promise<T>): Promise<T> {
	p.catch(() => {});
	let timer: NodeJS.Timeout | undefined;
	const late = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Nip47TimeoutError(`no reply in ${ms} ms`, "TIMEOUT")), ms);
	});
	return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/** The SDK logs every failed request with its stack before it throws. `connect` turns each throw into a reason, so that log only repeats it. */
const logError = console.error.bind(console);
console.error = (...args: unknown[]) => {
	if (typeof args[0] === "string" && args[0].startsWith("Failed to request ") && args[1] instanceof Nip47Error) return;
	logError(...args);
};

/**
 * Until a wallet has answered, every SDK request first fetches the wallet's info event to pick an encryption.
 * Concurrent fetches on one relay connection lose that event about one time in twenty, and the request is never sent.
 */
export function firstAlone() {
	let answered = false;
	let queue: Promise<unknown> = Promise.resolve();
	return <T>(req: () => Promise<T>): Promise<T> => {
		if (answered) return req();
		const p = queue.then(req);
		queue = p.then(
			() => {
				answered = true;
			},
			(e) => {
				if (e instanceof Nip47WalletError) answered = true;
			},
		);
		return p;
	};
}

export type Wallet = ReturnType<typeof connect>;

/**
 * Every call takes the most it may wait, in milliseconds, so a silent wallet cannot run a round past its budget.
 * A hold invoice moves no sats until `settle` hands the hub the preimage, so the runner decides when a payment lands.
 */
export function connect(uri: string) {
	const client = new NWCClient({ nostrWalletConnectUrl: uri });
	const send = firstAlone();
	return {
		async makeHoldInvoice(amount: Sats, description: string, expirySec: number, hash: PaymentHash, ms: number): Promise<Invoice> {
			return parseInvoice(await within(ms, send(() => client.makeHoldInvoice({ amount: amount * 1000, description, expiry: expirySec, payment_hash: hash }))), amount, hash);
		},
		async pay(invoice: Invoice, ms: number): Promise<{ preimage: Preimage } | { error: FailReason }> {
			try {
				const { preimage } = await within(Math.min(PAY_REPLY_MS, ms), send(() => client.payInvoice({ invoice: invoice.bolt11 })));
				return typeof preimage === "string" && HEX32.test(preimage) ? { preimage: preimage as Preimage } : { error: "PAYMENT_FAILED" };
			} catch (e) {
				return { error: failReason(e) };
			}
		},
		/** A lookup only reads, so any failure, including the SDK's plain relay errors, is no answer yet. */
		async lookup(invoice: Invoice, ms: number): Promise<HoldState | undefined> {
			const tx = await within(ms, send(() => client.lookupInvoice({ payment_hash: invoice.paymentHash }))).catch(() => undefined);
			return tx && holdState(tx, invoice);
		},
		/** The hub refuses a settle until a payment is accepted. A lookup tells whether a refused or silent settle landed. */
		async settle(preimage: Preimage, ms: number) {
			await within(ms, send(() => client.settleHoldInvoice({ preimage }))).catch(() => {});
		},
		/** The hub answers NOT_FOUND while no payment is held, and a failed invoice never settles anyway, so any error is fine. */
		async cancel(invoice: Invoice, ms: number) {
			await within(ms, send(() => client.cancelHoldInvoice({ payment_hash: invoice.paymentHash }))).catch(() => {});
		},
		close: () => client.close(),
	};
}

export type Renewal = "daily" | "weekly" | "monthly" | "yearly" | "never";
export type LinkInfo = { methods: readonly string[]; budget?: { totalSat: number; usedSat: number; renewal: Renewal } };

/** A wrong wallet key or secret only shows as silence, which the SDK gives up on after 10 seconds. */
const INFO_REPLY_MS = 12_000;

/** What a link may do, as its wallet reports it. Throws when the wallet does not answer. */
export async function linkInfo(uri: string): Promise<LinkInfo> {
	const client = new NWCClient({ nostrWalletConnectUrl: uri });
	try {
		const { methods } = await within(INFO_REPLY_MS, client.getInfo());
		const b = methods.includes("get_budget") ? await within(INFO_REPLY_MS, client.getBudget()) : {};
		if (!("total_budget" in b)) return { methods };
		return { methods, budget: { totalSat: Math.floor(b.total_budget / 1000), usedSat: Math.ceil(b.used_budget / 1000), renewal: b.renewal_period } };
	} finally {
		client.close();
	}
}
