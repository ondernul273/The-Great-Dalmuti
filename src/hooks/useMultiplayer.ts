import { useCallback, useEffect, useRef, useState } from 'react';
import Peer, { type DataConnection } from 'peerjs';
import {
  BLOCKED_MESSAGE,
  HAS_CUSTOM_TURN,
  ICE_SERVERS,
  attachIceDiagnostics,
  emptyDiagnostics,
  peerOptions,
  rtcConfiguration,
  runNetworkTest,
  type IceDiagnostics,
  type NetworkTestResult,
} from '../net/webrtcConfig';
import {
  traceStart,
  traceEvent,
  traceErrorType,
  traceTimeout,
  traceFinish,
  traceIsActive,
} from '../net/joinTrace';

export type PeerStatus = 'idle' | 'connecting' | 'hosting' | 'connected' | 'error';

export interface PeerMessage {
  type: string;
  from: string;
  to?: string;
  payload: any;
  timestamp: number;
}

export interface ConnectedPeer {
  id: string;
  name?: string;
}

interface UseMultiplayerOptions {
  onMessage: (msg: PeerMessage) => void;
}

/* ------------------------------------------------------------------ */
/*  Module-level singleton so StrictMode's double-mount can never      */
/*  create two competing peers.                                        */
/* ------------------------------------------------------------------ */

const ROOM_PREFIX = 'dalmuti-';
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
const OPEN_TIMEOUT_MS = 15000;
const CONNECT_TIMEOUT_MS = 14000;
const RELAY_CONNECT_TIMEOUT_MS = 18000; // TURN handshakes are slower
const MAX_HOST_ATTEMPTS = 4;

let singletonPeer: Peer | null = null;

const log = (...a: unknown[]) => console.log('%c[MP]', 'color:#f5b041;font-weight:bold', ...a);
const warn = (...a: unknown[]) => console.warn('%c[MP]', 'color:#fb923c;font-weight:bold', ...a);
const err = (...a: unknown[]) => console.error('%c[MP]', 'color:#f87171;font-weight:bold', ...a);

function genCode(): string {
  let c = '';
  for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

export function hostIdFromCode(code: string): string {
  return `${ROOM_PREFIX}${code.trim().toLowerCase()}`;
}

function rawPeer(id: string | undefined, forceRelay: boolean): Peer {
  const opts = peerOptions(forceRelay);
  return id ? new Peer(id, opts) : new Peer(opts);
}

function destroyPeer(reason: string): void {
  if (!singletonPeer) return;
  log(`destroying peer${singletonPeer.id ? ` ${singletonPeer.id}` : ''} — ${reason}`);
  try {
    singletonPeer.destroy();
  } catch (e) {
    warn('peer.destroy() threw', e);
  }
  singletonPeer = null;
}

function peerErrorType(e: unknown): string {
  if (e && typeof e === 'object' && 'type' in e) return String((e as { type: unknown }).type ?? '');
  return '';
}

function peerErrorLog(e: unknown): string {
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    return `${typeof o.type === 'string' ? o.type : ''} ${
      typeof o.message === 'string' ? o.message : ''
    }`.trim();
  }
  return String(e);
}

function friendlyError(e: unknown): Error {
  const type = peerErrorType(e);
  const raw = (e as { message?: string })?.message ?? String(e);
  switch (type) {
    case 'peer-unavailable':
      return new Error(
        'Room not found. Check the 4-letter code and make sure the host is still waiting in their lobby.'
      );
    case 'unavailable-id':
      return new Error('That room code is already taken. Try hosting again.');
    case 'network':
      return new Error(
        'Lost connection to the signaling server. Your network may be blocking WebRTC traffic.'
      );
    case 'server-error':
      return new Error('The signaling server returned an error. Please try again in a moment.');
    case 'socket-error':
    case 'socket-closed':
      return new Error(
        'Could not reach the signaling server. A firewall, VPN or ad-blocker may be blocking it.'
      );
    case 'webrtc':
      return new Error(BLOCKED_MESSAGE);
    case 'browser-incompatible':
      return new Error('This browser does not support WebRTC. Try Chrome, Edge or Firefox.');
    default:
      return new Error(raw || 'An unknown PeerJS error occurred.');
  }
}

