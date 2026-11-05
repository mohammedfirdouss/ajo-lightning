import type { Contribution, FailReason, Round } from "../round/types.ts";

export const reasonCopy: Record<FailReason, string> = {
	QUOTA_EXCEEDED: "over your limit",
	INSUFFICIENT_BALANCE: "not enough money",
	PAYMENT_FAILED: "the payment did not go through",
	TIMEOUT: "the wallet did not answer",
};

export type Status = { tone: "paid" | "waiting" | "notpaid"; word: "Paid" | "Waiting" | "Not paid"; detail?: string };

export function status(c: Contribution): Status {
	switch (c.state) {
		case "paid":
			return { tone: "paid", word: "Paid" };
		case "failed":
			return { tone: "notpaid", word: "Not paid", detail: reasonCopy[c.reason] };
		case "invoiced":
			return { tone: "waiting", word: "Waiting", detail: c.lastErr && `trying again, last try was ${reasonCopy[c.lastErr]}` };
		case "pending":
			return { tone: "waiting", word: "Waiting" };
	}
}

export const roundWord: Record<Round["phase"], string> = {
	scheduled: "Not started",
	collecting: "Collecting",
	complete: "Complete",
	partial: "Partly paid",
};

const satFmt = new Intl.NumberFormat("en-NG");
const ngnFmt = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

export type Money = { sat: (n: number) => string; naira: (n: number) => string; rateNote: string };

export function money(nairaPerSat: number): Money {
	return {
		sat: (n) => `${satFmt.format(n)} sat`,
		naira: (n) => ngnFmt.format(n * nairaPerSat),
		rateNote: `Naira at a fixed demo rate of ${ngnFmt.format(nairaPerSat * 1000)} per 1,000 sat, not a live price.`,
	};
}
