import { html } from "hono/html";

/** `paid` beads are dyed, `waiting` and `open` stay undyed, `notpaid` is marked, and the payee bead is gold. */
export type Bead = { name: string; tone: "paid" | "waiting" | "notpaid" | "open"; payee?: boolean };

const R = 58;
const C = 80;

/** The circle drawn as beads on a stitched ring, first member at the top, then clockwise in payout order. */
export function beadRing(beads: readonly Bead[], label: string, big: string, small: string) {
	const step = (2 * Math.PI) / Math.max(beads.length, 1);
	const r = Math.min(13, Math.max(6, (Math.PI * R) / Math.max(beads.length, 1) - 4));
	return html`<svg class="ring" viewBox="0 0 160 160" role="img" aria-label="${label}">
<circle class="thread" cx="${C}" cy="${C}" r="${R}"/>
${beads.map((b, i) => {
	const a = i * step - Math.PI / 2;
	const x = (C + R * Math.cos(a)).toFixed(1);
	const y = (C + R * Math.sin(a)).toFixed(1);
	const size = b.payee ? r + 3 : r;
	return html`<g class="bead ${b.payee ? "payee" : b.tone}">${b.payee ? html`<circle class="halo" cx="${x}" cy="${y}" r="${size + 4}"/>` : ""}<circle cx="${x}" cy="${y}" r="${size}"/>${
		r >= 9 ? html`<text x="${x}" y="${y}" dy="0.35em">${b.name.slice(0, 1).toUpperCase()}</text>` : ""
	}</g>`;
})}
<text class="c-big" x="${C}" y="${C - 2}">${big}</text>
<text class="c-small" x="${C}" y="${C + 16}">${small}</text>
</svg>`;
}