function openPeer(
  id: string | undefined,
  label: string,
  forceRelay: boolean,
  onLiveError: (e: unknown) => void
): Promise<Peer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    log(
      `${label}: creating peer${id ? ` id="${id}"` : ' (random id)'}${
        forceRelay ? ' [TURN-RELAY ONLY]' : ''
      }…`
    );
    traceEvent('peer-created', id ?? '(random id)');
    const peer = rawPeer(id, forceRelay);

    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      traceTimeout('open');
      err(`${label}: timed out waiting for 'open' after ${OPEN_TIMEOUT_MS / 1000}s`);
      try {
        peer.destroy();
        if (singletonPeer === peer) singletonPeer = null;
      } catch {
        /* noop */
      }
      reject(
        new Error(
          `Timed out contacting the signaling server after ${OPEN_TIMEOUT_MS / 1000}s. ` +
            'A firewall or proxy may be blocking it.'
        )
      );
    }, OPEN_TIMEOUT_MS);

    peer.on('open', (openedId) => {
      log(`${label}: peer 'open' — id =`, openedId);
      traceEvent('peer-opened');
      traceEvent('peer-id', String(openedId));
      if (settled) {
        warn(`${label}: peer opened late — destroying stray peer`);
        try {
          peer.destroy();
        } catch {
          /* noop */
        }
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      singletonPeer = peer;
      resolve(peer);
    });

    peer.on('error', (e) => {
      log(`${label}: peer 'error' — ${peerErrorLog(e)}`);
      traceErrorType(peerErrorType(e) || 'peer-error');
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        try {
          peer.destroy();
          if (singletonPeer === peer) singletonPeer = null;
        } catch {
          /* noop */
        }
        reject(friendlyError(e));
      } else {
        onLiveError(e);
      }
    });
  });
}

function wireDisconnectedHandling(peer: Peer, label: string): void {
  peer.on('disconnected', () => {
    warn(`${label}: signaling socket disconnected — reconnecting`);
    try {
      if (!peer.destroyed) peer.reconnect();
    } catch (e) {
      err(`${label}: reconnect() threw`, e);
    }
  });
}

