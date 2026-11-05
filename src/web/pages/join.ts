import { html } from "hono/html";
import type { Money } from "../copy.ts";
import type { Circle } from "../source.ts";
import { layout } from "./layout.ts";
import { per } from "./circle.ts";

export const joinPage = (circle: Circle, m: Money, error?: string, name = "") =>
	layout(
		`Join ${circle.name}`,
		html`<p class="back"><a href="/">Back to ${circle.name}</a></p>
<h1>Join ${circle.name}</h1>
<p class="mut">You pay ${m.sat(circle.contribution)} (${m.naira(circle.contribution)}) ${per[circle.cadence]}, straight to that round's member.</p>
${error ? html`<p class="error" role="alert">${error}</p>` : ""}
<form method="post" action="/join" class="stack">
<label>Your name <input name="name" required maxlength="40" autocomplete="name" value="${name}"></label>
<label>Pay link from your wallet
<input type="password" name="pay" required autocomplete="off" spellcheck="false" data-scan placeholder="nostr+walletconnect://…">
<span class="hint">Make it with a ${circle.cadence} limit. Ajo can never spend more than that limit.</span></label>
<label>Receive link from your wallet
<input type="password" name="receive" required autocomplete="off" spellcheck="false" data-scan placeholder="nostr+walletconnect://…">
<span class="hint">Give it only the permissions to create invoices and look them up, so it cannot spend.</span></label>
<button>Join</button>
</form>
<p class="note">Ajo keeps your links locked and never shows them again.</p>`,
	);
