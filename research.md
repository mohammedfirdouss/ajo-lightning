# Dakar Bitcoin Hack 2026: event facts and wallet stack research

Researched 2026-11-05 from primary sources only: Devpost event pages, GitHub repos/READMEs, npm/JSR registries, specs, and first-party docs. Version numbers come from GitHub releases or the npm registry on that date. Anything not verified is marked **unverified**.

## TL;DR

- **The event is the "Dakar Bitcoin Hack by BTrust"** on Devpost. It is run by Dakar Bitcoin Days, with BTrust listed as sponsor. It is online. Submissions are due **2026-11-20 20:00 UTC**, which leaves 15 days. The focus is "tools that will enhance the life of African people". [D1]
- **Eligibility:** the rules page says you must reside in Africa, so Nigeria qualifies. The Devpost sidebar also shows a **"Students only"** tag that the rules text never mentions. Ask the organisers about it before you invest time. [D1][D2]
- **Prizes are small:** 500k, 250k and 100k sats according to the rules, or $500/$250/$150 in BTC according to the overview page. The two pages disagree. Public voting runs from 9 to 24 November, so building in public and sharing early counts. [D1][D2][D4]
- **The rules say nothing about team size, licence, or mainnet versus testnet.** You must provide a public GitHub repo, a presentation, and an MVP reachable online *or* a demo video. The judging text also asks for one-command Docker, seed data and a testable happy path. [D1][D2]
- **Recommended wallet layer: Nostr Wallet Connect (NIP-47) through `@getalby/sdk` v9.0.0.** Each app gets a connection limited to specific methods, with a budget and an expiry. That gives you a concrete, explainable answer to "least privilege" and "safe secrets". [S1][S2][S3][A2]
- **Recommended demo backend:** one `docker compose up` that starts regtest `bitcoind`, two LND nodes, and either **Alby Hub** (a self-custodial NWC wallet service, Apache-2.0, Docker image) or **LNbits** (MIT, per-wallet API keys). A seed script then mines blocks and opens a channel. Use Polar only on your own machine during development, because it is a desktop GUI. [A1][L1][P1]
- **Avoid two Breez variants:** the Breez SDK Greenlight is officially **deprecated**, and Breez tells new builders to use Spark instead of Liquid. Breez SDK **Spark** (MIT, React Native and WASM, non-custodial) is the best choice if you need a self-contained mobile wallet, but it requires a free API key and its regtest option may only point at a hosted network (unverified). [B1][B2][B3][B4]
- **Africa fit:** Machankura already serves Nigeria over USSD at `*347*8333#`. It is *fully custodial*, but it can receive payments via `user@8333.mobi` Lightning addresses. Bitnob has a sandbox API offering Bitcoin/Lightning and NGN virtual accounts. Both show "local need" without you building telco integrations. [M1][M2][N1]

## Hackathon facts

