# Join a circle with a pay link and a receive link

The join page at `/join` takes a name, the circle passcode, a pay NWC link and a receive NWC link, pasted or scanned from a QR code. Ajo asks each wallet what its link may do before the member joins. Both link fields mask what is typed, and no page, error or log shows a link again.

## Sub-features

- A link must be a whole `nostr+walletconnect://` link with a 64-hex wallet key, a relay and a 64-hex secret.
- The pay link and the receive link must differ.
- Ajo calls NWC `get_info` on each link, and `get_budget` on the pay link. It refuses a wallet that does not answer, a receive link whose methods include `pay_invoice`, a receive link without `make_hold_invoice`, `settle_hold_invoice`, `cancel_hold_invoice` and `lookup_invoice`, and a pay link whose methods include `make_invoice`. Swapped links fail as "Your receive link can spend money".
- The pay link needs a limit that renews and has at least the contribution plus max(1%, 10 sat) unused, 1010 sat for a 1000 sat contribution. A limit that never renews, a limit under that amount, and a limit already spent this period are each refused with the amount named. After round 1 on the stack, each seeded pay link has 9 sat left, so it is refused with "has 9 sat left of its limit".
- A link whose relay refuses the connection fails in about 0.2 seconds. A wrong wallet key or secret fails after about 10 seconds, when the SDK gives up.
- A link or a name that already belongs to a member is refused.
- A wrong passcode is refused with status 403. After five wrong tries from one address, every try from it gets 429 for 15 minutes.
- On the stack, the page also offers the seeded wallets as "Demo wallet 1" to "Demo wallet 5". They go through the same checks as pasted links.
- A refused join keeps the name and asks for both links again, with status 422.
- "Scan a QR code" shows only in browsers with `BarcodeDetector`, such as Chrome on Android.
- The circle closes to new members once round 1 has started.

## How to get to it (user POV)

On the circle page, press "Join this circle", type a name, paste both links from the wallet, and press "Join".

## Driving it with scripts and the hub API

Start the server per [web-circle.md](web-circle.md). On the live stack, take real links from `$RUN/connections.json` (`.members[i].pay.uri` and `.members[i].receive.uri`) and fill them with `getByLabel("Pay link from your wallet")` and `getByLabel("Receive link from your wallet")`. To pick a seeded wallet, use `locator('select[name="demo"]')` and `getByRole("button", { name: "Join with the demo wallet" })`. The fake source checks only the link format and then ignores both links.

## Gotchas

- Screenshot the form only after filling, since the fields are masked.
- The wrong-passcode limit counts per address. Behind Docker's port mapping every host browser shares one address, so five wrong tries in a lane lock out the rest of that lane for 15 minutes. Run that check last. Never write a link into `$EVIDENCE`.
- The pay hint asks for a limit that renews as often as the circle pays, weekly or monthly, and names the amount, such as "at least 1,010 sat".
- The real source shows the limit the wallet reported. The fake gives every member a limit of contribution plus max(1%, 10 sat), the same budget the seed sets.
