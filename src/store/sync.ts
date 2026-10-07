import { create } from 'zustand';
import type { Registration, Tournament } from '../engine/types';
import { parseTournamentJson } from './serialize';
import { useTournament, type NewPlayer } from './useTournament';

/**
 * Talks to the shared server when there is one.
 *
 * - No server (yarn dev, static hosting): stays in local mode, nothing changes.
 * - Viewers poll every 10 s and only ever write to the non-persisted `shared` copy,
 *   so a viewer's browser never loses its own saved tournament.
 * - The arbiter edits the persisted copy; every change is sent right away with the
 *   version it was based on, and the server refuses stale saves (409).
 */

const PIN_KEY = 'swiss-lite:pin';
const POLL_MS = 10_000;
const RETRY_MS = 5_000;

export type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'error';

interface ServerState {
  version: number;
  updatedAt: string | null;
  tournament: Tournament | null;
  editable: boolean;
}

/** The server already holds a different tournament than this device: the arbiter decides. */
export interface LoginChoice {
  server: { name: string; players: number; rounds: number };
  local: { name: string; players: number; rounds: number };
}

interface SyncState {
  ready: boolean;
  server: boolean;
  editable: boolean;
  online: boolean;
  saveState: SaveState;
  notice: string | null;
  choice: LoginChoice | null;
  /** Pending sign-ups, arbiter only. */
  registrations: Registration[];
}

export const useSync = create<SyncState>(() => ({
  ready: false,
  server: false,
  editable: false,
  online: true,
  saveState: 'idle',
  notice: null,
  choice: null,
  registrations: [],
}));

let version = 0;
let pin: string | null = null;
let applying = false;
let dirty = false;
let inFlight = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let pendingServer: ServerState | null = null;

const storage = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode: nothing to do */
    }
  },
  remove: (k: string) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

async function fetchState(): Promise<ServerState | null> {
  try {
    const res = await fetch('/api/state', { cache: 'no-store' });
    // Static hosts answer unknown paths with index.html (200), so check the payload, not the status.
    if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) return null;
    const data = await res.json();
    if (typeof data?.version !== 'number' || !('tournament' in data)) return null;
    return data as ServerState;
  } catch {
    return null;
  }
}

/** Fills fields older saves may lack, same as an import. */
function normalize(t: Tournament): Tournament {
  const res = parseTournamentJson(JSON.stringify(t));
  return res.ok ? res.tournament : t;
}

const hasData = (t: Tournament) => t.players.length > 0 || t.rounds.length > 0;
const summary = (t: Tournament) => ({ name: t.name, players: t.players.length, rounds: t.rounds.length });

/** Keeps a copy of this device's tournament before it gets replaced. */
function backup(t: Tournament) {
  if (hasData(t)) storage.set(`swiss-lite:backup-${Date.now()}`, JSON.stringify(t));
}

function applyServer(t: Tournament | null, v: number) {
  version = v;
  const st = useTournament.getState();
  if (st.mode === 'viewer') {
    useTournament.setState({ shared: t ? normalize(t) : null });
    return;
  }
  if (!t) return;
  applying = true;
  useTournament.setState({ tournament: normalize(t) });
  applying = false;
}

async function push() {
  if (inFlight || !dirty || !pin || useTournament.getState().mode !== 'arbiter') return;
  clearTimeout(retryTimer);
  inFlight = true;
  dirty = false;
  useSync.setState({ saveState: 'saving' });
  const tournament = useTournament.getState().tournament;
  try {
    const res = await fetch('/api/tournament', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-arbiter-pin': pin },
      body: JSON.stringify({ baseVersion: version, tournament }),
    });
    if (res.ok) {
      version = (await res.json()).version;
      useSync.setState({ saveState: 'saved', online: true });
    } else if (res.status === 409) {
      // Another device saved first: keep ours as a backup, show theirs.
      const data = (await res.json()) as ServerState;
      backup(tournament);
      dirty = false;
      applyServer(data.tournament, data.version);
      useSync.setState({
        saveState: 'saved',
        notice: 'Un autre appareil a modifié le tournoi entre-temps : sa version est affichée. Refaites votre dernière saisie si besoin.',
      });
    } else if (res.status === 401 || res.status === 423 || res.status === 503) {
      dirty = true;
      await logout();
      useSync.setState({ notice: 'Le code arbitre a été refusé : vos dernières modifications restent sur cet appareil. Reconnectez-vous.' });
    } else {
      dirty = true;
      useSync.setState({ saveState: 'error' });
      retryTimer = setTimeout(push, RETRY_MS);
    }
  } catch {
    dirty = true;
    useSync.setState({ saveState: 'offline', online: false });
    retryTimer = setTimeout(push, RETRY_MS);
  } finally {
    inFlight = false;
  }
  if (dirty && useSync.getState().saveState === 'saved') push();
}

/** Pending sign-ups, minus any this device already accepted but hasn't saved yet. */
async function fetchRegistrations() {
  if (!pin || useTournament.getState().mode !== 'arbiter') return;
  const res = await fetch('/api/registrations', { headers: { 'x-arbiter-pin': pin }, cache: 'no-store' }).catch(() => null);
  // A PIN changed on the server must not keep failing every poll and lock the real arbiter out.
  if (res && (res.status === 401 || res.status === 423 || res.status === 503)) {
    await logout();
    useSync.setState({ notice: 'Le code arbitre a été refusé. Reconnectez-vous.' });
    return;
  }
  if (!res?.ok) return;
  const { registrations } = (await res.json()) as { registrations: Registration[] };
  const ids = new Set(useTournament.getState().tournament.players.map((p) => p.id));
  useSync.setState({ registrations: registrations.filter((r) => !ids.has(r.id)) });
}

