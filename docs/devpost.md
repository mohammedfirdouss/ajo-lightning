# Devpost submission

The text for the Dakar Bitcoin Hack 2026 submission form. Each heading below is a form field. Copy the text under it.

## Project name

Ajo on Lightning: savings circles with no pot-holder

## Elevator pitch

A rotating savings circle where every member pays the payee straight from their own Lightning wallet, so nobody holds the pot.

## About the project

Paste everything between the two lines.

---

## Inspiration

In Nigeria people call it ajo or esusu. In Senegal and across francophone West Africa it is a tontine. A group of traders, colleagues or neighbours agree on an amount. Each week or month every member pays it in, and one member takes the whole pot, in turn, until everyone has had a payout.

The circle runs on trust in one person, the collector who holds the pot. If the collector disappears, spends the pot or favours a friend, the members lose their savings and have little recourse. Members cannot see who has paid until the collector tells them. Cash needs meetings, and bank transfers cost fees and wait on banking hours. We wanted to keep the habit and remove the person who can run off with it.

## Who it's for

The primary user is the circle organiser, often the woman who already runs a market traders' ajo or tontine, with 5 to 20 members. Today she collects cash or transfers, holds the pot, chases late payers and vouches for who paid. With Ajo on Lightning she presses one button. Each member's own wallet pays the payee directly, she holds nothing, each row shows who paid and why a payment failed, a reminder copies into the WhatsApp group, and every payment has a signed Nostr receipt.

Reach, as an estimate: one weekly circle of 10 members serves 10 people a week, with 9 payments and a payout each round, or 468 payments a year. A first pilot of 10 circles in one market would serve 100 members and 90 payments a week.

## What it does

Ajo on Lightning removes the pot. Each round, every member's own wallet pays that round's payee directly over the Lightning Network. The app never holds a satoshi. It asks each wallet to pay, checks the proof, and shows the whole circle who has paid.

- A member joins with two Nostr Wallet Connect links from their own wallet. The pay link can only pay, up to a limit that the wallet enforces and that renews each week or month. The receive link can only create invoices, so it cannot spend. Ajo checks both links and refuses one that can do more than its job.
- Each payment uses a hold invoice. The payee's wallet holds the sats until Ajo releases them with a secret only Ajo keeps. A late payment is never released, so a member shown as not paid is never charged.
- Checking unpaid payments never mints a new invoice, so no member pays twice.
- Each payment gets a receipt on Nostr, signed by the circle's key, with no names in it.
- The round page shows each member as Paid, Waiting or Not paid with a plain reason, such as "over your limit".
- Each unpaid member gets a reminder in the circle's language (English, Nigerian Pidgin, Yoruba, French or Wolof), written by Claude Haiku and ready to copy into WhatsApp.

## How we built it

- **Bitcoin.** Bitcoin Core 28.1 on regtest. A seed container funds each member's node on chain and opens a channel from each member to a router node.
- **Lightning.** Each member runs a self-custodial Alby Hub v1.24.6 on LDK. Payments route from the payer through the router to the payee for a 1 sat fee.
- **Nostr.** Every wallet request is a NIP-47 Nostr Wallet Connect event, encrypted end to end and carried by a Nostr relay. Receipts are signed Nostr events that anyone can fetch and check.
- **The wallet implementation.** Ajo is an NWC client. It calls `get_info` and `get_budget` at join, `make_hold_invoice`, `lookup_invoice`, `settle_hold_invoice` and `cancel_hold_invoice` on the payee's receive link, and `pay_invoice` on each payer's pay link. A member never hands Ajo a seed phrase or a private key, and the wallet's own limit caps what a compromised server could spend.
- **AI.** Claude Haiku (`claude-haiku-5-5`) writes each reminder. It sees only the language, the seat number, the amount and the due date, never a name, phone number or wallet link. The server adds the member's name afterwards. Without a key, or after 3.5 seconds, the page shows a fixed template, so a page never waits on the model.
- **The app.** TypeScript on Node.js, with Hono server-rendered pages under 14 KB each, SQLite with AES-256-GCM sealing for names, links and hold secrets, and a scrypt-hashed circle passcode with a rate limit.
- **Design first.** Before writing the round logic we modelled its retry rules in TLA+. The fixed design holds five safety rules and liveness over 7,280,499 states. The model showed that a naive retry can mark a paid member as failed, and that minting a new invoice on retry can charge a member twice in 11 steps.
- **One command.** `docker compose up` starts bitcoind, a relay, a router and five member hubs, seeds them, and serves the pages. `scripts/e2e` checks the payee's balance, every receipt, a rerun that moves no money, and a partly paid round.
- **How the work was done.** The code, tests and docs were written with Claude Code. Agents built each pull request, and independent agents checked it on the live regtest stack before it merged.

## Challenges we ran into

- **"Failed" was not final.** Alby Hub on LDK accepted a payment after our runner had already marked it expired, so a member shown as failed could still be charged. Hold invoices fixed it: Ajo only releases a payment it has counted as paid, and cancels the rest.
- **Retries could double-charge.** Minting a fresh invoice on retry looked harmless until the TLA+ model found an 11-step path that charges a member twice. Every retry now looks up and reuses the stored invoice.
- **A flaky first request.** The end-to-end test failed about half the time because a wallet connection's first NWC request sometimes got no reply when sent alongside others. The first request now goes out alone.
- **Limits need room for fees.** A pay link capped at exactly the contribution passes join, then fails every round, because the wallet also reserves a routing fee. Join now asks for the contribution plus that fee.

## Accomplishments that we're proud of

- Real Lightning payments between six real nodes, started by one command, with no custodian in the middle.
- A member shown as not paid is never charged, and the end-to-end test checks this against each hub's balance.
- Pages small and clear enough for a mid-range phone on a weak connection, with amounts in naira and reminders in five languages.

## What we learned

- A model checker earns its place even in a hackathon. It found the double-charge before we wrote the code.
- Wallet limits are the strongest safety control we have. They live in the member's wallet, not in our server.
- Expiry has to be decided by the party that holds the money. On Lightning that means hold invoices.

## What's next for Ajo on Lightning

- Run real hubs on mainnet for a small pilot circle, and let members join from mobile wallets that support NWC.
- Ask Alby Hub upstream to refund a payment that arrives after a cancel at once, and to offer hold invoices as their own permission.
- Host the pages with TLS, a persistent passcode counter and many circles per server.
- Collect each round on its due date without a button press.

---

## Built with

Add these as separate tags:

typescript, node.js, hono, sqlite, bitcoin, bitcoin-core, lightning-network, alby-hub, ldk, nostr, nostr-wallet-connect, nostr-tools, alby-js-sdk, hold-invoices, anthropic, claude, claude-haiku, claude-code, tla+, docker, docker-compose

## "Try it out" links

- <https://github.com/mohammedfirdouss/ajo-lightning>
- <https://github.com/mohammedfirdouss/ajo-lightning#run-the-demo>

## Image gallery

Upload the 3:2 images from the submission folder, in order: the cover, the round, the refusals and reminders, then the architecture.

## Video demo link

The YouTube or Vimeo link to `docs/media/demo.mp4` (2:57).

## Upload a file

A zip of the source at the submitted commit.
