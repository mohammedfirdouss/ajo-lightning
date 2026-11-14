# Devpost submission

The text below is for the Dakar Bitcoin Hack 2026 submission form. Each heading matches a field.

## Name

Ajo on Lightning

## Tagline

A savings circle where every member pays the payee straight from their own wallet, so nobody holds the pot.

## The problem

In Nigeria people call it ajo or esusu. In Senegal and across francophone West Africa it is a tontine. A group of traders, colleagues or neighbours agree on an amount. Each week or month every member pays it in, and one member takes the whole pot, in turn, until everyone has had a payout.

The circle runs on trust in one person, the collector who holds the pot. If the collector disappears, spends the pot or favours a friend, the members lose their savings and have little recourse. Members also cannot see who has paid until the collector tells them. Cash needs meetings, and bank transfers cost fees and wait on banking hours.

## The solution

Ajo on Lightning removes the pot. Each round, every member's own wallet pays that round's payee directly over the Lightning Network. The app never holds a satoshi. It asks each wallet to pay, checks the proof, and shows the whole circle who has paid.

- A member joins with two Nostr Wallet Connect links from their own wallet. The pay link can only pay, up to a limit that the wallet enforces and that renews each week or month. The receive link can only create invoices, so it cannot spend.
- Each payment uses a hold invoice. The payee's wallet holds the sats until Ajo releases them with a secret that only Ajo keeps. A late payment is never released, so a member shown as not paid is never charged.
- A rerun of a round checks unpaid payments and never mints a new invoice, so no member pays twice.
- Each payment gets a receipt on Nostr, signed by the circle's key, with no names in it.
- The round page shows each member as Paid, Waiting or Not paid with a plain reason, such as "over your limit".
- Each unpaid member gets a reminder in the circle's language, ready to copy into WhatsApp.

## How we use Bitcoin, Lightning, Nostr and AI

- **Bitcoin.** The demo runs Bitcoin Core 28.1 on regtest. The seed funds each member's node on chain and opens a channel from each member to a router node.
- **Lightning.** Each member runs Alby Hub v1.24.6 on LDK. Payments route from the payer through the router to the payee, for a routing fee of 1 sat. Hold invoices make expiry final.
- **Nostr.** Every wallet request is a NIP-47 Nostr Wallet Connect event, encrypted end to end between Ajo and the wallet, and carried by a Nostr relay. Receipts are signed Nostr events that anyone can fetch from the relay and check.
- **AI.** With an Anthropic API key, Claude Haiku writes each payment reminder in English, Nigerian Pidgin, Yoruba, French or Wolof. The model sees only the language, the seat number, the amount and the due date, never a name or a phone number. The page puts the member's name in afterwards, on the server. Without a key, or if the call takes longer than 3.5 seconds, the page shows a fixed template.

## The wallet implementation

Ajo is a Nostr Wallet Connect client, and each member's wallet is their own self-custodial Alby Hub. Ajo uses these NWC methods:

- `get_info` and `get_budget` at join, to check what each link may do and how much its limit has left.
- `make_hold_invoice`, `lookup_invoice`, `settle_hold_invoice` and `cancel_hold_invoice` on the payee's receive link.
- `pay_invoice` on each payer's pay link.

A member never hands Ajo a seed phrase or a private key. The wallet's limit caps what a compromised Ajo server could spend.

## Security by design

- The core of a round is a pure state machine. Before we wrote it, we checked its retry rules in TLA+. The fixed design holds five rules and liveness over 7,280,499 states. A naive retry can show a paid member as failed, and minting a new invoice on retry can charge a member twice in 11 steps.
- The store seals member names, NWC links and hold secrets with AES-256-GCM. The circle passcode is kept only as a salted scrypt hash, and five wrong tries lock that address out for 15 minutes.
- Every page sends a strict content security policy, and the stack binds only to `127.0.0.1`.

The full list, with the evidence for each control, is in `docs/threat-model.md`.

## Who it's for

The primary user is the circle organiser, often the woman who already runs a market traders' ajo or tontine, with 5 to 20 members. Today she collects cash or transfers, holds the pot, chases late payers and vouches for who paid. With Ajo on Lightning she presses one button: each member's own wallet pays the payee directly, she holds nothing, each row shows who paid and why a payment failed, a reminder copies into the WhatsApp group, and every payment has a signed Nostr receipt.

Reach, as an estimate: one weekly circle of 10 members serves 10 people a week, with 9 payments and a payout each round, or 468 payments a year. A first pilot of 10 circles in one market would serve 100 members and 90 payments a week.

## Impact for Nigeria and Senegal

Market traders, artisans and salaried workers in Nigeria and Senegal already save in rotating circles. Ajo on Lightning keeps the habit and removes the single point of failure. A trader in Lagos or Dakar keeps their own sats until the moment they pay, and every member sees each payment land. Payments cost about 1 sat in routing fees and settle in seconds at any hour.

The pages suit the phones people carry. Each page is under 14 KB in one request, with no images or web fonts to fetch. The amounts show in sats and in naira. Reminders come in the languages circles use, and they paste straight into the WhatsApp group where the circle already talks.

## How to run it

You need Docker. Run `docker compose up` in the repo, wait for `seed done`, and open `http://127.0.0.1:8000`. The README walks through a full round with five demo wallets.

## What's next

- Run real hubs on mainnet, starting with a small pilot circle, and let members join from mobile wallets that support NWC.
- Ask Alby Hub upstream for two changes. It should refund a payment that arrives after a cancel at once, instead of holding it until the claim deadline. It should also offer hold invoices as their own permission, separate from "create invoices".
- Host the pages for real circles, with a persistent passcode counter and more than one circle per server.
- Collect rounds on a schedule, instead of when the organiser presses the button.

## Built with

TypeScript, Node.js, Hono, SQLite, Alby Hub, LDK, Bitcoin Core, Nostr, nostr-tools, the Alby JS SDK, the Anthropic SDK, Claude Haiku, TLA+, Docker Compose.

The code, tests and docs were written with Claude Code: agents built each pull request and independent agents checked it on the live regtest stack before it merged.
