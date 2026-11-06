# Ajo on Lightning threat model

This page lists what Ajo on Lightning protects, who could attack it, and each control with the test, code or run that proves it. It covers the code on `main` and the demo stack that `docker compose up` starts. Each "Evidence" cell names a file and a symbol or test title, so you can find it with `grep`.

## Assets

- Members' sats. Each member's wallet holds them. Ajo never holds a pot.
- The pay links. A pay link can spend from a member's wallet, up to the limit the wallet enforces.
- The receive links. A receive link can create, settle and cancel invoices on the payee's wallet, and it cannot pay.
- The hold preimages. Whoever has a payer's preimage can settle a held payment.
- The record of who paid. A member shown as paid who did not pay, or shown as not paid who did, breaks the circle's trust.
- Members' names, and the circle passcode.

## Actors

- A member who wants to skip a payment, or to be paid twice.
- The round's payee, who controls the wallet behind their receive link.
- Someone outside the circle who can reach the pages.
- Someone who gets a copy of the database file.
- A wallet or relay that drops, delays or repeats messages. This actor is not hostile, and it causes most failures.
- The reminder model, which sees what the page sends it.

## Trust boundaries

1. Phone to `web`. HTTP on `127.0.0.1`. The passcode guards joining and collecting.
2. `web` to the wallets. NWC requests travel as encrypted Nostr events through the relay. Ajo trusts a wallet's word only where it costs that wallet's owner, as the controls below show.
3. `web` to the state volume. The database holds sealed member records and preimages. The key lives in `.env` or `keys.env`, outside the database.
4. `web` to the Claude API, only when `ANTHROPIC_API_KEY` is set.

## Controls

| Threat | Control | Evidence |
| --- | --- | --- |
| A retry charges a member twice. | The runner reuses the stored invoice, and it looks the invoice up before any retry. It saves `paySent` before it calls `pay_invoice`, so a crash leads to a lookup, never a blind second pay. | `model/README.md`, `fixed.cfg` holds `NoPayerChargedTwice` over 7,280,499 states. `test/round/round-props.test.ts`, the five model rules over 1000 random runs. `test/runner/run-round.test.ts`, "a run killed mid-pay resumes by looking up every open invoice". |
| A member who paid shows as failed. | A payment is final only when the runner sends the preimage, and only the runner has it. An invoice that expires unheld is cancelled and never settled. | `model/README.md`, `naive.cfg` shows the break this design avoids. `test/runner/run-round.test.ts`, "a payment that reaches the payee's hub after the runner failed it is never settled". |
| A member shown as not paid is charged. | The same hold rule. A rerun cancels the expired invoices again and mints nothing. | `test/runner/run-round.test.ts`, "a payment the payee's hub took while it missed the cancel is refunded by the rerun's cancel" and "a rerun of a partial round cancels its failed invoices again". `scripts/e2e`, check 4, a rerun of a complete round mints no invoice and moves no balance. |
| A wallet claims a payment it did not make. | A pay reply counts only with a preimage that hashes to the invoice. | `src/round/round.ts`, `proves`. `test/round/round.test.ts`, "a pay reply without a preimage that hashes to the invoice is not proof". |
| The payee asks for the wrong amount or reuses another payer's hash. | The runner rejects an invoice whose hash is not its own or whose amount is not the contribution. | `src/wallet/nwc.ts`, `parseInvoice`. `test/round/round.test.ts`, "an invoice for any amount but the contribution is rejected" and "an invoice whose payment hash another payer holds is rejected". |
| Ajo spends more than a member agreed. | The pay link's limit lives in the member's wallet, which refuses with `QUOTA_EXCEEDED` (mapped in `src/wallet/nwc.ts` and `src/web/copy.ts`). At join, Ajo refuses a pay link with no limit, a limit that renews less often than the circle pays, or less than the contribution plus the routing fee unused. | `src/web/nwc-source.ts`, `checkLinks`. `test/web/nwc-source.test.ts`, "link checks want a renewing pay limit with room for the contribution and its routing fee". `docs/media/round-partial.png`. |
| A receive link is used to spend. | Ajo refuses a receive link that has `pay_invoice`, and a pay link that can make invoices. | `test/web/nwc-source.test.ts`, "link checks refuse a receive link that can pay, a pay link that can invoice". |
| An outsider joins or starts a round. | Joining and collecting need the passcode. The store keeps only a salted scrypt hash of it. After five wrong tries from one address, that address waits 15 minutes. | `src/web/passcode.ts`, `lock` and `limiter`. `test/web/server.test.ts`, "joining and collecting need the circle's passcode" and "after five wrong passcodes even the right one waits out the window". |
| A stolen database file leaks names or links. | Member records, the circle and the preimages are sealed with AES-256-GCM under `AJO_SECRET_KEY`. The file is mode 0600. | `src/store/sqlite.ts`, `seal` and `openStore`. `test/adapters/store.test.ts`, "the database file holds no member name and no NWC secret in plain text". |
| A pasted link shows up again on a page or in a log. | Link fields are password inputs. An error message never echoes what was pasted. The container logs pseudonyms, never names. | `test/web/server.test.ts`, "a bad link is refused with a plain message that never echoes what was pasted". `src/run-round.ts`, `withNames`. |
| A receipt reveals who paid. | A receipt holds the round, a pseudonym, the amount and the payment hash, and the circle's key signs it. | `test/adapters/receipts.test.ts`, "a receipt carries only the round, pseudonymous payer, amount, and payment hash". |
| Injected script on a page. | Every page sends a content security policy of `self` plus the hashes of its one inline stylesheet and script. | `test/web/server.test.ts`, "pages carry a policy of self only". A live run at this commit saw Chromium refuse an injected style tag with that policy. |
| The reminder model sees personal data. | The request holds the language, the seat number, the amount and the due date, and no name or phone number. The page adds the name after the reply, on the server. | `test/reminders/reminders.test.ts`, "the request body holds no member name or phone number". |
| A stranger on the network reaches the stack. | Every published port binds to `127.0.0.1`. bitcoind publishes no port. | `docker-compose.yml`, each `ports:` line. |

