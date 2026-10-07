// Small production server: serves the built app and keeps the one shared tournament.
// No dependencies on purpose — node:http, node:fs and node:crypto are enough.
//
//   GET  /api/state        everyone: { tournament, version, updatedAt, editable }
//   POST /api/auth         arbiter: checks the PIN (header x-arbiter-pin)
//   PUT  /api/tournament   arbiter: { baseVersion, tournament } → new version, 409 if stale
//   POST /api/registrations          everyone, while registration is open: { name, rating, title, fed, club }
//   GET  /api/registrations          arbiter: pending registrations
//   DELETE /api/registrations/:id    arbiter: reject one (accepting = saving a tournament with that player id)
//   GET  /health           liveness probe
//
// Env: PORT (9010), DATA_DIR (./data), DIST_DIR (./dist), ARBITER_PIN (editing is off without it).

import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BODY = 1024 * 1024;
const MAX_REGISTRATION_BODY = 2048;
const MAX_PENDING = 100;
const LOCK_FAILURES = 10;
const LOCK_WINDOW_MS = 15 * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// Same headers the nginx setup sent: private tool, never framed or indexed.
const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex, nofollow',
};

function isTournament(t) {
  return (
    t &&
    typeof t === 'object' &&
    typeof t.name === 'string' &&
    (t.system === 'swiss' || t.system === 'roundrobin') &&
    typeof t.totalRounds === 'number' &&
    Array.isArray(t.players) &&
    t.players.every((p) => p && typeof p.id === 'string' && typeof p.name === 'string') &&
    Array.isArray(t.rounds) &&
    t.rounds.every((r) => r && typeof r.number === 'number' && Array.isArray(r.pairings))
  );
}

const normName = (n) => n.trim().replace(/\s+/g, ' ').toLowerCase();

/** Returns the cleaned registration, or null if anything is off. */
function cleanRegistration(b) {
  if (!b || typeof b !== 'object') return null;
  const str = (v, max) => (v === undefined || v === null || v === '' ? '' : typeof v === 'string' && v.trim().length <= max ? v.trim() : null);
  const name = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ') : '';
  const title = str(b.title, 4);
  const fed = str(b.fed, 3);
  const club = str(b.club, 80);
  const rating = b.rating === undefined || b.rating === '' ? 0 : Number(b.rating);
  if (!name || name.length > 80 || title === null || fed === null || club === null) return null;
  if (!Number.isInteger(rating) || rating < 0 || rating > 3500) return null;
  if (fed && !/^[A-Za-z]{2,3}$/.test(fed)) return null;
  return {
    name,
    rating,
    ...(title ? { title } : {}),
    ...(fed ? { fed: fed.toUpperCase() } : {}),
    ...(club ? { club } : {}),
  };
}

/** Wrong PINs are counted globally: behind Traefik every request comes from the proxy's IP. */
function createLock(now = () => Date.now()) {
  let failures = [];
  const prune = () => (failures = failures.filter((t) => now() - t < LOCK_WINDOW_MS));
  return {
    locked: () => prune().length >= LOCK_FAILURES,
    fail: () => failures.push(now()),
  };
}

