# Ajo on Lightning

A rotating savings circle (ajo, esusu, tontine) where members pay each other directly over Bitcoin Lightning. The app never holds a pot.

Built for the [Dakar Bitcoin Hack 2026](https://dakar-bitcoin-hack-2026.devpost.com/). Work in progress.

## Keys

`node src/run-round.ts <round>` writes `AJO_SECRET_KEY` and `AJO_CIRCLE_KEY` to `.env` on its first run. `AJO_SECRET_KEY` seals member names and NWC secrets in the stack's database, so keep `.env`. An `AJO_SECRET_KEY` exported in your shell overrides the one in `.env`. If the runner says the database was sealed with a different key, restore the original `.env` and unset any exported key, or run `docker compose down -v` to start fresh.
