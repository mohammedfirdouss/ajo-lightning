# Collect a round and watch each payment land

The round page at `/round/<n>` shows who the round pays, how many sats have arrived, and one row per payer. A row is yellow "Waiting", green "Paid", or red "Not paid" with a plain reason, such as "over your limit" for `QUOTA_EXCEEDED` and "not enough money" for `INSUFFICIENT_BALANCE`.

## Sub-features

- "Collect this round" starts the round. While it collects, `public/app.js` refetches the page each second and swaps the rows. Without scripts the page reloads every 2 seconds.
- A second press, a double tap, or a reload never starts a second collect of the same round.
- A partial round offers "Check unpaid payments", with a line above the bar that says it never charges anyone again and that a member who did not pay can settle with the organiser. The button reruns the round. The rerun never pays again. It cancels the expired invoices again, which returns any payment that reached the payee's hub after the first cancel. The rows stay "Not paid". A complete round offers only its receipts.
- A round left collecting with no collect running, after a runner error such as an NWC relay timeout or a `web` restart mid-round, reads "Stopped" and offers "Finish collecting this round". To reach it on the stack, press collect, then run `docker compose kill web` and `docker compose up -d --no-deps web` at once.
- The progress card shows sats and naira paid out of the total.
- The passcode field and the button sit in the bar fixed to the bottom of the screen. A wrong passcode starts no round and shows "That passcode is not this circle's".
- Each row that is waiting or not paid shows a reminder in the circle's language and a "Copy for WhatsApp" button that puts the reminder on the clipboard. A paid row shows none. With `ANTHROPIC_API_KEY` set, the first load shows the template and a later load shows the model's text.

## How to get to it (user POV)

On the circle page, tap "Round 1 pays Ada", type the passcode, then tap "Collect this round".

## Driving it with scripts and the hub API

Start the server per [web-circle.md](web-circle.md), join five members, open `/round/1`, fill `getByLabel("Circle passcode")`, and press the button. On the stack, read every member hub's balance before and after. The payee gains 4000 sat, and each payer loses 1000 sat plus a 1 sat routing fee. Wait for `#live[data-live="0"]`, which marks a round that has stopped collecting. Read each payer's row by the name in its `<b>`, as in `page.locator("li.row", { has: page.locator("b", { hasText: /^Chidi$/ }) })`. Its class is `paid`, `waiting` or `notpaid`. The `data-member` attribute is `memberN` on the fake source but a pseudonym such as `a22a5f23b167edda` on the stack, so do not select by it there.

To make member3 go over their limit on the fake source, start it with `AJO_FAKE_SPENT=member3:1000`. `AJO_FAKE_STEP_MS` sets the delay per wallet step, 400 ms by default, so rows turn green one by one.

## Gotchas

- With the fake source, wallet balances do not move. A lane that asks for a hub balance change needs the stack.
- On the stack a round of four payers completes in about 1 second, so a reload mid-round has a short window.
- The fake runs one wallet step at a time, so payers turn green in member order.
- To grant clipboard access in Playwright, create the context with `permissions: ["clipboard-read", "clipboard-write"]`.
