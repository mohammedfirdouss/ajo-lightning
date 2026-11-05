import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { html, raw } from "hono/html";

const read = (file: string) => readFileSync(new URL(`../../../public/${file}`, import.meta.url), "utf8");
const css = read("app.css");
const js = read("app.js");
const hash = (s: string) => `'sha256-${createHash("sha256").update(s).digest("base64")}'`;
/** Both files are inlined because on slow 3G each extra request costs another 2-second round trip. */
export const inlineHashes = { style: hash(css), script: hash(js) };

/** One band of adire cloth: tied rings (oniko) between rows of hand stitching (alabere), dyed in the stylesheet's colours. */
const band = raw(
	`<svg class="cloth" aria-hidden="true" focusable="false" width="100%" height="18"><defs><pattern id="adire" width="36" height="18" patternUnits="userSpaceOnUse"><path class="st" d="M2 2h5M11 2h5M20 2h5M29 2h5M2 16h5M11 16h5M20 16h5M29 16h5"/><circle class="tie" cx="9" cy="9" r="4"/><circle class="dot" cx="9" cy="9" r="1.3"/><path class="st" d="M24 6v6M28 6v6"/></pattern></defs><rect width="100%" height="18" fill="url(#adire)"/></svg>`,
);

export type Html = ReturnType<typeof html>;

/** `live` marks a page whose state is still changing, so app.js polls it and a browser without scripts reloads it. */
export const layout = (title: string, body: Html, live = false) => html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Ajo</title>
<style>${raw(css)}</style>
${live ? html`<noscript><meta http-equiv="refresh" content="2"></noscript>` : ""}
</head>
<body><header class="band"><a class="mark" href="/">Ajo</a><span class="tag">savings circle</span></header>${band}<main>${body}</main><script>${raw(js)}</script></body>
</html>`;
