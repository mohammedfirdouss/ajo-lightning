import { html } from "hono/html";
import type { MemberId, Round } from "../../round/types.ts";
import { type Money, roundWord, status } from "../copy.ts";
import { PASSCODE } from "../passcode.ts";
import type { Circle } from "../source.ts";
import { beadRing } from "./beads.ts";
import { type Html, layout } from "./layout.ts";

/**
 * `reminders` holds the text for each payer who has not paid yet. `stalled` marks a round stored as collecting
 * that no collect is running, such as one whose runner stopped on a wallet error or a server restart.
 */
export type RoundView = { error?: string; reminders?: ReadonlyMap<MemberId, string>; stalled?: boolean };

const action: Partial<Record<Round["phase"] | "stalled", string>> = {
	scheduled: "Collect this round",
	stalled: "Finish collecting this round",
	partial: "Check unpaid payments",
};

const partialHelp = "This checks the unpaid payments again and sends back any sats that came too late. It never charges anyone again. A member who did not pay can settle with the organiser.";

export function roundPage(circle: Circle, round: Round, m: Money, { error, reminders, stalled = false }: RoundView = {}): Html {
	const names = new Map(circle.members.map((x) => [x.id, x.name]));
	const rows = round.contributions.map((c) => ({ c, s: status(c) }));
	const paid = rows.filter((r) => r.s.tone === "paid").length;
	const count = (tone: string) => rows.filter((r) => r.s.tone === tone).length;
	const total = round.contributions.length * round.contribution;
	const live = round.phase === "collecting" && !stalled;
	const label = action[stalled ? "stalled" : round.phase];
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
<p><b class="phase">${stalled ? "Stopped" : roundWord[round.phase]}</b> · ${paid} paid · ${count("waiting")} waiting · ${count("notpaid")} not paid</p>
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
		? html`${round.phase === "partial" ? html`<p class="hint">${partialHelp}</p>` : ""}<form method="post" action="/round/${round.id}/collect" class="bar collect"><label>Circle passcode <input type="password" name="passcode" required minlength="${PASSCODE.min}" maxlength="${PASSCODE.max}" autocomplete="current-password"></label><button>${label}</button></form>`
		: live
			? html`<div class="bar"><button disabled>Collecting…</button></div>`
			: html`<p><a href="/receipts">See the receipts</a></p>`
}
</div>
<p class="note">${m.rateNote}</p>`,
		live,
	);
}