export function useMultiplayer({ onMessage }: UseMultiplayerOptions) {
  const [status, setStatus] = useState<PeerStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [myId, setMyId] = useState<string>('');
  const [roomCode, setRoomCode] = useState<string>('');
  const [connectedPeers, setConnectedPeers] = useState<ConnectedPeer[]>([]);
  const [diagnostics, setDiagnostics] = useState<IceDiagnostics>(emptyDiagnostics());
  const [networkTest, setNetworkTest] = useState<NetworkTestResult | null>(null);
  const [testingNetwork, setTestingNetwork] = useState(false);

  const connectionsRef = useRef<Map<string, DataConnection>>(new Map());
  const namesRef = useRef<Record<string, string>>({});
  const idRef = useRef<string>('');
  const diagRef = useRef<IceDiagnostics>(emptyDiagnostics());
  const detachDiagRef = useRef<(() => void) | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    log('hook mounted — ICE servers in use:', ICE_SERVERS);
    log('RTCConfiguration:', rtcConfiguration(false));
    if (!HAS_CUSTOM_TURN) {
      warn(
        'No dedicated TURN server configured. Falling back to the free shared Open Relay project — ' +
          'fine for testing, but a dedicated TURN server is recommended for corporate networks.'
      );
    }
    return () => log('hook unmounted — singleton peer intentionally left alive');
  }, []);

  const pushDiag = useCallback((d: IceDiagnostics) => {
    diagRef.current = d;
    setDiagnostics(d);
  }, []);

  const setMyIdBoth = useCallback((id: string) => {
    idRef.current = id;
    setMyId(id);
  }, []);

  const syncPeers = useCallback(() => {
    const list: ConnectedPeer[] = [];
    connectionsRef.current.forEach((_c, pid) => list.push({ id: pid, name: namesRef.current[pid] }));
    setConnectedPeers(list);
  }, []);

  const liveError = useCallback((e: unknown) => {
    err('live session error —', peerErrorLog(e));
    if (traceIsActive()) {
      traceErrorType(peerErrorType(e) || 'live-error');
      traceFinish();
    }
    setErrorMessage(friendlyError(e).message);
    setStatus('error');
  }, []);

  const wireConnection = useCallback(
    (conn: DataConnection, label: string) => {
      conn.on('open', () => {
        log(`${label}: connection 'open' with ${conn.peer}`);
        traceEvent('datachannel-opened', conn.peer);
        if (!connectionsRef.current.has(conn.peer)) {
          connectionsRef.current.set(conn.peer, conn);
          syncPeers();
        }
      });
      conn.on('data', (data) => {
        log(`${label}: data ← ${conn.peer}`, data);
        try {
          onMessageRef.current(JSON.parse(data as string) as PeerMessage);
        } catch (e) {
          err(`${label}: bad message from ${conn.peer}`, e, data);
        }
      });
      conn.on('close', () => {
        log(`${label}: connection 'close' with ${conn.peer}`);
        connectionsRef.current.delete(conn.peer);
        syncPeers();
      });
      conn.on('error', (e) => {
        err(`${label}: connection 'error' with ${conn.peer} — ${peerErrorLog(e)}`);
        connectionsRef.current.delete(conn.peer);
        syncPeers();
      });
    },
    [syncPeers]
  );

  const resetForAttempt = useCallback(() => {
    detachDiagRef.current?.();
    detachDiagRef.current = null;
    connectionsRef.current.forEach((c) => {
      try {
        c.close();
      } catch {
        /* noop */
      }
    });
    connectionsRef.current.clear();
    namesRef.current = {};
    destroyPeer('reset for new attempt');
    setConnectedPeers([]);
    setRoomCode('');
    setErrorMessage(null);
    pushDiag(emptyDiagnostics());
  }, [pushDiag]);

  /* ------------------------------- HOST ------------------------------- */

  const initializeHostWithCode = useCallback(async (): Promise<string> => {
    resetForAttempt();
    setStatus('connecting');
    traceStart('HOST');
    log('HOST: registering a room…');

    for (let attempt = 1; attempt <= MAX_HOST_ATTEMPTS; attempt++) {
      const code = genCode();
      const hostId = hostIdFromCode(code);
      log(`HOST: attempt ${attempt}/${MAX_HOST_ATTEMPTS} — code "${code}" → id "${hostId}"`);
      try {
        const peer = await openPeer(hostId, 'HOST', false, liveError);
        wireDisconnectedHandling(peer, 'HOST');
        traceEvent('peer-registered', `code=${code.toUpperCase()} id=${peer.id}`);

        peer.on('connection', (conn) => {
          log('HOST: incoming connection from', conn.peer, '— metadata:', conn.metadata);
          // Each guest gets its own trace window on the host side.
          if (!traceIsActive()) traceStart('HOST', `guest ${conn.peer.slice(-6)}`);
          traceEvent('incoming-connection', conn.peer);
          wireConnection(conn, 'HOST/conn');
          // Diagnose each guest's ICE path from the host side too.
          attachIceDiagnostics(
            () => (conn as unknown as { peerConnection?: RTCPeerConnection }).peerConnection,
            `HOST←${conn.peer.slice(-6)}`,
            false,
            pushDiag
          );
        });

        setMyIdBoth(peer.id);
        setRoomCode(code.toUpperCase());
        setStatus('hosting');
        log(`HOST: ready! code=${code.toUpperCase()} id=${peer.id}`);
        return code.toUpperCase();
      } catch (e) {
        err(`HOST: attempt ${attempt} failed — ${peerErrorLog(e)}`);
        if (peerErrorType(e) === 'unavailable-id') {
          // Code collision: keep the same trace window so the retry is visible
          // in one continuous log; the eventual diagnosis reflects the outcome.
          warn('HOST: code collision — regenerating…');
          continue;
        }
        const fe = friendlyError(e);
        const d = traceFinish();
        const msg = `${fe.message} — Diagnosis ${d.code}: ${d.label} (stopped at ${d.stoppedAt})`;
        setErrorMessage(msg);
        setStatus('error');
        throw new Error(msg);
      }
    }

    const giveUp = new Error('Could not find a free room code. Please try hosting again.');
    const d2 = traceFinish();
    const giveUpMsg = `${giveUp.message} — Diagnosis ${d2.code}: ${d2.label}`;
    setErrorMessage(giveUpMsg);
    setStatus('error');
    throw new Error(giveUpMsg);
  }, [liveError, pushDiag, resetForAttempt, setMyIdBoth, wireConnection]);

  /* ------------------------------- GUEST ------------------------------- */

  const attemptJoin = useCallback(
    async (code: string, guestName: string, forceRelay: boolean): Promise<void> => {
      const hostId = hostIdFromCode(code);
      const timeout = forceRelay ? RELAY_CONNECT_TIMEOUT_MS : CONNECT_TIMEOUT_MS;
      log(
        `GUEST: joining "${code.toUpperCase()}" → "${hostId}"${
          forceRelay ? ' [forcing TURN relay]' : ''
        }`
      );

      traceEvent('target-host-id', hostId);
      const peer = await openPeer(undefined, 'GUEST', forceRelay, liveError);
      wireDisconnectedHandling(peer, 'GUEST');
      setMyIdBoth(peer.id);

      const conn = peer.connect(hostId, {
        reliable: true,
        metadata: { role: 'guest', name: guestName },
      });
      traceEvent('connect-called', `${hostId}${forceRelay ? ' [relay-only]' : ''}`);
      log('GUEST: peer.connect() issued — awaiting ICE negotiation…');

      detachDiagRef.current?.();
      detachDiagRef.current = attachIceDiagnostics(
        () => (conn as unknown as { peerConnection?: RTCPeerConnection }).peerConnection,
        'GUEST',
        forceRelay,
        pushDiag
      );

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          fn();
        };
        const timer = window.setTimeout(() => {
          const d = diagRef.current;
          const blocked = d.blocked || (!d.stunReachable && !d.turnReachable);
          traceTimeout('connect');
          err(
            `GUEST: connection timed out after ${timeout / 1000}s. ` +
              `stun=${d.stunReachable} turn=${d.turnReachable} ice=${d.iceState}`
          );
          finish(() =>
            reject(
              new Error(
                blocked
                  ? BLOCKED_MESSAGE
                  : `Connection to the host timed out after ${timeout / 1000}s. ` +
                    'The host may have left the lobby.'
              )
            )
          );
        }, timeout);

        conn.on('open', () => finish(resolve));
        conn.on('error', (e) => {
          traceErrorType(peerErrorType(e) || 'connection-error');
          finish(() => reject(friendlyError(e)));
        });
        conn.on('close', () => {
          traceEvent('error-other', 'connection closed before it was established');
          finish(() => reject(new Error('The connection closed before it was established.')));
        });
      });

      traceEvent('datachannel-opened', hostId);
      wireConnection(conn, 'GUEST/conn');
      if (!connectionsRef.current.has(hostId)) {
        connectionsRef.current.set(hostId, conn);
        syncPeers();
      }

      setStatus('connected');
      const msg: PeerMessage = {
        type: 'join',
        from: idRef.current,
        payload: { name: guestName },
        timestamp: Date.now(),
      };
      conn.send(JSON.stringify(msg));
      log('GUEST: connected & join message sent →', msg);
    },
    [liveError, pushDiag, setMyIdBoth, syncPeers, wireConnection]
  );

  const joinGame = useCallback(
    async (code: string, guestName: string): Promise<void> => {
      resetForAttempt();
      setStatus('connecting');
      traceStart('GUEST', `room ${code.toUpperCase()}`);
      try {
        await attemptJoin(code, guestName, false);
        traceFinish();
      } catch (firstError) {
        const d = diagRef.current;
        const looksBlocked =
          d.blocked ||
          d.iceState === 'failed' ||
          (!d.stunReachable && !d.turnReachable) ||
          (d.turnReachable && !d.usingRelay);
        const isRoomMissing = /Room not found/i.test((firstError as Error).message);

        if (isRoomMissing || !looksBlocked) {
          err('GUEST: join failed and does not look like a NAT issue —', (firstError as Error).message);
          const d = traceFinish();
          const msg = `${(firstError as Error).message} — Diagnosis ${d.code}: ${d.label} (stopped at ${d.stoppedAt})`;
          destroyPeer('guest join failed');
          connectionsRef.current.clear();
          setConnectedPeers([]);
          setErrorMessage(msg);
          setStatus('error');
          throw new Error(msg);
        }

        warn('GUEST: direct path blocked — retrying through a TURN relay…');
        traceFinish(); // close attempt #N with its diagnosis before the retry
        traceStart('GUEST', `room ${code.toUpperCase()} — relay-only retry`);
        setErrorMessage('Direct connection blocked — retrying through a relay server…');
        destroyPeer('retrying with TURN relay');
        connectionsRef.current.clear();
        setConnectedPeers([]);

        try {
          await attemptJoin(code, guestName, true);
          traceFinish();
          setErrorMessage(null);
          log('GUEST: relay fallback succeeded');
        } catch (secondError) {
          err('GUEST: relay fallback also failed —', (secondError as Error).message);
          const d = traceFinish();
          destroyPeer('relay fallback failed');
          connectionsRef.current.clear();
          setConnectedPeers([]);
          const finalMsg = `${BLOCKED_MESSAGE} — Diagnosis ${d.code}: ${d.label} (stopped at ${d.stoppedAt})`;
          setErrorMessage(finalMsg);
          setStatus('error');
          throw new Error(finalMsg);
        }
      }
    },
    [attemptJoin, resetForAttempt]
  );

  /* --------------------------- name bookkeeping --------------------------- */

  useEffect(() => {
    const orig = onMessageRef.current;
    onMessageRef.current = (msg) => {
      if (msg.type === 'join' && msg.from) {
        namesRef.current[msg.from] = msg.payload?.name ?? 'Guest';
        syncPeers();
      }
      orig(msg);
    };
    return () => {
      onMessageRef.current = orig;
    };
  }, [syncPeers]);

  /* ---------------------------- messaging ---------------------------- */

  const sendTo = useCallback((peerId: string, data: Omit<PeerMessage, 'from' | 'timestamp'>) => {
    const conn = connectionsRef.current.get(peerId);
    if (!conn?.open) {
      warn(`sendTo: no open connection for "${peerId}" — dropping`, data);
      return;
    }
    const msg: PeerMessage = { ...data, from: idRef.current, timestamp: Date.now() };
    log(`sendTo ${peerId} →`, msg);
    conn.send(JSON.stringify(msg));
  }, []);

  const broadcast = useCallback((data: Omit<PeerMessage, 'from' | 'timestamp'>) => {
    const msg: PeerMessage = { ...data, from: idRef.current, timestamp: Date.now() };
    connectionsRef.current.forEach((conn, pid) => {
      if (conn.open) {
        log(`broadcast → ${pid}`, msg);
        conn.send(JSON.stringify(msg));
      }
    });
  }, []);

  const disconnect = useCallback(() => {
    log('disconnect()');
    detachDiagRef.current?.();
    detachDiagRef.current = null;
    connectionsRef.current.forEach((c) => {
      try {
        c.close();
      } catch {
        /* noop */
      }
    });
    connectionsRef.current.clear();
    destroyPeer('user left');
    namesRef.current = {};
    setConnectedPeers([]);
    setRoomCode('');
    setErrorMessage(null);
    setStatus('idle');
    pushDiag(emptyDiagnostics());
  }, [pushDiag]);

  const clearError = useCallback(() => setErrorMessage(null), []);

  const testNetwork = useCallback(async () => {
    setTestingNetwork(true);
    setNetworkTest(null);
    try {
      const result = await runNetworkTest();
      setNetworkTest(result);
      return result;
    } finally {
      setTestingNetwork(false);
    }
  }, []);

  return {
    status,
    errorMessage,
    myId,
    roomCode,
    connectedPeers,
    diagnostics,
    networkTest,
    testingNetwork,
    hasDedicatedTurn: HAS_CUSTOM_TURN,
    initializeHostWithCode,
    joinGame,
    testNetwork,
    sendTo,
    broadcast,
    disconnect,
    clearError,
    connections: connectionsRef.current,
  };
}
