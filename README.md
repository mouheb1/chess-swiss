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

## Docker

```sh
docker compose up --build   # http://localhost:9010, health check at /health
```

Production runs the same `Dockerfile` (nginx on port 9010) through Dokploy.
