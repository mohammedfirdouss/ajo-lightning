import { html } from "hono/html";
import type { MemberId, Round } from "../../round/types.ts";
import { type Money, roundWord, status } from "../copy.ts";
import type { Circle } from "../source.ts";
import { beadRing } from "./beads.ts";
import { passcodeToEnter } from "./circle.ts";
import { type Html, layout } from "./layout.ts";

/** `reminders` holds the text for each payer who has not paid yet. */
export type RoundView = { error?: string; reminders?: ReadonlyMap<MemberId, string> };

const action: Partial<Record<Round["phase"], string>> = {
	scheduled: "Collect this round",
	partial: "Try the unpaid members again",
};

export function roundPage(circle: Circle, round: Round, m: Money, { error, reminders }: RoundView = {}): Html {
	const names = new Map(circle.members.map((x) => [x.id, x.name]));
	const rows = round.contributions.map((c) => ({ c, s: status(c) }));
	const paid = rows.filter((r) => r.s.tone === "paid").length;
	const count = (tone: string) => rows.filter((r) => r.s.tone === tone).length;
	const total = round.contributions.length * round.contribution;
	const live = round.phase === "collecting";
	const label = action[round.phase];
	return layout(
		`Round ${round.id}`,
		html`<p class="back"><a href="/">Back to ${circle.name}</a></p>
<h1>Round ${round.id} pays ${names.get(round.payee)}</h1>
<p class="mut">${round.contributions.length} members pay ${m.sat(round.contribution)} (${m.naira(round.contribution)}) each.</p>
${error ? html`<p class="error" role="alert">${error}</p>` : ""}
<div id="live" data-live="${live ? "1" : "0"}" aria-live="polite">
<section class="prog">
${beadRing(
	circle.members.map((x) => (x.id === round.payee ? { name: x.name, tone: "open", payee: true } : { name: x.name, tone: rows.find((r) => r.c.payer === x.id)?.s.tone ?? "open" })),
	`${names.get(round.payee)} is paid this round. ${paid} of ${rows.length} members have paid.`,
	`${paid} of ${rows.length}`,
	"have paid",
)}
<p class="big">${m.sat(paid * round.contribution)} of ${m.sat(total)}</p>
<p class="mut">${m.naira(paid * round.contribution)} of ${m.naira(total)}</p>
<p><b class="phase">${roundWord[round.phase]}</b> · ${paid} paid · ${count("waiting")} waiting · ${count("notpaid")} not paid</p>
</section>
<ul class="rows">${rows.map(
			({ c, s }) => {
				const text = reminders?.get(c.payer);
				return html`<li class="row ${s.tone}" data-member="${c.payer}"><b>${names.get(c.payer)}</b><span><span class="word">${s.word}</span>${s.detail ? html`, ${s.detail}` : ""}</span>${
					text ? html`<div class="remind"><p>${text}</p><button type="button" class="alt" data-copy="${text}">Copy for WhatsApp</button></div>` : ""
				}</li>`;
			},
		)}</ul>
${
	label
		? html`<form method="post" action="/round/${round.id}/collect" class="stack">${passcodeToEnter}<div class="bar"><button>${label}</button></div></form>`
		: live
			? html`<div class="bar"><button disabled>Collecting…</button></div>`
			: html`<p><a href="/receipts">See the receipts</a></p>`
}
</div>
<p class="note">${m.rateNote}</p>`,
		live,
	);
}
