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
