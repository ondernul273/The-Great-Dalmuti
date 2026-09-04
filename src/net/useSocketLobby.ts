import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  BanquetLobby,
  LobbyChatLine,
  LobbyStats,
  LobbySummary,
  NetMessage,
  ServerStatus,
} from './types';
import { CLIENT_ID } from './identity';

/**
 * Transport #2 — "Banquet Browser": a Socket.IO relay server with public
 * lobby listing, passwords, ready checks and lobby chat.
 *
 * Wire protocol (client ⇄ server):
 *   client → server
 *     lobby:create  { hostName, lobbyName, password, maxPlayers }
 *     lobby:list    {}
 *     lobby:join    { lobbyId, password, name }
 *     lobby:leave   {}
 *     lobby:ready   { ready }
 *     lobby:chat    { text }
 *     lobby:addai   { name }            (host only)
 *     lobby:removeai{ id }              (host only)
 *     lobby:start   {}                  (host only)
 *     game:message  { to, type, payload }   to = 'host' | '*' | <playerId>
 *   server → client
 *     lobby:update  { lobby }           full lobby state
 *     lobby:list    { lobbies }
 *     lobby:chat    { name, text, system? }
 *     lobby:started { lobbyId }
 *     lobby:closed  { reason }
 *     game:message  { from, type, payload }
 *     error         { message }
 */

interface Options {
  onGameMessage: (msg: NetMessage) => void;
  onLobbyChat: (line: Omit<LobbyChatLine, 'id' | 'ts'>) => void;
  onClosed: (reason: string) => void;
  onStarted?: () => void;
  /** A previously-known player reconnected mid-game; the host should resend state. */
  onPlayerReconnected?: (clientId: string) => void;
  /** The relay promoted a new host (old host left). Payload names both parties. */
  onHostChanged?: (p: { newHostId: string; oldHostName: string; newHostName: string }) => void;
}

const CONNECT_TIMEOUT_MS = 9000;

