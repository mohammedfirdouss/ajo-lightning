# Collect a round and watch each payment land

The round page at `/round/<n>` shows who the round pays, how many sats have arrived, and one row per payer. A row is yellow "Waiting", green "Paid", or red "Not paid" with a plain reason, such as "over your limit" for `QUOTA_EXCEEDED` and "not enough money" for `INSUFFICIENT_BALANCE`.

## Sub-features

- "Collect this round" starts the round. While it collects, `public/app.js` refetches the page each second and swaps the rows. Without scripts the page reloads every 2 seconds.
- A second press, a double tap, or a reload never starts a second collect of the same round.
- A partial round offers "Try the unpaid members again", which reruns the round. A complete round offers only its receipts.
- The progress card shows sats and naira paid out of the total.

## How to get to it (user POV)

On the circle page, tap "Round 1 pays Ada", then tap "Collect this round".

## Driving it with scripts and the hub API

Start the server per [web-circle.md](web-circle.md), join five members, open `/round/1`, and press the button. Wait for `#live[data-live="0"]`, which marks a round that has stopped collecting. Read each row from `li.row[data-member="memberN"]`, whose class is `paid`, `waiting` or `notpaid`.

To make member3 go over their limit on the fake source, start it with `AJO_FAKE_SPENT=member3:1000`. `AJO_FAKE_STEP_MS` sets the delay per wallet step, 400 ms by default, so rows turn green one by one.

## Gotchas

- With the fake source, wallet balances do not move. A lane that asks for a hub balance change needs the NWC runner from PR3.
- The fake runs one wallet step at a time, so payers turn green in member order.