| Item | Value | Source |
|---|---|---|
| Name | Dakar Bitcoin Hack by BTrust (Devpost id 26475) | [D1], [D5] |
| Organiser | Dakar Bitcoin Days (Devpost organisation). BTrust (btrust.tech) is linked as sponsor. Organisers are volunteers. | [D1], [D5] |
| Focus | "Create tools that will enhance the life of African people, around or on top of the Bitcoin protocol, the lightning network, nostr and AI". Solutions should "answer local and regional population needs". | [D1] |
| Eligibility | Rules: "participants should reside in Africa". Sidebar: above age of majority, **"Students only"**, companies excluded. | [D2], [D1] |
| Format | 100% online, public, non-profit, 100+ participants (166 registered on 2026-11-05) | [D1], [D5] |
| Dates | Submissions open 2026-10-26 08:00 UTC and close **2026-11-20 20:00 UTC** | [D4] |
| Public voting | 2026-11-09 09:00 UTC to 2026-11-24 17:00 UTC | [D4] |
| Judging / winners | Judging runs 21 to 26 November. Winners are announced 2026-11-28 17:00 UTC. | [D4] |
| Prizes | Rules: 1st 500,000 sats, 2nd 250,000 sats, 3rd 100,000 sats. Overview: $500, $250 and $150 "of BTC" ($900 total). | [D2], [D1] |
| Judges listed | Mouhamadou Kouta (Banxaas) | [D1] |
| Required submission | Rules: a presentation (text or video), a **public GitHub repo**, and an MVP reachable through the internet *or* a demo video. Overview: a presentation, an MVP/PoC, and "at least a bitcoin/lightning wallet implementation". | [D2], [D1] |
| Judging criteria | Usefulness & Local Impact; Security by Design; UX/UI Quality on low bandwidth and mid-range phones; Working MVP (one-command Docker or script, seed data, happy path, "avoid mockups"); Clear Pitch & Docs (3-minute demo, README with architecture diagram, metrics, next iteration). The rules also mention originality and technicality. | [D1], [D2] |
| Example project types | Wallets, learning tools, exchanges, Bitcoin Core/Lightning contributions, a Nostr messaging app, "an authentication method using NWC", Bitcoin & AI | [D1] |
| Suggested tools | Bitcoin Core, BDK, BTCPay Server, Electrum server, LDK, Fulcrum, LND ("Lightning Core"), C-Lightning, **USSD**, LNURLPoS, mempool.space, **Mobile Money APIs**, Sparrow, Nostr, **NWC**, AI | [D3] |
| Tracks | None. There is a single open category. | [D1] |
| Team size | **Not stated** | [D1], [D2] |
| Licence | **Not stated.** The event says "results are open-source" and requires a public repo, but names no licence. | [D1], [D2] |
| Mainnet vs testnet | **Not stated** | [D1], [D2], [D3] |
| Channels | Discord `discord.com/invite/HP4BhW3hnp` (another link, `discord.gg/tyS2Mt7C`, also appears), Telegram `t.me/+QArsWD3suKE2Yjg0`, X `@dakarbtcdays` | [D1], [D3] |
| Updates page | Empty on 2026-11-05 | [D6] |

**Open questions to ask in Discord or by email:**
1. Does "Students only" apply, or is it a leftover Devpost default? The rules mention only African residency.
2. Which prize amounts apply: 500k/250k/100k sats or $500/$250/$150?
3. Are there team size limits? Are solo entries allowed?
4. Is a testnet, signet or regtest demo acceptable, or do judges expect mainnet?
5. Does "wallet implementation" mean the app must hold keys itself, or does connecting to a wallet over NWC count?
6. Is a particular OSS licence required? (Default to MIT or Apache-2.0.)

## Stack comparison

