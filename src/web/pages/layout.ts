import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { html, raw } from "hono/html";

const read = (file: string) => readFileSync(new URL(`../../../public/${file}`, import.meta.url), "utf8");
const css = read("app.css");
const js = read("app.js");
const hash = (s: string) => `'sha256-${createHash("sha256").update(s).digest("base64")}'`;
/** Both files are inlined because on slow 3G each extra request costs another 2-second round trip. */
export const inlineHashes = { style: hash(css), script: hash(js) };

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
<body><main>${body}</main><script>${raw(js)}</script></body>
</html>`;
