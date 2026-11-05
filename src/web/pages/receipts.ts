import { html } from "hono/html";
import type { Contribution, Paid, Round } from "../../round/types.ts";
import type { Money } from "../copy.ts";
import type { Circle } from "../source.ts";
import { type Html, layout } from "./layout.ts";

export function receiptsPage(circle: Circle, rounds: readonly Round[], m: Money): Html {
	const names = new Map(circle.members.map((x) => [x.id, x.name]));
	const paid = rounds.map((r) => ({ r, paid: (r.contributions as readonly Contribution[]).filter((c): c is Paid => c.state === "paid") })).filter((x) => x.paid.length > 0);
	return layout(
		"Receipts",
		html`<p class="back"><a href="/">Back to ${circle.name}</a></p>
<h1>Receipts</h1>
<p class="mut">Each payment has a receipt on Nostr, signed by the circle's key and tagged <code>ajo-receipt</code>. A receipt holds the round, the member's id, the amount and the payment hash, never a name.</p>
<dl class="key"><dt>Circle key</dt><dd><code>${circle.pubkey}</code></dd><dt>Relay</dt><dd><code>${circle.relayUrl}</code></dd></dl>
${
	paid.length === 0
		? html`<p>No payments yet.</p>`
		: paid.map(
				({ r, paid }) => html`<h2>Round ${r.id}, paid to ${names.get(r.payee)}</h2>
<ul class="receipts">${paid.map(
					(c) =>
						html`<li><b>${names.get(c.payer)}</b> <span class="mut">(${c.payer})</span> paid ${m.sat(c.invoice.amount)}<code>${c.invoice.paymentHash}</code></li>`,
				)}</ul>`,
			)
}`,
	);
}