| Option | Status / version (2026-11-05) | Licence | Platforms | Local demo networks | Custody model |
|---|---|---|---|---|---|
| **NWC (NIP-47)** | Spec is `draft` `optional`. Core lives in NIP-47. Extensions (budgets `get_budget`, notifications, 1-click connect with `max_amount`/`renewal_period`/`request_methods`/`expires_at`/`isolated`) are in the nostr-wallet-connect/nwc repo. [S1][S2][S3] | Public spec | Any client with Nostr relay access (web, RN, server) | Network-agnostic: it is a transport, and the wallet service decides the network. Needs a relay. [S1] | The app holds a per-connection secret, never wallet keys. Each key can be revoked and "have arbitrary constraints (eg. budgets)". Errors include `QUOTA_EXCEEDED` and `RESTRICTED`. NIP-44 is required and NIP-04 is deprecated. [S1] |
| **Alby JS SDK** (`@getalby/sdk`) | v9.0.0, released 2026-10-27 [A2][R] | MIT [R] | Browser, Node 22+, React Native/Expo (official demo app) [A2][A3] | Whatever the connected wallet uses [A2] | "Zero-custody": a client for NWC and the Alby Wallet API. `fromAuthorizationUrl` with `requestMethods` supports one-click least-privilege setup. [A2][A3] |
| **Bitcoin Connect** | v3.12.3 on npm. The README still says **"Alpha"**. [A4][R] | MIT | Web components plus a React wrapper. Works with any framework and in PWAs. [A4] | Wallet-dependent | A UI that connects the user's own wallet (WebLN/NWC). The app does not hold funds. [A4] |
| **Alby Hub** | v1.24.6, released 2026-11-05. Actively maintained. [A1][R] | Apache-2.0 | Docker (`ghcr.io/getalby/hub`), Linux, Mac arm64, Windows desktop [A1] | Regtest (documented with Polar LND or a Boltz regtest setup), **Mutinynet** (signet), signet, mainnet [A1] | Self-custodial: the embedded LDK node runs on your own machine. It can also front LND, CLN, Phoenixd or Cashu. It acts as an NWC wallet service with per-app connections. [A1] |
| **LNbits** | v1.6.2, released 2026-09-18 [R] | MIT | Python server with web UI and REST API. Docker image `lnbits/lnbits`. [L1][L2] | Any funding source: LND/CLN on regtest, `FakeWallet` for tests, and an `NWCWallet` source [L3] | An accounts layer on top of *your* funding node. For your users it is custodial (you hold the funds). Per-wallet API keys "so individual apps never touch your full balance". [L1] |
| **Polar** | v4.0.0, released 2026-01-06 [P1] | MIT | Desktop app (Mac, Linux, Windows). Requires Docker. Docker Desktop on Linux is unsupported. [P1] | Regtest only. Bundles LND 0.20, CLN 25.12, Eclair 0.13 and Bitcoin Core 30. [P1] | Dev tool only, no real funds |
| **Breez SDK - Spark** | 0.27.2 (latest tagged release, 2026-10-23). npm shows `0.27.3-dev` as `latest`, so pin a version. [B4][R] | MIT | Kotlin, Swift, JS/WASM, React Native/Expo, Flutter, Go, Python, C# [B1] | `Network` enum: Mainnet, Regtest, Signet [B5]. Whether Regtest points at a hosted Spark regtest or can run locally is **unverified**. | Non-custodial. Spark operators "cannot move funds without the user", and a unilateral exit to L1 exists. A **free API key is required**. [B1][B4] |
| **Breez SDK - Liquid** | Docs: "we recommend moving to the Breez SDK - Spark as soon as possible". `breez/breez-sdk-liquid` returns 404 on GitHub. Last npm release 0.12.4 (2026-06). [B2][R] | MIT (npm) | (Legacy) | (Legacy) | Not recommended |
| **Breez SDK - Greenlight** | **"Deprecated and no longer maintained"** [B3] | MIT | | | Not recommended. Blockstream Greenlight itself (MIT) supports bitcoin, testnet and regtest. [G1] |
| **ldk-node** | v0.7.0 (2025-12-03). Main branch is 0.8.0+git. [K1][R] | MIT OR Apache-2.0 [K2] | Rust, plus Swift, Kotlin (Maven `ldk-node-android`) and Python via UniFFI. The community RN wrapper `LtbLightning/ldk-node-rn` was last released as v0.3.1 in Jan 2025. [K1][R] | Chain source: Bitcoin Core RPC, Esplora or Electrum. Integration tests use regtest `bitcoind` plus `electrs`. [K1] | Self-custodial embedded node. You handle channels and liquidity yourself (LSPS support is listed). Heavy for 15 days. |
| **BDK** | `bdk_wallet` v3.2.0. `bdk-ffi` v3.1.1. `bdk-rn` v1.1.0 (now official, under bitcoindevkit). `@bitcoindevkit/bdk-wallet-web` 0.4.0. [K3][K4][R] | MIT OR Apache-2.0 | Rust, Kotlin/Android, Swift, JVM, Python, Dart, React Native, browser/Node via WASM [K4][K5] | Any network via Esplora or Electrum, including local regtest `electrs`/Esplora. WASM supports **Esplora only**, with no filesystem, so you persist the changeset yourself. [K3][K5] | Self-custodial **on-chain** descriptor wallet. Use it if "wallet implementation" must mean the app holds keys. |
| **nostr-tools** | 2.25.5 (npm and JSR `@nostr/tools`), 2026-11-02 [N2][R] | Unlicense | Browser, Node, RN | n/a | Low-level. Depends only on `@noble`/`@scure`. |
| **NDK** | `@nostr-dev-kit/ndk` 3.0.3 (2026-02). Has `mobile` (RN), `react`, `svelte` and `wallet` (Cashu/NWC/WebLN) packages. [N3][R] | MIT | Web, React Native | n/a | Higher-level, with outbox model and caches (Dexie/SQLite). Larger bundle. |
| **Machankura** (Africa) | Live in about 9 countries. **Nigeria: `*347*8333#`**. Also WhatsApp and web. [M1] | n/a (service) | USSD on any phone, no internet needed | Mainnet only | "**Fully custodial** bitcoin and lightning wallet" [M2]. Can receive at `<phone or username>@8333.mobi` Lightning addresses [M1]. No public developer API found (**unverified**). |
| **Bitnob API** (Africa) | Docs include a sandbox with test keys. Official SDKs for Python, Node and Go are marked "coming soon". [N1] | Proprietary API | REST | Sandbox | Docs say both "custodial and non-custodial flows for on-chain and Lightning". Also offers NGN virtual accounts and payouts to 40+ countries. KYB terms **unverified**. [N1] |