function serverUrl(): string {
  const env = (import.meta.env as unknown as Record<string, string | undefined>)
    .VITE_BANQUET_URL;
  if (env && env.trim()) return env.trim().replace(/\/$/, '');
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

const log = (...a: unknown[]) =>
  console.log('%c[BANQUET]', 'color:#c084fc;font-weight:bold', ...a);
const errLog = (...a: unknown[]) =>
  console.error('%c[BANQUET]', 'color:#f87171;font-weight:bold', ...a);

export function useSocketLobby({
  onGameMessage,
  onLobbyChat,
  onClosed,
  onStarted,
  onPlayerReconnected,
  onHostChanged,
}: Options) {
  const socketRef = useRef<Socket | null>(null);
  const [serverStatus, setServerStatus] = useState<ServerStatus>('offline');
  const [error, setError] = useState<string | null>(null);
  // Stable across reconnects/refreshes — this is the identity the game uses,
  // NOT the raw (and ever-changing) Socket.IO `socket.id`.
  const [myId] = useState(CLIENT_ID);
  const [lobby, setLobby] = useState<BanquetLobby | null>(null);
  const [lobbies, setLobbies] = useState<LobbySummary[]>([]);
  const [listing, setListing] = useState(false);
  const [stats, setStats] = useState<LobbyStats>({ activeLobbies: 0, playersOnline: 0 });

  const cbRef = useRef({
    onGameMessage,
    onLobbyChat,
    onClosed,
    onStarted,
    onPlayerReconnected,
    onHostChanged,
  });
  cbRef.current = {
    onGameMessage,
    onLobbyChat,
    onClosed,
    onStarted,
    onPlayerReconnected,
    onHostChanged,
  };

  /* ------------------------- socket lifecycle ------------------------- */

  const attach = useCallback((socket: Socket) => {
    socket.on('connect', () => {
      log('connected to banquet server — socket id', socket.id, '(clientId', CLIENT_ID, ')');
      setServerStatus('online');
      setError(null);
      socket.emit('stats:get', {});
    });
    socket.on('connect_error', (e) => {
      errLog('connect_error —', e.message);
      setServerStatus('error');
      setError(
        `Could not reach the banquet server (${serverUrl()}). ` +
          'Run server/banquet-server.mjs or set VITE_BANQUET_URL.'
      );
    });
    socket.on('disconnect', (reason) => {
      log('disconnected —', reason);
      setServerStatus((s) => (s === 'error' ? s : 'offline'));
    });
    socket.on('lobby:update', (l: BanquetLobby) => {
      log('lobby:update', l?.id, l?.players?.length, 'players');
      setLobby(l);
    });
    socket.on('lobby:list', (p: { lobbies: LobbySummary[] }) => {
      setLobbies(p?.lobbies ?? []);
      setListing(false);
    });
    socket.on('stats:update', (p: LobbyStats) => {
      if (p) setStats(p);
    });
    socket.on('lobby:playerReconnected', (p: { clientId: string }) => {
      if (p?.clientId) cbRef.current.onPlayerReconnected?.(p.clientId);
    });
    socket.on(
      'lobby:hostChanged',
      (p: { newHostId: string; oldHostName: string; newHostName: string }) => {
        log('lobby:hostChanged →', p?.newHostName);
        if (p?.newHostId) cbRef.current.onHostChanged?.(p);
      }
    );
    socket.on('lobby:chat', (p: { name: string; text: string; system?: boolean }) => {
      cbRef.current.onLobbyChat({ name: p.name, text: p.text, system: p.system });
    });
    socket.on('lobby:started', () => {
      log('lobby:started');
      cbRef.current.onStarted?.();
    });
    socket.on('lobby:closed', (p: { reason?: string }) => {
      log('lobby:closed —', p?.reason);
      setLobby(null);
      cbRef.current.onClosed(p?.reason ?? 'The lobby was closed.');
    });
    socket.on('game:message', (p: { from: string; type: string; payload: any }) => {
      cbRef.current.onGameMessage({
        type: p.type,
        from: p.from,
        payload: p.payload,
        timestamp: Date.now(),
      });
    });
    socket.on('error', (p: { message?: string }) => {
      errLog('server error —', p?.message);
      setError(p?.message ?? 'The banquet server returned an error.');
      setServerStatus('error');
    });
  }, []);

  const ensureSocket = useCallback((): Socket => {
    if (socketRef.current) return socketRef.current;
    const url = serverUrl();
    log('creating socket.io client →', url);
    const socket = io(url, {
      autoConnect: true,
      transports: ['websocket', 'polling'],
      timeout: CONNECT_TIMEOUT_MS,
      reconnectionAttempts: 3,
    });
    socketRef.current = socket;
    attach(socket);
    setServerStatus((s) => (s === 'online' ? s : 'connecting'));
    return socket;
  }, [attach]);

  const whenConnected = useCallback(
    (): Promise<Socket> =>
      new Promise((resolve, reject) => {
        const socket = ensureSocket();
        if (socket.connected) {
          resolve(socket);
          return;
        }
        const timer = window.setTimeout(() => {
          socket.off('connect', ok);
          reject(
            new Error(
              `The banquet server at ${serverUrl()} did not answer in ${
                CONNECT_TIMEOUT_MS / 1000
              }s. Is it running?`
            )
          );
        }, CONNECT_TIMEOUT_MS);
        const ok = () => {
          window.clearTimeout(timer);
          resolve(socket);
        };
        socket.once('connect', ok);
      }),
    [ensureSocket]
  );

  useEffect(() => {
    return () => {
      // The socket survives StrictMode remounts; it is only closed on unload.
    };
  }, []);

  /* ----------------------------- actions ----------------------------- */

  const createLobby = useCallback(
    async (opts: { hostName: string; lobbyName: string; password: string; maxPlayers: number }) => {
      setError(null);
      setServerStatus('connecting');
      const socket = await whenConnected();
      log('lobby:create →', opts);
      socket.emit('lobby:create', { ...opts, clientId: CLIENT_ID });
    },
    [whenConnected]
  );

  const refreshLobbies = useCallback(async () => {
    setError(null);
    setListing(true);
    try {
      const socket = await whenConnected();
      socket.emit('lobby:list', {});
    } catch (e) {
      setListing(false);
      setServerStatus('error');
      setError((e as Error).message);
      throw e;
    }
  }, [whenConnected]

  );

  const joinLobby = useCallback(
    async (lobbyId: string, password: string, name: string) => {
      setError(null);
      setServerStatus('connecting');
      const socket = await whenConnected();
      log('lobby:join →', lobbyId);
      socket.emit('lobby:join', { lobbyId, password, name, clientId: CLIENT_ID });
    },
    [whenConnected]
  );

  const leaveLobby = useCallback(() => {
    socketRef.current?.emit('lobby:leave', {});
    setLobby(null);
  }, []);

  const setReady = useCallback((ready: boolean) => {
    socketRef.current?.emit('lobby:ready', { ready });
  }, []);

  const sendChat = useCallback((text: string) => {
    socketRef.current?.emit('lobby:chat', { text });
  }, []);

  const addAI = useCallback((name: string) => {
    socketRef.current?.emit('lobby:addai', { name });
  }, []);

  const removeAI = useCallback((id: string) => {
    socketRef.current?.emit('lobby:removeai', { id });
  }, []);

  const startGame = useCallback(() => {
    log('lobby:start');
    socketRef.current?.emit('lobby:start', {});
  }, []);

  /** Host: reopen the lobby between games (keeps everyone connected, resets ready). */
  const reopenLobby = useCallback(() => {
    log('lobby:reopen');
    socketRef.current?.emit('lobby:reopen', {});
  }, []);

  /* --------------------- game traffic (unified) --------------------- */

  const sendGame = useCallback((to: string, type: string, payload: unknown) => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      errLog('sendGame dropped — not connected', type);
      return;
    }
    log(`game:message → ${to} : ${type}`);
    socket.emit('game:message', { to, type, payload });
  }, []);

  const broadcastGame = useCallback(
    (type: string, payload: unknown) => sendGame('*', type, payload),
    [sendGame]
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    serverStatus,
    error,
    myId,
    lobby,
    lobbies,
    listing,
    stats,
    createLobby,
    refreshLobbies,
    joinLobby,
    leaveLobby,
    setReady,
    sendChat,
    addAI,
    removeAI,
    startGame,
    reopenLobby,
    sendGame,
    broadcastGame,
    clearError,
    serverUrl: serverUrl(),
  };
}

export type SocketLobbyApi = ReturnType<typeof useSocketLobby>;
