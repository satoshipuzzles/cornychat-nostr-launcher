# 🌽 Corny Chat · Nostr Launcher

A static, dependency-free-at-runtime page that signs you in to Nostr with a
**NIP-07 browser extension** or a **NIP-46 remote bunker**, then opens a
[Corny Chat](https://github.com/vicariousdrama/cornychat) audio room.

Everything runs in the browser. There is no backend, no analytics, and no key
material stored anywhere — signing is delegated to your extension or your
bunker, and only the resulting public key and the bunker connection pointer are
kept in `localStorage`.

## What it does

| Feature | Detail |
| --- | --- |
| NIP-07 sign-in | Uses `window.nostr` when a signer extension is present |
| NIP-46 bunker | Paste a `bunker://` URI or a NIP-05 address (e.g. `you@nsec.app`) |
| NIP-46 nostrconnect | Generates a `nostrconnect://` URI with a scannable QR code |
| Session restore | Reconnects to the same bunker on reload using the stored client key |
| Profile | Loads your kind-0 metadata (name + avatar) from the configured relays |
| Signing check | Signs a NIP-98 style event and verifies it locally — nothing is published |
| Room launcher | Opens `<instance>/<room>`, with a random room id in Corny Chat's own format |
| Configurable | Instance base URL and relay list are editable and persisted |

## Scope — read this before self-hosting

GitHub Pages serves **static files only**. Corny Chat is three components:

- `ui` — React frontend behind an Express/EJS server
- `pantry` — signaling and room API
- `pantry-sfu` — mediasoup media server

Pages cannot run `pantry` or the SFU, so this repository is **not** a full
self-hosted Corny Chat. It is the sign-in and room-entry surface, with the
instance base URL configurable so it can point at `cornychat.com` today and at
your own deployment the moment one exists. For the full stack, follow
[`INSTALL.md`](https://github.com/vicariousdrama/cornychat/blob/main/INSTALL.md)
in the upstream repository on a server you control, then set the instance URL
here to that host.

## Develop

```bash
npm install
npm test          # builds, then boots the bundle in jsdom and asserts the UI wiring
npm run build     # -> dist/
npx serve dist    # or any static file server
```

## Deploy

### GitHub Pages

Pushing to `main` runs `.github/workflows/pages.yml`, which builds, runs the
smoke test, and publishes `dist/` to GitHub Pages. Enable Pages with
**Settings → Pages → Source: GitHub Actions**.

Live: <https://satoshipuzzles.github.io/cornychat-nostr-launcher/>

### Vercel

`vercel.json` pins the build, so importing the repo needs no configuration:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/import?s=https%3A%2F%2Fgithub.com%2Fsatoshipuzzles%2Fcornychat-nostr-launcher)

| Setting | Value |
| --- | --- |
| Framework preset | Other |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |

No environment variables are required — the app is entirely client side, and the
instance URL and relay list are configured in the UI at runtime.

Or from a checkout, with the CLI:

```bash
npx vercel --prod
```

## Licence

MIT. Corny Chat itself is AGPL-3.0 and is not vendored here — this launcher only
links to a running instance.
