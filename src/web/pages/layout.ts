import { html } from "hono/html";

export type Html = ReturnType<typeof html>;

/** `live` marks a page whose state is still changing, so app.js polls it and a browser without scripts reloads it. */
export const layout = (title: string, body: Html, live = false) => html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Ajo</title>
<link rel="stylesheet" href="/app.css">
<script src="/app.js" defer></script>
${live ? html`<noscript><meta http-equiv="refresh" content="2"></noscript>` : ""}
</head>
<body><main>${body}</main></body>
</html>`;
