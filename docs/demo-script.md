# Demo script

The demo takes 3 minutes. It runs on a fresh demo stack with five demo wallets, in a phone-sized browser at `http://127.0.0.1:8000`. The spoken lines come to about 400 words, which fit in 3 minutes at a steady pace.

## Before you record

1. Run `docker compose down -v`, then `docker compose up`, and wait for `seed done` in the log.
2. Open `http://127.0.0.1:8000` in a browser window 360 pixels wide.
3. Have a second terminal ready in the repo root, with `npm ci` already run.

## Problem, 0:00 to 0:40

**Screen.** The start page, "Start a savings circle".

**Say.** "Across West Africa, people save in rotating circles. In Nigeria it is ajo or esusu. In Senegal it is a tontine. Each week every member puts in the same amount, and one member takes the whole pot. The circle works only if everyone trusts the person who holds the pot. When that person disappears, the savings go with them. Moving money to the pot also costs fees and time, and members cannot see who has paid."

## Solution, 0:40 to 2:00

**Screen.** Fill the form. Name the circle, keep 1000 sat, choose **Every week**, type a passcode, and press **Start the circle**.

**Say.** "Ajo on Lightning removes the pot. Each member pays the round's payee directly, from their own wallet, over Bitcoin's Lightning Network."

**Screen.** Press **Join this circle**. Type the name Ada and the passcode, pick demo wallet 1, and press **Join with the demo wallet**. Join Chidi, Fatou, Moussa and Ngozi the same way, with demo wallets 2 to 5.

**Say.** "A member joins with two Nostr Wallet Connect links from their own wallet. One can only pay, up to a weekly limit that the wallet itself enforces. The other can only create invoices. Ajo checks both links and refuses one that can do more than its job. On this stack, each member runs a real Alby Hub Lightning node."

**Screen.** Open round 1, type the passcode, and press **Collect this round**. Each row turns to Paid.

**Say.** "Round 1 pays Ada. Each payment uses a hold invoice. Ada's wallet holds the sats until Ajo releases them with a secret that only Ajo has. If a payment is late, Ajo never releases it, so the member is never charged for a payment shown as failed. Each rerun checks unpaid payments and never mints a new invoice, so nobody pays twice. We checked the retry rules in TLA+ over seven million states before we wrote the code."

**Screen.** Go back to the circle page, open round 2, type the passcode, and press **Collect this round**. Round 2 needs about 30 seconds, so leave it, go back to the circle page and open **See the receipts**.

**Say.** "Each payment gets a receipt on Nostr, signed by the circle's key, with no names. Anyone can check them."

## Impact, 2:00 to 2:35

**Screen.** Open round 2 again. It is partly paid. Show a red row with its reminder and the **Copy for WhatsApp** button.

**Say.** "Round 2 comes in the same week, so three members are over their weekly limit. Their wallets refused, and no money moved. Each row says so in plain words, and Ajo shows a reminder to paste into WhatsApp, in English, Pidgin, Yoruba, French or Wolof. With an API key, Claude Haiku writes that reminder; it sees only the language, the seat and the amount, never a name or a wallet link. Each page is under 14 kilobytes, so it loads on a mid-range phone on a weak connection. A market trader in Lagos or Dakar keeps their own sats, and the circle keeps its trust without a pot-holder."

## Next steps, 2:35 to 3:00

**Screen.** The architecture diagram in `docs/architecture.md`.

**Say.** "Next, we move from regtest to real hubs on mainnet, and let members join from mobile wallets that support NWC. We also want Alby Hub to refund a late payment at once after a cancel, instead of at its claim deadline. Everything you saw runs with one command, docker compose up."