## Recommended default stack

**Wallet layer: an NWC client, a self-hosted wallet service, and a regtest Lightning network, all started by one `docker compose up`.**

- **Frontend:** a small PWA (React or plain web components), with **Bitcoin Connect** for the "connect wallet" button and **`@getalby/sdk`** (`NWCClient` / `LN`) for payments. Use **nostr-tools** for identity and signing, because it is light and has few dependencies. Choose NDK only if you need its caching or outbox features.
  - *UX on low bandwidth:* a PWA needs no app-store download. NWC traffic is small encrypted Nostr events. Keep the bundle small (skip NDK if you can).
- **Wallet service in compose:** **Alby Hub** (Docker image, Apache-2.0) with its LND backend pointed at regtest LND, or its LDK backend on regtest `bitcoind`. **LNbits** with `LndRestWallet` is the alternative if you need many seeded per-user wallets and an admin UI. Add regtest `bitcoind` and two LND nodes, plus a `seed.sh` that mines 101 blocks, funds the nodes, opens a channel and creates demo users or invoices.
  - *Working MVP:* one command, seed data, and a real Lightning happy path, not a mockup. `FakeWallet` breaks the "avoid mockups" rule, so use it only in unit tests.
  - *Hosted MVP (the rules allow an internet-reachable MVP or a video):* run the same Hub on **Mutinynet** (documented config) so judges can pay with faucet sats.
- **Security by Design, in concrete terms you can put in the README threat model:**
  - Each app or user gets its own NWC connection with `request_methods` limited to what it needs (e.g. `make_invoice lookup_invoice` for a merchant), plus `max_amount`, `renewal_period` and `expires_at`. The wallet service must refuse rather than silently drop these limits. [S3]
  - The app never sees the seed. The NWC secret goes in `.env` or a Docker secret, never in git or logs. NIP-44 encryption only. [S1]
  - Proven libraries only (LND/LDK, `@noble`), no hand-rolled cryptography.
  - Never log payment hashes, phone numbers or npubs.
- **"At least a bitcoin/lightning wallet implementation":** NWC send and receive inside your UI probably satisfies this, but confirm with the organisers (open question 5). If they say the app must hold keys:
  - add a **BDK** on-chain receive/backup wallet (`bdk-wallet-web` over Esplora, or `bdk-rn`), or
  - for a phone-first self-custodial Lightning wallet, swap the wallet layer for **Breez SDK Spark** (React Native). This costs you a free API key and an uncertain local regtest story.
- **Local impact hook:** let merchants or users *receive* to an existing Machankura `@8333.mobi` Lightning address, which needs no new USSD integration. That reaches feature-phone users in Nigeria. Say clearly that Machankura is custodial.
- **Avoid:** Breez Greenlight (deprecated) and Breez Liquid (migration advised). Raw ldk-node is too much liquidity and channel work for 15 days. Polar is for your own machine only, since judges cannot run a GUI from compose.

## Sources

