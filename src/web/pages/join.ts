import { html } from "hono/html";
import type { Money } from "../copy.ts";
import type { Circle } from "../source.ts";
import { layout } from "./layout.ts";
import { passcodeToEnter, per } from "./circle.ts";

/** `demo` is how many seeded regtest wallets the stack offers. */
export const joinPage = (circle: Circle, m: Money, { error, name = "", demo = 0 }: { error?: string; name?: string; demo?: number } = {}) =>
	layout(
		`Join ${circle.name}`,
		html`<p class="back"><a href="/">Back to ${circle.name}</a></p>
<h1>Join ${circle.name}</h1>
<p class="mut">You pay ${m.sat(circle.contribution)} (${m.naira(circle.contribution)}) ${per[circle.cadence]}, straight to that round's member.</p>
${error ? html`<p class="error" role="alert">${error}</p>` : ""}
<form method="post" action="/join" class="stack">
<label>Your name <input name="name" required maxlength="40" autocomplete="name" value="${name}"></label>
${passcodeToEnter}
<label>Pay link from your wallet
<input type="password" name="pay" required autocomplete="off" spellcheck="false" data-scan placeholder="nostr+walletconnect://…">
<span class="hint">Make it with a ${circle.cadence} limit. Ajo can never spend more than that limit.</span></label>
<label>Receive link from your wallet
<input type="password" name="receive" required autocomplete="off" spellcheck="false" data-scan placeholder="nostr+walletconnect://…">
<span class="hint">Give it only the permissions to create invoices and look them up, so it cannot spend.</span></label>
<button>Join</button>
${
	demo > 0
		? html`<fieldset class="demo"><legend>Or use a demo wallet</legend>
<p class="mut">This regtest stack made ${demo} wallets. Pick one instead of pasting links. Ajo checks its links the same way.</p>
<label>Demo wallet <select name="demo">${Array.from({ length: demo }, (_, i) => html`<option value="${i + 1}">Demo wallet ${i + 1}</option>`)}</select></label>
<button class="alt" name="use" value="demo" formnovalidate>Join with the demo wallet</button>
</fieldset>`
		: ""
}
</form>
<p class="note">Ajo keeps your links locked and never shows them again.</p>`,
	);
