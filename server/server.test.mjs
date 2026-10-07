import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './server.mjs';

const PIN = 'echecs2026';
const tournament = { name: 'Club', system: 'swiss', totalRounds: 5, players: [{ id: 'a', name: 'A', rating: 0 }], rounds: [] };

let dir;
let servers = [];

async function start(pin = PIN) {
  const server = await createApp({ distDir: join(dir, 'dist'), dataDir: join(dir, 'data'), pin });
  await new Promise((ok) => server.listen(0, ok));
  servers.push(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, init = {}) => fetch(base + path, init);
  const put = (body, pin = PIN) =>
    call('/api/tournament', { method: 'PUT', headers: { 'x-arbiter-pin': pin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { server, call, put };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'chess-swiss-'));
  await mkdir(join(dir, 'dist', 'assets'), { recursive: true });
  await writeFile(join(dir, 'dist', 'index.html'), '<!doctype html><title>app</title>');
  await writeFile(join(dir, 'dist', 'assets', 'app-123.js'), 'console.log(1)');
  await writeFile(join(dir, 'secret.txt'), 'outside dist');
});

afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((ok) => s.close(ok))));
  servers = [];
  await rm(dir, { recursive: true, force: true });
});

describe('shared tournament API', () => {
  it('starts empty and readable by anyone, never cached', async () => {
    const { call } = await start();
    const res = await call('/api/state');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ version: 0, updatedAt: null, tournament: null, editable: true });
  });

  it('rejects a wrong PIN and accepts the right one', async () => {
    const { call, put } = await start();
    expect((await call('/api/auth', { method: 'POST', headers: { 'x-arbiter-pin': 'nope' } })).status).toBe(401);
    expect((await call('/api/auth', { method: 'POST', headers: { 'x-arbiter-pin': PIN } })).status).toBe(200);
    expect((await put({ baseVersion: 0, tournament }, 'nope')).status).toBe(401);
    const ok = await put({ baseVersion: 0, tournament });
    expect(ok.status).toBe(200);
    expect((await ok.json()).version).toBe(1);
    expect((await (await call('/api/state')).json()).tournament.name).toBe('Club');
  });

  it('refuses a save based on an old version (409) and returns the newer data', async () => {
    const { put } = await start();
    await put({ baseVersion: 0, tournament });
    const stale = await put({ baseVersion: 0, tournament: { ...tournament, name: 'Stale' } });
    expect(stale.status).toBe(409);
    const body = await stale.json();
    expect(body.version).toBe(1);
    expect(body.tournament.name).toBe('Club');
  });

  it('keeps the data across a restart', async () => {
    const first = await start();
    await first.put({ baseVersion: 0, tournament });
    const second = await start();
    const state = await (await second.call('/api/state')).json();
    expect(state.version).toBe(1);
    expect(state.tournament.players).toHaveLength(1);
  });

  it('is read-only when no PIN is configured', async () => {
    const { call, put } = await start('');
    expect((await (await call('/api/state')).json()).editable).toBe(false);
    expect((await put({ baseVersion: 0, tournament }, '')).status).toBe(503);
  });

  it('locks writes after 10 wrong PINs, even for the right PIN', async () => {
    const { call, put } = await start();
    for (let i = 0; i < 10; i++) await call('/api/auth', { method: 'POST', headers: { 'x-arbiter-pin': 'x' + i } });
    expect((await put({ baseVersion: 0, tournament })).status).toBe(423);
  });

  it('rejects malformed bodies', async () => {
    const { put } = await start();
    expect((await put({ baseVersion: 0, tournament: { name: 1 } })).status).toBe(400);
    expect((await put({ tournament })).status).toBe(400);
  });
});

