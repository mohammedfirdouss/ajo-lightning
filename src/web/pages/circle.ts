import { html } from "hono/html";
import type { Round } from "../../round/types.ts";
import { type Money, roundWord } from "../copy.ts";
import type { Circle } from "../source.ts";
import { type Html, layout } from "./layout.ts";

export const createPage = (error?: string) =>
	layout(
		"Start a circle",
		html`<h1>Start a savings circle</h1>
<p class="mut">Each round, every member pays one member straight from their own wallet. Nobody holds a pot.</p>
${error ? html`<p class="error" role="alert">${error}</p>` : ""}
<form method="post" action="/circle" class="stack card">
<label>Circle name <input name="name" required maxlength="40" autocomplete="off"></label>
<label>Each member pays, in sats <input name="contribution" required inputmode="numeric" pattern="[0-9]+" value="1000"></label>
<fieldset><legend>How often</legend>
<label class="choice"><input type="radio" name="cadence" value="weekly"> Every week</label>
<label class="choice"><input type="radio" name="cadence" value="monthly" checked> Every month</label>
</fieldset>
<button>Start the circle</button>
</form>`,
	);

export const per = { weekly: "a week", monthly: "a month" } as const;

export function circlePage(circle: Circle, rounds: readonly Round[], m: Money): Html {
	const names = new Map(circle.members.map((x) => [x.id, x.name]));
	const joinable = (rounds[0]?.phase ?? "scheduled") === "scheduled";
	return layout(
		circle.name,
		html`<h1>${circle.name}</h1>
<p class="mut">Each member pays ${m.sat(circle.contribution)} (${m.naira(circle.contribution)}) ${per[circle.cadence]}.</p>
<section class="card"><h2>Payout order</h2>
${
	circle.members.length === 0
		? html`<p>No members yet.</p>`
		: html`<ol class="members">${circle.members.map(
				(x, i) => html`<li><b>${x.name}</b><span class="mut">Limit ${m.sat(x.capSat)} (${m.naira(x.capSat)}) ${per[circle.cadence]} · gets paid in round ${i + 1}</span></li>`,
			)}</ol>`
}</section>
${joinable ? html`<a class="button" href="/join">Join this circle</a>` : ""}
${
	rounds.length > 0
		? html`<section class="card"><h2>Rounds</h2><ul class="rounds">${rounds.map(
				(r) => html`<li><a href="/round/${r.id}">Round ${r.id} pays ${names.get(r.payee)}</a><span class="mut">${roundWord[r.phase]}</span></li>`,
			)}</ul></section>
<p><a href="/receipts">See the receipts</a></p>`
		: ""
}
<p class="note">${m.rateNote}</p>`,
	);
}
