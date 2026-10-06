# chess-swiss

Lightweight, offline chess tournament manager for clubs — a small browser take on Swiss-Manager.

- Swiss (simplified Dutch pairing) and round robin (Berger tables)
- Players: add, bulk paste, edit inline, withdraw
- Results with forfeits, pairing byes, requested half-point byes
- Standings with Buchholz, Buchholz Cut-1, Sonneborn-Berger, wins, direct encounter, ARO
- Crosstable, printable pairings/standings
- Everything saved in the browser (survives refresh); JSON export/import; manual reset

## Run

```sh
yarn install
yarn dev      # http://localhost:5173
yarn test     # engine tests
yarn build    # static site in dist/
```

`dist/` can be hosted on any static server. Data lives in the browser's localStorage, so export a JSON backup now and then.

## Shared results (server)

In production a small Node server (`server/server.mjs`, no dependencies) serves the app and keeps one shared
tournament, so everyone who opens the URL sees the same pairings and standings. Viewers refresh every 10 s;
the arbiter unlocks editing with a PIN.

| Env | Default | |
|---|---|---|
| `ARBITER_PIN` | — | Required to edit. Without it the site is read-only for everyone. Use 6+ characters. |
| `DATA_DIR` | `/app/data` | Where `tournament.json` is stored. Mount a persistent volume here. |
| `PORT` | `9010` | |

```sh
yarn build && ARBITER_PIN=secret yarn start    # http://localhost:9010
docker compose up --build                       # same, in Docker (PIN from $ARBITER_PIN)
```

Without the server (`yarn dev`, any static host) the app works offline in the browser, as before.