describe('player registration', () => {
  const open = { ...tournament, registrationOpen: true };
  const register = (call, body) =>
    call('/api/registrations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const pending = async (call, pin = PIN) => call('/api/registrations', { headers: { 'x-arbiter-pin': pin } });

  it('refuses registrations while closed', async () => {
    const { call, put } = await start();
    expect((await register(call, { name: 'Bob' })).status).toBe(403);
    await put({ baseVersion: 0, tournament });
    expect((await register(call, { name: 'Bob' })).status).toBe(403);
  });

  it('accepts a valid registration and shows it only to the arbiter', async () => {
    const { call, put } = await start();
    await put({ baseVersion: 0, tournament: open });
    expect((await register(call, { name: '  Bob   Smith ', rating: 1500, fed: 'fra' })).status).toBe(201);
    expect((await pending(call, 'nope')).status).toBe(401);
    const { registrations } = await (await pending(call)).json();
    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({ name: 'Bob Smith', rating: 1500, fed: 'FRA' });
    expect(JSON.stringify(await (await call('/api/state')).json())).not.toContain('Bob');
  });

  it('rejects bad fields and duplicate names', async () => {
    const { call, put } = await start();
    await put({ baseVersion: 0, tournament: open });
    expect((await register(call, { name: '' })).status).toBe(400);
    expect((await register(call, { name: 'X', rating: 9000 })).status).toBe(400);
    expect((await register(call, { name: 'X', fed: '12' })).status).toBe(400);
    expect((await register(call, { name: 'a' })).status).toBe(409); // already a player
    expect((await register(call, { name: 'Bob' })).status).toBe(201);
    expect((await register(call, { name: ' bob ' })).status).toBe(409);
  });

  it('stops at 100 pending registrations', async () => {
    const { call, put } = await start();
    await put({ baseVersion: 0, tournament: open });
    await Promise.all(Array.from({ length: 100 }, (_, i) => register(call, { name: `P${i}` })));
    expect((await register(call, { name: 'One too many' })).status).toBe(429);
  });

  it('closes for a round robin that has started', async () => {
    const { call, put } = await start();
    await put({ baseVersion: 0, tournament: { ...open, system: 'roundrobin', rounds: [{ number: 1, pairings: [] }] } });
    expect((await register(call, { name: 'Bob' })).status).toBe(403);
  });

  it('drops a registration once a saved tournament contains its id, and deletes on reject', async () => {
    const { call, put } = await start();
    await put({ baseVersion: 0, tournament: open });
    await register(call, { name: 'Bob' });
    await register(call, { name: 'Eve' });
    const [bob, eve] = (await (await pending(call)).json()).registrations;
    await put({ baseVersion: 1, tournament: { ...open, players: [...open.players, { id: bob.id, name: 'Bob', rating: 0 }] } });
    expect((await (await pending(call)).json()).registrations.map((r) => r.name)).toEqual(['Eve']);
    const del = (pin) => call(`/api/registrations/${eve.id}`, { method: 'DELETE', headers: { 'x-arbiter-pin': pin } });
    expect((await del('nope')).status).toBe(401);
    expect((await del(PIN)).status).toBe(200);
    expect((await (await pending(call)).json()).registrations).toEqual([]);
  });

  it('keeps pending registrations across a restart', async () => {
    const first = await start();
    await first.put({ baseVersion: 0, tournament: open });
    await register(first.call, { name: 'Bob' });
    const second = await start();
    expect((await (await pending(second.call)).json()).registrations).toHaveLength(1);
  });
});

describe('static files', () => {
  it('serves hashed assets as immutable and index.html uncached', async () => {
    const { call } = await start();
    const asset = await call('/assets/app-123.js');
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect(asset.headers.get('content-type')).toContain('javascript');
    const index = await call('/');
    expect(index.headers.get('cache-control')).toContain('no-cache');
    expect(index.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('never serves files outside dist', async () => {
    const { call } = await start();
    for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/assets/..%2f..%2fsecret.txt']) {
      const text = await (await call(path)).text();
      expect(text).not.toContain('outside dist');
    }
  });

  it('answers the health check', async () => {
    const { call } = await start();
    expect(await (await call('/health')).text()).toBe('healthy\n');
  });
});
