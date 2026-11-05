# Read the receipts for paid contributions

The receipts page at `/receipts` lists every paid contribution by round, with the member's id, the amount and the payment hash. It shows the circle's Nostr key and relay, so anyone can check each receipt on the relay.

## Sub-features

- Only paid contributions appear. A failed one has no receipt.
- Names show on this page for the circle's members. The receipts on the relay carry the member id, never the name.

## How to get to it (user POV)

After a round, tap "See the receipts" on the round page or the circle page.

## Driving it with scripts and the hub API

Start the server per [web-circle.md](web-circle.md) and collect a round. Each `.receipts li` holds one payment hash in a `code` element. On the live stack, compare each hash with the payee hub's `/api/transactions/<hash>`.

## Gotchas

- The fake source makes up the circle key and publishes nothing to the relay.