function pinMatches(expected, given) {
  if (!expected || typeof given !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function createApp({ distDir, dataDir, pin }) {
  const dist = resolve(distDir);
  const dataFile = join(resolve(dataDir), 'tournament.json');
  const regFile = join(resolve(dataDir), 'registrations.json');
  await mkdir(resolve(dataDir), { recursive: true });

  let state = { version: 0, updatedAt: null, tournament: null };
  try {
    state = JSON.parse(await readFile(dataFile, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  let registrations = [];
  try {
    registrations = JSON.parse(await readFile(regFile, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  const lock = createLock();
  const editable = Boolean(pin);

  /** Write to a temp file in the same directory, then rename: a crash never leaves half a file. */
  async function persist(next) {
    const tmp = `${dataFile}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(next));
    await rename(tmp, dataFile);
    state = next;
  }

  // Registration writes are chained so two at once never share the temp file.
  let regWrites = Promise.resolve();
  const saveRegistrations = () => {
    const snapshot = JSON.stringify(registrations);
    regWrites = regWrites.then(async () => {
      const tmp = `${regFile}.${process.pid}.tmp`;
      await writeFile(tmp, snapshot);
      await rename(tmp, regFile);
    });
    return regWrites;
  };

  /** A saved tournament containing a registration's id means the arbiter accepted it. */
  const dropAccepted = () => {
    const ids = new Set(state.tournament?.players.map((p) => p.id) ?? []);
    const before = registrations.length;
    registrations = registrations.filter((r) => !ids.has(r.id));
    return registrations.length !== before ? saveRegistrations() : undefined;
  };

  const registrationOpen = () => {
    const t = state.tournament;
    return Boolean(t && t.registrationOpen === true && !(t.system === 'roundrobin' && t.rounds.length > 0));
  };

  const send = (res, status, body, headers = {}) => {
    const isJson = body !== undefined && typeof body !== 'string';
    res.writeHead(status, {
      ...BASE_HEADERS,
      ...(isJson ? { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } : {}),
      ...headers,
    });
    res.end(isJson ? JSON.stringify(body) : body);
  };

  /** Returns null when the request may write, otherwise sends the refusal. */
  const refuseUnlessArbiter = (req, res) => {
    if (!editable) return send(res, 503, { error: 'editing-disabled' }), true;
    if (lock.locked()) return send(res, 423, { error: 'locked' }), true;
    if (!pinMatches(pin, req.headers['x-arbiter-pin'])) {
      lock.fail();
      return send(res, 401, { error: 'bad-pin' }), true;
    }
    return false;
  };

  const readBody = (req, limit = MAX_BODY) =>
    new Promise((ok, fail) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) {
          fail(Object.assign(new Error('too large'), { status: 413 }));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
      req.on('error', fail);
    });

  async function serveStatic(req, res, pathname) {
    let file = resolve(dist, '.' + decodeURIComponent(pathname));
    // Never serve anything outside dist/.
    if (file !== dist && !file.startsWith(dist + sep)) return send(res, 404, 'Not found');
    let info = await stat(file).catch(() => null);
    if (!info || info.isDirectory()) {
      file = join(dist, 'index.html');
      info = await stat(file).catch(() => null);
      if (!info) return send(res, 404, 'Not found');
    }
    const ext = extname(file);
    // Vite hashes asset names, so they can be cached forever; index.html never.
    const cache = file.endsWith('index.html')
      ? 'no-cache, no-store, must-revalidate'
      : pathname.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600';
    const body = await readFile(file);
    res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': cache });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  async function handle(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost');

    if (pathname === '/health') return send(res, 200, 'healthy\n', { 'Content-Type': 'text/plain' });

    if (pathname === '/api/state' && req.method === 'GET') {
      return send(res, 200, { ...state, editable });
    }

    if (pathname === '/api/auth' && req.method === 'POST') {
      if (refuseUnlessArbiter(req, res)) return;
      return send(res, 200, { ok: true });
    }

    if (pathname === '/api/tournament' && req.method === 'PUT') {
      if (refuseUnlessArbiter(req, res)) return;
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (e) {
        return send(res, e.status ?? 400, { error: e.status ? 'too-large' : 'bad-json' });
      }
      if (!body || typeof body.baseVersion !== 'number' || !isTournament(body.tournament)) {
        return send(res, 400, { error: 'bad-shape' });
      }
      // Someone else saved since this client last synced: hand back the newer data.
      if (body.baseVersion !== state.version) return send(res, 409, { error: 'conflict', ...state });
      await persist({ version: state.version + 1, updatedAt: new Date().toISOString(), tournament: body.tournament });
      await dropAccepted();
      return send(res, 200, { version: state.version, updatedAt: state.updatedAt });
    }

    if (pathname === '/api/registrations' && req.method === 'POST') {
      let body;
      try {
        body = JSON.parse(await readBody(req, MAX_REGISTRATION_BODY));
      } catch (e) {
        return send(res, e.status ?? 400, { error: e.status ? 'too-large' : 'bad-json' });
      }
      // Everything from here to the push is synchronous, so two requests can't both pass the checks.
      if (!registrationOpen()) return send(res, 403, { error: 'closed' });
      const reg = cleanRegistration(body);
      if (!reg) return send(res, 400, { error: 'bad-shape' });
      const key = normName(reg.name);
      const taken = [...registrations, ...state.tournament.players].some((p) => normName(p.name) === key);
      if (taken) return send(res, 409, { error: 'duplicate' });
      if (registrations.length >= MAX_PENDING) return send(res, 429, { error: 'full' });
      registrations.push({ id: randomUUID(), ...reg, createdAt: new Date().toISOString() });
      await saveRegistrations();
      return send(res, 201, { ok: true });
    }

    if (pathname === '/api/registrations' && req.method === 'GET') {
      if (refuseUnlessArbiter(req, res)) return;
      return send(res, 200, { registrations });
    }

    const regMatch = pathname.match(/^\/api\/registrations\/([\w-]+)$/);
    if (regMatch && req.method === 'DELETE') {
      if (refuseUnlessArbiter(req, res)) return;
      registrations = registrations.filter((r) => r.id !== regMatch[1]);
      await saveRegistrations();
      return send(res, 200, { ok: true });
    }

    if (pathname.startsWith('/api/')) return send(res, 404, { error: 'not-found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return serveStatic(req, res, pathname);
  }

  return createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) send(res, 500, { error: 'server-error' });
      else res.end();
    });
  });
}

// Started directly (node server/server.mjs), not imported by tests.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const pin = (process.env.ARBITER_PIN ?? '').trim();
  const port = Number(process.env.PORT ?? 9010);
  const server = await createApp({
    distDir: process.env.DIST_DIR ?? join(root, 'dist'),
    dataDir: process.env.DATA_DIR ?? join(root, 'data'),
    pin,
  });
  server.listen(port, () => {
    console.log(`chess-swiss listening on :${port}`);
    if (!pin) console.warn('ARBITER_PIN is not set: results are read-only for everyone.');
    else if (pin.length < 6) console.warn('ARBITER_PIN is shorter than 6 characters; pick a longer one.');
  });
}