## Notes on specific cases

### A payee who lies "settled"

The runner accepts the payee's hub reporting an invoice settled as proof of payment, without a preimage. A payee whose wallet lies "settled" marks a payer as paid who did not pay. The payee then loses that contribution, and the payer keeps their sats. Only the liar loses. Evidence is `test/round/round.test.ts`, "the payee's lookup reporting settled is proof without a preimage".

### Payment hashes across rounds

Each round and payer gets a new random 32-byte preimage, sealed in the store, so no payment hash repeats in another round. The `invoices` table keys on the payment hash, so the store refuses to save a second invoice with a hash it has seen, before any wallet is asked to pay. The preimage is random rather than derived from `AJO_SECRET_KEY`. `.env` survives `docker compose down -v`, so a derived preimage would repeat hashes on a fresh stack that a real wallet had already seen. Evidence is `src/store/sqlite.ts`, `holdPreimage` and the `invoices` table, and `scripts/e2e` check 3, which fails when two payers share a hash.

### A late payment after a cancel

Alby Hub v1.24.6 on LDK does not refuse a payment that arrives after a successful cancel. It holds the payment until the hub's claim deadline, about 124 blocks on this stack, and then fails it back. The runner never settles it, so nobody is charged. The payer's sats stay locked in flight until that block height. On this stack only the seed mines blocks, so such a payment stays locked until someone mines past that height. On a real network, 124 blocks take about 21 hours at one block every 10 minutes. Evidence is the verification notes in [PR #7](https://github.com/mohammedfirdouss/ajo-lightning/pull/7).

### The passcode limit behind one address

The wrong-passcode counter lives in the `web` process memory and counts per client address. A restart of `web` clears it. Every browser behind one address shares one counter. On `127.0.0.1` that is only the people on this machine, which is fine for the demo. On a hosted server behind a proxy or a carrier NAT, five wrong tries from one person would lock out everyone who shares their address for 15 minutes, and a restart would give an attacker fresh tries. A hosted circle needs a persistent counter keyed on something better than the address.

## Honest limits

- The demo runs on regtest. Its secrets are fixed constants in `docker-compose.yml`: the bitcoind RPC user and password are both `ajo`, and the hub unlock password is `ajo-regtest-only`. Anyone on the machine can open a hub at `127.0.0.1` and unlock it. These coins have no value. Never reuse these values on a real network.
- The `web` process holds every member's pay link. Someone who takes over the host gets the links and the key that seals them, and can spend up to each member's limit each period. The wallet's limit caps that loss, and it is the reason Ajo insists on one.
- The router keeps the 50,000 sat that each member pays it during the seed. That payment buys inbound liquidity, so the router can forward payments to every member. On a real network a member would buy that from a Lightning service provider or open a channel that someone else funds.
- One stack runs one circle. The pages cannot remove a member or start a second circle.
- The naira amounts use a fixed demo rate, not a live price.

## Findings from review

No `interrogate` pass has run over this code. These findings came from the live verification lanes recorded in the pull requests, and each one changed the code.

- LDK accepted a payment after its invoice expired on an idle regtest, so a member shown as failed could still be charged. Hold invoices fixed it, in [PR #7](https://github.com/mohammedfirdouss/ajo-lightning/pull/7).
- When several requests ran at once on a fresh NWC client, about one in ten was never sent. `connect` now sends a client's first request alone, in PR #7. Evidence is `test/adapters/nwc.test.ts`, "a client's first request runs alone".
- A paused payee hub stretched a run past its budget. Every wallet call now waits at most the time left in the run's 100 second budget, in PR #7.
- The passcode counter is shared by every browser behind one address, from [PR #6](https://github.com/mohammedfirdouss/ajo-lightning/pull/6). It stays open, as the note above explains.
