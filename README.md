# Ajo on Lightning

A rotating savings circle (ajo, esusu, tontine) where members pay each other directly over Bitcoin Lightning. The app never holds a pot.

Built for the [Dakar Bitcoin Hack 2026](https://dakar-bitcoin-hack-2026.devpost.com/). Work in progress.

## Reminders

`scripts/remind` prints a payment reminder for one member in English (`en`), Nigerian Pidgin (`pcm`), Yoruba (`yo`), French (`fr`), or Wolof (`wo`). Run `npm ci` once first.

```sh
scripts/remind --lang fr --amount 4000 --due 2026-11-12 --member 3
```

`ANTHROPIC_API_KEY` is optional. With a key, Claude Haiku 5.5 (`claude-haiku-5-5`) writes the message and sees only the language, the seat label, the amount, and the due date. Without a key, or when the call fails or takes longer than 3.5 seconds, the script prints a fixed template. A bad argument prints the usage line and exits 2. The Yoruba and Wolof templates still need a check by a native speaker.