Event (Devpost)
- [D1] https://dakar-bitcoin-hack-2026.devpost.com/ : overview, requirements, prizes, judges, criteria, eligibility sidebar
- [D2] https://dakar-bitcoin-hack-2026.devpost.com/rules : dates, Africa residency, submission requirements, sats prizes
- [D3] https://dakar-bitcoin-hack-2026.devpost.com/resources : tools list, Discord/Telegram/X links
- [D4] https://dakar-bitcoin-hack-2026.devpost.com/details/dates : schedule
- [D5] https://devpost.com/api/hackathons?search=dakar : organisation name, registrations, id 26475
- [D6] https://dakar-bitcoin-hack-2026.devpost.com/updates

Specs
- [S1] https://github.com/nostr-protocol/nips/blob/master/47.md : NIP-47
- [S2] https://github.com/nostr-wallet-connect/nwc/blob/main/13.md : NWC-13 Connection Budgets
- [S3] https://github.com/nostr-wallet-connect/nwc/blob/main/08.md : NWC-08 client-initiated connections (`max_amount`, `request_methods`, `isolated`)

Alby
- [A1] https://github.com/getAlby/hub : README (backends, Docker, regtest/Polar, Mutinynet/signet config); releases v1.24.6
- [A2] https://github.com/getAlby/js-sdk : README; releases v9.0.0
- [A3] https://github.com/getAlby/js-sdk/blob/master/docs/nwc.md : `fromAuthorizationUrl`, `requestMethods`, React Native Expo demo
- [A4] https://github.com/getAlby/bitcoin-connect : README ("Alpha" warning)

LNbits / Polar
- [L1] https://github.com/lnbits/lnbits : README; releases v1.6.2
- [L2] https://github.com/lnbits/lnbits/blob/main/docs/guide/installation.md : Docker option
- [L3] https://github.com/lnbits/lnbits/blob/main/.env.example : funding sources incl. FakeWallet, NWCWallet, SparkWallet
- [P1] https://github.com/jamaljsr/polar : README; releases v4.0.0

Breez / Greenlight
- [B1] https://sdk-doc-spark.breez.technology/ : Spark SDK overview (languages, non-custodial)
- [B2] https://sdk-doc-liquid.breez.technology/ : "moving to the Breez SDK - Spark as soon as possible"
- [B3] https://sdk-doc-greenlight.breez.technology/ : "Deprecated and no longer maintained"
- [B4] https://github.com/breez/spark-sdk : README (API key, Spark operators, unilateral exit); releases 0.27.2
- [B5] https://github.com/breez/spark-sdk/blob/main/crates/breez-sdk/core/src/models/mod.rs : `Network` enum
- [G1] https://github.com/Blockstream/greenlight : README (networks)

LDK / BDK
- [K1] https://github.com/lightningdevkit/ldk-node : README; releases v0.7.0
- [K2] https://github.com/lightningdevkit/ldk-node/blob/main/Cargo.toml : licence
- [K3] https://github.com/bitcoindevkit/bdk_wallet : README; releases v3.2.0
- [K4] https://github.com/bitcoindevkit/bdk-ffi : README (language bindings incl. bdk-rn); releases v3.1.1
- [K5] https://github.com/bitcoindevkit/bdk-wasm : README (browser, Esplora-only, no filesystem)

Nostr
- [N2] https://github.com/nbd-wtf/nostr-tools : README; https://jsr.io/@nostr/tools
- [N3] https://github.com/nostr-dev-kit/ndk : README (packages)

Africa-relevant
- [M1] https://8333.mobi/ : Machankura countries, USSD codes, @8333.mobi addresses
- [M2] https://8333.mobi/faqs : "fully custodial"
- [N1] https://docs.bitnob.com/ : Bitnob API docs (sandbox, Bitcoin, virtual accounts, SDKs)
- Mutinynet deployment: https://github.com/MutinyWallet/mutiny-net (custom signet, 30s blocks)

Registries
- [R] npm registry (`https://registry.npmjs.org/<pkg>`) and GitHub releases/repos API, queried 2026-11-05
