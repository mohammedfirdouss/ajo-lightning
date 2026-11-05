# Join a circle with a pay link and a receive link

The join page at `/join` takes a name, a pay NWC link and a receive NWC link, pasted or scanned from a QR code. Both link fields mask what is typed, and no page, error or log shows a link again.

## Sub-features

- A link must be a whole `nostr+walletconnect://` link with a 64-hex wallet key, a relay and a 64-hex secret.
- The pay link and the receive link must differ.
- A refused join keeps the name and asks for both links again, with status 422.
- "Scan a QR code" shows only in browsers with `BarcodeDetector`, such as Chrome on Android.
- The circle closes to new members once round 1 has started.

## How to get to it (user POV)

On the circle page, press "Join this circle", type a name, paste both links from the wallet, and press "Join".

## Driving it with scripts and the hub API

Start the server per [web-circle.md](web-circle.md). On the live stack, take real links from `$RUN/connections.json` (`.members[i].pay.uri` and `.members[i].receive.uri`) and fill them with `getByLabel("Pay link from your wallet")` and `getByLabel("Receive link from your wallet")`. The fake source checks only the link format.

## Gotchas

- Screenshot the form only after filling, since the fields are masked. Never write a link into `$EVIDENCE`.
- The fake gives every member a limit of contribution plus max(1%, 10 sat), the same budget the seed sets.
