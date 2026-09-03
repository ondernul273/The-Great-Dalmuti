/**
 * Stable client identity + session/snapshot persistence.
 *
 * The whole reconnect-after-refresh feature rests on one idea: every human
 * player has a `clientId` that survives page reloads (stored in
 * localStorage), and that `clientId` — not the ephemeral transport id
 * (PeerJS peer id / Socket.IO socket id) — is what `Player.id` holds in
 * `GameState`. Transports still route messages by their own ids, but the
 * *game* always recognises "you" by your persisted `clientId`, so a browser
 * refresh can reclaim the exact same seat, hand, and rank.
 */

import type { GameState } from '../game/types';

const CLIENT_ID_KEY = 'dalmuti.clientId';
const SESSION_KEY = 'dalmuti.session';
const SNAPSHOT_KEY = 'dalmuti.snapshot';

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private browsing / storage disabled — reconnect simply won't persist */
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}

function randomId(): string {
  return `c-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

/** A stable per-browser identity, created once and reused forever. */
export const CLIENT_ID: string = (() => {
  const existing = safeGet(CLIENT_ID_KEY);
  if (existing && existing.trim()) return existing;
  const fresh = randomId();
  safeSet(CLIENT_ID_KEY, fresh);
  return fresh;
})();

export type SessionTransport = 'direct' | 'banquet';
export type SessionRole = 'host' | 'guest';

export interface GameSession {
  transport: SessionTransport;
  role: SessionRole;
  /** Direct Connect room code (host or guest). */
  code?: string;
  /** Banquet Browser lobby id (host or guest). */
  lobbyId?: string;
  name: string;
  clientId: string;
  savedAt: number;
}

export function saveSession(session: Omit<GameSession, 'clientId' | 'savedAt'>): void {
  const full: GameSession = { ...session, clientId: CLIENT_ID, savedAt: Date.now() };
  safeSet(SESSION_KEY, JSON.stringify(full));
}

export function loadSession(): GameSession | null {
  const raw = safeGet(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as GameSession;
    if (!parsed || parsed.clientId !== CLIENT_ID) return null;
    // A session older than 6 hours is almost certainly stale (room/lobby gone).
    if (Date.now() - (parsed.savedAt ?? 0) > 6 * 60 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  safeRemove(SESSION_KEY);
}

/* ------------------------------------------------------------------ */
/*  GameState snapshot — lets a refreshed tab render instantly instead  */
/*  of flashing back to the main menu while the transport reconnects.   */
/* ------------------------------------------------------------------ */

export function saveSnapshot(state: GameState): void {
  try {
    safeSet(SNAPSHOT_KEY, JSON.stringify({ clientId: CLIENT_ID, state, savedAt: Date.now() }));
  } catch {
    /* state failed to serialise — safe to ignore, just skip the snapshot */
  }
}

export function loadSnapshot(): GameState | null {
  const raw = safeGet(SNAPSHOT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { clientId: string; state: GameState; savedAt: number };
    if (!parsed || parsed.clientId !== CLIENT_ID) return null;
    if (Date.now() - (parsed.savedAt ?? 0) > 6 * 60 * 60 * 1000) return null;
    return parsed.state;
  } catch {
    return null;
  }
}

export function clearSnapshot(): void {
  safeRemove(SNAPSHOT_KEY);
}