/** Returns an error message, or null once the sign-up is waiting for the arbiter. */
export async function submitRegistration(p: NewPlayer): Promise<string | null> {
  const res = await fetch('/api/registrations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(p),
  }).catch(() => null);
  if (!res) return 'Serveur injoignable.';
  if (res.ok) return null;
  const error = ((await res.json().catch(() => ({}))) as { error?: string }).error;
  if (error === 'closed') return 'Les inscriptions sont fermées.';
  if (error === 'duplicate') return 'Ce nom est déjà inscrit.';
  if (error === 'full') return 'Trop d’inscriptions en attente. Réessayez plus tard ou adressez-vous à l’arbitre.';
  if (error === 'bad-shape') return 'Vérifiez les champs : Elo entre 0 et 3500, fédération en 3 lettres.';
  return 'Erreur du serveur.';
}

/**
 * The player keeps the registration's id: once the tournament is saved, the server drops
 * the matching sign-up itself. If that save loses a conflict, the sign-up simply stays pending.
 */
export function acceptRegistration(r: Registration): string | null {
  const { id, name, rating, title, fed, club } = r;
  const err = useTournament.getState().addPlayers([{ id, name, rating, title, fed, club }]);
  if (!err) useSync.setState((s) => ({ registrations: s.registrations.filter((x) => x.id !== id) }));
  return err;
}

export async function rejectRegistration(id: string) {
  if (!pin) return;
  const res = await fetch(`/api/registrations/${id}`, { method: 'DELETE', headers: { 'x-arbiter-pin': pin } }).catch(() => null);
  if (res?.ok) useSync.setState((s) => ({ registrations: s.registrations.filter((x) => x.id !== id) }));
}

async function poll() {
  const s = await fetchState();
  if (!s) {
    useSync.setState({ online: false });
    return;
  }
  useSync.setState({ online: true, editable: s.editable });
  const mode = useTournament.getState().mode;
  if (mode === 'viewer' && s.version !== version) applyServer(s.tournament, s.version);
  // Changes from another arbiter device, only when nothing is waiting to be saved here.
  if (mode === 'arbiter' && !dirty && !inFlight && s.version > version) applyServer(s.tournament, s.version);
  await fetchRegistrations();
}

function enterViewer(s: ServerState) {
  useTournament.setState({ mode: 'viewer' });
  applyServer(s.tournament, s.version);
}

function enterArbiter(p: string) {
  pin = p;
  storage.set(PIN_KEY, p);
  useTournament.setState({ mode: 'arbiter', shared: null });
  void fetchRegistrations();
}

/** Returns an error message, or null when logged in (or a choice is pending). */
export async function login(p: string): Promise<string | null> {
  const res = await fetch('/api/auth', { method: 'POST', headers: { 'x-arbiter-pin': p } }).catch(() => null);
  if (!res) return 'Serveur injoignable.';
  if (res.status === 401) return 'Code incorrect.';
  if (res.status === 423) return 'Trop d’essais incorrects. Réessayez dans 15 minutes.';
  if (res.status === 503) return 'La modification est désactivée sur ce serveur (code arbitre non configuré).';
  if (!res.ok) return 'Erreur du serveur.';

  const s = await fetchState();
  if (!s) return 'Serveur injoignable.';
  const local = useTournament.getState().tournament;

  if (!s.tournament) {
    // Empty server: this device's tournament becomes the shared one.
    enterArbiter(p);
    version = s.version;
    dirty = true;
    void push();
    return null;
  }
  if (hasData(local) && JSON.stringify(normalize(local)) !== JSON.stringify(normalize(s.tournament))) {
    pin = p;
    pendingServer = s;
    useSync.setState({ choice: { server: summary(s.tournament), local: summary(local) } });
    return null;
  }
  enterArbiter(p);
  applyServer(s.tournament, s.version);
  return null;
}

/** After login found two different tournaments: keep the server's or replace it with this device's. */
export async function resolveChoice(keep: 'server' | 'local') {
  const s = pendingServer;
  const p = pin;
  pendingServer = null;
  useSync.setState({ choice: null });
  if (!s || !p) return;
  enterArbiter(p);
  version = s.version;
  if (keep === 'server') {
    backup(useTournament.getState().tournament);
    applyServer(s.tournament, s.version);
  } else {
    dirty = true;
    await push();
  }
}

export function cancelChoice() {
  pendingServer = null;
  pin = null;
  useSync.setState({ choice: null });
}

export async function logout() {
  pin = null;
  storage.remove(PIN_KEY);
  useSync.setState({ registrations: [] });
  useTournament.setState({ mode: 'viewer' });
  version = -1; // force the next poll to load the shared copy
  await poll();
}

export async function startSync() {
  const s = await fetchState();
  if (!s) {
    useTournament.setState({ mode: 'local' });
    useSync.setState({ ready: true });
    return;
  }
  useSync.setState({ server: true, editable: s.editable });

  const saved = storage.get(PIN_KEY);
  enterViewer(s);
  if (saved && s.editable && (await login(saved)) !== null) storage.remove(PIN_KEY);
  useSync.setState({ ready: true });

  useTournament.subscribe((st, prev) => {
    if (applying || st.mode !== 'arbiter' || st.tournament === prev.tournament) return;
    dirty = true;
    void push();
  });

  setInterval(poll, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void poll();
  });
  // Last chance to send an unsaved result when the tab closes.
  window.addEventListener('pagehide', () => {
    if (!dirty || !pin) return;
    void fetch('/api/tournament', {
      method: 'PUT',
      keepalive: true,
      headers: { 'content-type': 'application/json', 'x-arbiter-pin': pin },
      body: JSON.stringify({ baseVersion: version, tournament: useTournament.getState().tournament }),
    });
  });
}
