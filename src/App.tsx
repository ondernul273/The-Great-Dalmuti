import { useState, useEffect, useCallback, useRef, useMemo, useReducer, Component } from 'react';
import type { ReactNode } from 'react';
import { Lobby } from './components/Lobby';
import { GameTable } from './components/GameTable';
import type { Card, ChatMessage, GameState, Player, RosterEntry } from './game/types';
import {
  initializeNewGame,
  startDealing,
  startTaxation,
  applyPlay,
  applyPass,
  reseatForNextHand,
  submitTribute,
  applyRevolution,
  applyKick,
  setLeaveIntent,
  MAX_PLAYERS,
  MIN_PLAYERS,
} from './game/logic';
import { countJesters } from './game/cards';
import {
  aiDecide,
  aiSelectGreaterDalmutiTax,
  aiSelectLesserDalmutiTax,
  shouldCallRevolution,
  type AIContext,
} from './game/ai';
import { useMultiplayer } from './hooks/useMultiplayer';
import type { PeerMessage } from './hooks/useMultiplayer';
import { useSocketLobby } from './net/useSocketLobby';
import type { LobbyChatLine } from './net/types';
import {
  CLIENT_ID,
  clearSession,
  clearSnapshot,
  loadSession,
  loadSnapshot,
  saveSession,
  saveSnapshot,
} from './net/identity';
import { recordHandOutcome } from './game/stats';
import { getActiveSet, rememberSet, setThemeOverride, subscribeToCardArt } from './components/cardAssets';

type GameMode =
  | 'none'
  | 'local-ai'
  | 'online-host'
  | 'online-guest'
  | 'banquet-lobby-host'
  | 'banquet-lobby-guest'
  | 'banquet-host'
  | 'banquet-guest';

const MAX_SEATS = MAX_PLAYERS;
const isAI = (id: string) => id.startsWith('ai-');
const isHostMode = (m: GameMode) => m === 'online-host' || m === 'banquet-host';
const isGuestMode = (m: GameMode) => m === 'online-guest' || m === 'banquet-guest';
const inBanquetLobby = (m: GameMode) =>
  m === 'banquet-lobby-host' || m === 'banquet-lobby-guest';
const inGameMode = (m: GameMode) => isHostMode(m) || isGuestMode(m) || m === 'local-ai';
const DEAL_DURATION_MS = 80 * 45 + 500;
const RESUME_TIMEOUT_MS = 12_000;
const GUEST_RETRY_DELAYS_MS = [1500, 3000, 5000, 8000, 8000, 8000];

const AI_NAMES = ['Guinevere', 'Arthur', 'Merlin', 'Morgause', 'Lancelot', 'Elaine', 'Percival', 'Gawain'];
const AI_OUT_LINES = [
  'I am out! Glory to my house!',
  'My cards are gone — farewell!',
  'Ha! Nothing left in my hand!',
  'The realm shall hear of this victory!',
];
const AI_REVOLT_LINES = [
  'Two Jesters! REVOLUTION!',
  'The peons rise up today!',
  'I hold both Jesters — down with taxes!',
];

let chatIdCounter = 0;
function nextChatId() {
  chatIdCounter += 1;
  return `chat-${chatIdCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

/* ------------------------- error boundary ------------------------- */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 flex items-center justify-center p-6 text-center" style={{ background: '#1a0a2e' }}>
          <div className="bg-amber-50 rounded-xl p-6 max-w-md border-4 border-red-700">
            <h1 className="font-bold text-red-800 text-xl mb-2">The table collapsed!</h1>
            <p className="text-amber-900 text-sm mb-3 font-serif">{String(this.state.error)}</p>
            <button
              className="px-4 py-2 bg-purple-800 text-amber-100 rounded font-bold"
              onClick={() => window.location.reload()}
            >
              Reload game
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function firstConnectionId(conns: Map<string, unknown>): string {
  for (const key of conns.keys()) return key;
  return '';
}

/** Picks the first `count` entries (join order) as active seats — the rest spectate. */
function splitActiveSpectators<T>(list: T[], count: number): { active: T[]; spectators: T[] } {
  return { active: list.slice(0, count), spectators: list.slice(count) };
}

export default function App() {
  const [myName, setMyName] = useState('Player');
  const [mode, setMode] = useState<GameMode>('none');
  const [state, setState] = useState<GameState | null>(null);
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const [peerNames, setPeerNames] = useState<Record<string, string>>({});
  const [declinedRevolution, setDeclinedRevolution] = useState<number>(-1);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [lobbyChat, setLobbyChat] = useState<LobbyChatLine[]>([]);
  const [aiSeats, setAiSeats] = useState<{ id: string; name: string }[]>([]);
  const [lobbyRoster, setLobbyRoster] = useState<RosterEntry[]>([]);
  const [timerOn, setTimerOn] = useState(true);
  const [timerSecs, setTimerSecs] = useState(60);
  const [kickedInfo, setKickedInfo] = useState<{ kind: 'remove' | 'ai' } | null>(null);
  const [resuming, setResuming] = useState(false);
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);
  const aiCounterRef = useRef(0);
  const seenChatRef = useRef<Set<string>>(new Set());

  const modeRef = useRef<GameMode>('none');
  modeRef.current = mode;
  const stateRef = useRef<GameState | null>(null);
  stateRef.current = state;
  const myNameRef = useRef(myName);
  myNameRef.current = myName;

  /** Direct Connect only: peerId ⇄ clientId, built passively from every inbound message that carries one. */
  const peerToClientRef = useRef<Record<string, string>>({});
  const clientToPeerRef = useRef<Record<string, string>>({});

  /** Exactly-once chat: transport relays can deliver a message twice, so dedupe by id. */
  const pushChat = useCallback(
    (msg: { name: string; text: string; system?: boolean; mine?: boolean; id?: string }) => {
      const id = msg.id ?? nextChatId();
      if (seenChatRef.current.has(id)) {
        console.log('[CHAT] duplicate suppressed', id);
        return;
      }
      if (seenChatRef.current.size > 600) seenChatRef.current.clear();
      seenChatRef.current.add(id);
      console.log('[CHAT] rendered', id, msg.name, ':', msg.text);
      setChat((prev) => [...prev.slice(-140), { ...msg, id, ts: Date.now() }]);
    },
    []
  );

  const pushLobbyChat = useCallback((line: Omit<LobbyChatLine, 'id' | 'ts'>) => {
    setLobbyChat((prev) => [...prev.slice(-120), { ...line, id: nextChatId(), ts: Date.now() }]);
  }, []);

  /* =====================================================================
     TRANSPORT ABSTRACTION
     The game logic below only ever uses these primitives. Which transport
     (PeerJS Direct Connect or Socket.IO Banquet Browser) satisfies them
     depends on the current GameMode. Player identity (GameState.players[].id)
     is always the persisted CLIENT_ID, independent of the transport's own
     connection id — that decoupling is what makes reconnect-after-refresh
     possible on both transports.
     ===================================================================== */

  /** Direct Connect: resolve a clientId to its current peerId (best-effort). */
  const resolvePeerId = useCallback((clientId: string): string => {
    return clientToPeerRef.current[clientId] ?? clientId;
  }, []);

  const netSendToAllExcept = useCallback((exceptPeerId: string, type: string, payload: unknown) => {
    const m = modeRef.current;
    if (m === 'online-host') {
      peerRef.current?.connectedPeers.forEach((p) => {
        if (p.id !== exceptPeerId) peerRef.current?.sendTo(p.id, { type, payload });
      });
    } else if (m === 'banquet-host') {
      sockRef.current?.lobby?.players.forEach((p) => {
        if (p.id !== exceptPeerId && !p.isAI) sockRef.current?.sendGame(p.id, type, payload);
      });
    }
  }, []);

  const netBroadcast = useCallback((type: string, payload: unknown) => {
    const m = modeRef.current;
    if (m === 'online-host') peerRef.current?.broadcast({ type, payload });
    else if (m === 'banquet-host') sockRef.current?.broadcastGame(type, payload);
  }, []);

  const netSendToHost = useCallback((type: string, payload: unknown) => {
    const m = modeRef.current;
    if (m === 'online-guest') {
      const h = firstConnectionId(peerRef.current?.connections ?? new Map());
      if (h) peerRef.current?.sendTo(h, { type, payload });
    } else if (m === 'banquet-guest' || m === 'banquet-lobby-guest') {
      sockRef.current?.sendGame('host', type, payload);
    }
  }, []);

  /** Host → a specific game-identity player (clientId), on whichever transport is active. */
  const netSendToPlayer = useCallback(
    (clientId: string, type: string, payload: unknown) => {
      const m = modeRef.current;
      if (m === 'online-host') peerRef.current?.sendTo(resolvePeerId(clientId), { type, payload });
      else if (m === 'banquet-host') sockRef.current?.sendGame(clientId, type, payload);
    },
    [resolvePeerId]
  );

  /** Broadcast to everyone in the current room, host or guest-side lobby alike. */
  const netBroadcastRoom = useCallback((type: string, payload: unknown) => {
    const m = modeRef.current;
    if (m === 'online-host' || m === 'online-guest') peerRef.current?.broadcast({ type, payload });
    else if (m.startsWith('banquet')) sockRef.current?.broadcastGame(type, payload);
  }, []);

  /* ------------------------- card set (table-wide) ------------------------- */

  const applyCardSet = useCallback((set: string, persist: boolean) => {
    setThemeOverride(set);
    if (persist) rememberSet(set);
  }, []);

  /* --------------------------- transports --------------------------- */

  const peerRef = useRef<ReturnType<typeof useMultiplayer> | null>(null);
  const sockRef = useRef<ReturnType<typeof useSocketLobby> | null>(null);
  const netMessageRef = useRef<(m: PeerMessage) => void>(() => {});
  const lobbyChatRef = useRef<(l: Omit<LobbyChatLine, 'id' | 'ts'>) => void>(() => {});
  const closedRef = useRef<(reason: string) => void>(() => {});
  const reconnectedRef = useRef<(clientId: string) => void>(() => {});
  const connectionLostRef = useRef<() => void>(() => {});
  const hostChangedRef = useRef<(p: { newHostId: string; oldHostName: string; newHostName: string }) => void>(
    () => {}
  );
  /** Last roster the host broadcast — join order, used to pick a DC successor. */
  const lastRosterRef = useRef<RosterEntry[]>([]);
  /** Notice a freshly-promoted host hands to every peer that (re)joins. */
  const hostChangeNoticeRef = useRef<string | null>(null);
  /** True once this session took over hosting, so we trust our own promotion. */
  const promotedRef = useRef(false);

  const peer = useMultiplayer({
    onMessage: (m) => netMessageRef.current(m),
    onAllConnectionsLost: () => connectionLostRef.current(),
  });
  peerRef.current = peer;

  const sock = useSocketLobby({
    onGameMessage: (m) => netMessageRef.current(m),
    onLobbyChat: (l) => lobbyChatRef.current(l),
    onClosed: (reason) => closedRef.current(reason),
    onPlayerReconnected: (clientId) => reconnectedRef.current(clientId),
    onHostChanged: (p) => hostChangedRef.current(p),
  });
  sockRef.current = sock;

  const broadcastState = useCallback((next: GameState) => {
    if (isHostMode(modeRef.current)) netBroadcast('state', next);
  }, [netBroadcast]);

  const hostReduce = useCallback(
    (reducer: (prev: GameState) => GameState) => {
      setState((prev) => {
        if (!prev) return prev;
        const next = reducer(prev);
        if (next !== prev) broadcastState(next);
        return next;
      });
    },
    [broadcastState]
  );

  /** Choose a card set for the whole table (host applies, guests propose). */
  const handleCardSetChoice = useCallback(
    (set: string) => {
      applyCardSet(set, true);
      const m = modeRef.current;
      if (m === 'local-ai' || m === 'none') return;
      if (isHostMode(m)) {
        // In-game: stamp it into the authoritative state (broadcasts with it).
        if (stateRef.current) {
          hostReduce((prev) => (prev.cardSet === set ? prev : { ...prev, cardSet: set }));
        } else {
          netBroadcastRoom('card-set', { set });
        }
      } else {
        // Guests propose; the host applies and re-broadcasts to everyone.
        netSendToHost('set-card-set', { set });
      }
    },
    [applyCardSet, hostReduce, netBroadcastRoom, netSendToHost]
  );

  /* --------------------- unified message router --------------------- */

  const handleNetMessage = useCallback(
    (msg: PeerMessage) => {
      const m = modeRef.current;
      const payload = (msg.payload ?? {}) as Record<string, unknown>;

      // Passively learn peerId ⇄ clientId for Direct Connect (Banquet's `from`
      // is already the stable clientId, stamped server-side).
      const carriedClientId = typeof payload.clientId === 'string' ? payload.clientId : undefined;
      if (carriedClientId && m === 'online-host') {
        peerToClientRef.current[msg.from] = carriedClientId;
        clientToPeerRef.current[carriedClientId] = msg.from;
      }
      const actingId = carriedClientId ?? msg.from;

      if (msg.type === 'state') {
        if (m === 'online-guest' || m === 'banquet-guest' || m === 'banquet-lobby-guest') {
          if (m === 'banquet-lobby-guest') {
            modeRef.current = 'banquet-guest';
            setMode('banquet-guest');
          }
          setState(msg.payload as GameState);
          setResuming(false);
        }
        return;
      }

      if (msg.type === 'request-state') {
        if (isHostMode(m) && stateRef.current) {
          netSendToPlayer(actingId, 'state', stateRef.current);
        }
        return;
      }

      if (msg.type === 'chat') {
        const p = msg.payload as { name: string; text: string; system?: boolean; id?: string };
        console.log('[CHAT] received', p.id ?? '(no id)', 'mode:', m, 'from:', msg.from);
        if (isHostMode(m)) {
          const withId = { ...p, id: p.id ?? nextChatId() };
          pushChat(withId);
          netSendToAllExcept(msg.from, 'chat', withId);
        } else if (isGuestMode(m)) {
          pushChat(p);
        }
        return;
      }

      if (msg.type === 'kicked') {
        if (isGuestMode(m)) {
          setKickedInfo((msg.payload as { kind: 'remove' | 'ai' }) ?? { kind: 'remove' });
        }
        return;
      }

      if (msg.type === 'return-lobby') {
        if (isGuestMode(m)) {
          console.log('[MP] host returned everyone to the lobby');
          setState(null);
          const next: GameMode = m === 'banquet-guest' ? 'banquet-lobby-guest' : 'online-guest';
          modeRef.current = next;
          setMode(next);
          setDeclinedRevolution(-1);
          setKickedInfo(null);
        }
        return;
      }

      if (msg.type === 'lobby' && (m === 'online-guest' || m === 'online-host')) {
        const r = (msg.payload as { roster?: RosterEntry[] }).roster ?? [];
        if (m === 'online-guest') {
          setLobbyRoster(r);
          lastRosterRef.current = r; // join order = succession order if the host vanishes
        }
        return;
      }

      /* ---- card set sync: host applies + rebroadcasts, everyone applies ---- */
      if (msg.type === 'set-card-set') {
        const set = String((msg.payload as { set?: string }).set ?? 'default');
        if (isHostMode(m) || m === 'banquet-lobby-host') {
          applyCardSet(set, false);
          if (stateRef.current) {
            hostReduce((prev) => (prev.cardSet === set ? prev : { ...prev, cardSet: set }));
          } else {
            netSendToAllExcept(msg.from, 'card-set', { set });
          }
        }
        return;
      }
      if (msg.type === 'card-set') {
        applyCardSet(String((msg.payload as { set?: string }).set ?? 'default'), false);
        return;
      }

      if (!isHostMode(m)) return;

      if (msg.type === 'join') {
        const name = (payload.name as string | undefined) || 'Guest';
        const cid = carriedClientId;
        // If a game is already running and this clientId already holds a
        // seat, this is a RECONNECT (browser refresh), not a fresh join:
        // resend the authoritative state instead of touching the roster.
        if (cid && stateRef.current && stateRef.current.players.some((p) => p.id === cid)) {
          console.log('[MP] recognised reconnecting player', cid);
          netSendToPlayer(cid, 'state', stateRef.current);
          const rejoinName = stateRef.current.players.find((p) => p.id === cid)?.name ?? name;
          const cid2 = nextChatId();
          pushChat({ name: 'Herald', text: `${rejoinName} reconnects to the table.`, system: true, id: cid2 });
          netSendToAllExcept(msg.from, 'chat', { name: 'Herald', text: `${rejoinName} reconnects to the table.`, system: true, id: cid2 });
          return;
        }
        setPeerNames((prev) => ({ ...prev, [msg.from]: name }));
        // A promoted host hands the succession notice to peers as they (re)join.
        if (hostChangeNoticeRef.current) {
          const notice = hostChangeNoticeRef.current;
          peerRef.current?.sendTo(msg.from, {
            type: 'chat',
            payload: { name: 'Herald', text: notice, system: true, id: nextChatId() },
          });
        }
        return;
      }

      if (msg.type === 'schedule-leave') {
        const queued = !!payload.queued;
        hostReduce((prev) => setLeaveIntent(prev, actingId, queued));
        return;
      }

      if (msg.type === 'action') {
        const a = msg.payload as { kind: string; cards?: Card[]; greaterRevolution?: boolean };
        hostReduce((prev) => {
          if (a.kind === 'play' && a.cards) return applyPlay(prev, actingId, a.cards);
          if (a.kind === 'pass') return applyPass(prev, actingId);
          if (a.kind === 'revolution') return applyRevolution(prev, !!a.greaterRevolution);
          if (a.kind === 'tribute' && a.cards) return submitTribute(prev, actingId, a.cards);
          return prev;
        });
      }
    },
    [hostReduce, pushChat, netSendToAllExcept, netSendToPlayer]
  );
  netMessageRef.current = handleNetMessage;
  lobbyChatRef.current = pushLobbyChat;

  /* --------------------- lobby closed / connection lost --------------------- */

  const handleBackToLobby = useCallback(() => {
    setState(null);
    setMode('none');
    modeRef.current = 'none';
    setDeclinedRevolution(-1);
    setChat([]);
    setLobbyChat([]);
    setAiSeats([]);
    setLobbyRoster([]);
    setKickedInfo(null);
    setResuming(false);
    setResumeNotice(null);
    clearSession();
    clearSnapshot();
    peer.disconnect();
    sock.leaveLobby();
  }, [peer, sock]);

  closedRef.current = (reason: string) => {
    pushLobbyChat({ name: 'Herald', text: reason, system: true });
    if (modeRef.current !== 'none' && modeRef.current !== 'local-ai') {
      setLobbyError(reason);
      setState(null);
      setMode('none');
      modeRef.current = 'none';
      clearSession();
      clearSnapshot();
    }
  };

  /** Host (either transport) resumed after its own refresh — resync everyone. */
  reconnectedRef.current = (clientId: string) => {
    if (modeRef.current === 'banquet-host' && stateRef.current) {
      console.log('[MP] a player reconnected — resending authoritative state to', clientId);
      sock.sendGame(clientId, 'state', stateRef.current);
    }
  };

  /* ------------------- guest: auto-reconnect on connection loss ------------------- */

  const guestRetryRef = useRef<{ attempt: number; timer: ReturnType<typeof setTimeout> | null }>({
    attempt: 0,
    timer: null,
  });

  const attemptGuestReconnect = useCallback(() => {
    if (modeRef.current !== 'online-guest') return;
    const session = loadSession();
    if (!session || session.transport !== 'direct' || !session.code) return;
    const attempt = guestRetryRef.current.attempt;
    if (attempt >= GUEST_RETRY_DELAYS_MS.length) {
      setResumeNotice('Could not reach the host again. Returning to the menu.');
      handleBackToLobby();
      return;
    }
    const delay = GUEST_RETRY_DELAYS_MS[attempt];
    guestRetryRef.current.attempt += 1;
    setResumeNotice(`Reconnecting to the host… (attempt ${attempt + 1})`);
    guestRetryRef.current.timer = setTimeout(() => {
      peer
        .joinGame(session.code!, session.name)
        .then(() => {
          guestRetryRef.current.attempt = 0;
          setResumeNotice(null);
        })
        .catch(() => attemptGuestReconnect());
    }, delay);
  }, [peer, handleBackToLobby]);

  /**
   * Direct Connect host succession. The roster the host broadcasts is in join
   * order, so every guest independently computes the same successor: the
   * longest-connected human after the host. That guest re-registers the room
   * code and adopts the state it already holds as authoritative; everyone else
   * retries joining the (now re-registered) room.
   */
  const promoteSelfToHostDC = useCallback(
    (code: string, oldHostName: string) => {
      const myNameNow = myNameRef.current;
      promotedRef.current = true;
      console.log('[MP] Direct Connect succession — this client becomes host');
      const notice = `${oldHostName} left the game. ${myNameNow} is now the host.`;
      hostChangeNoticeRef.current = notice;
      pushChat({ name: 'Herald', text: notice, system: true });
      modeRef.current = 'online-host';
      setMode('online-host');
      saveSession({ transport: 'direct', role: 'host', code, name: myNameNow });
      peer
        .initializeHostWithCode(code)
        .then(() => {
          if (stateRef.current) broadcastState(stateRef.current);
          netBroadcastRoom('chat', { name: 'Herald', text: notice, system: true, id: nextChatId() });
        })
        .catch((e: Error) => {
          console.error('[MP] succession failed to re-register room', e);
          setLobbyError(`Could not take over hosting: ${e.message}`);
        });
    },
    [peer, broadcastState, netBroadcastRoom, pushChat]
  );

  connectionLostRef.current = () => {
    const m = modeRef.current;
    if (m !== 'online-guest') return;
    const session = loadSession();
    const roster = lastRosterRef.current;
    const humans = roster.filter((r) => r.kind !== 'ai');
    const successor = humans[1]; // humans[0] is the (lost) host
    console.log('[MP] lost connection to host — successor candidate:', successor?.id);
    if (successor && successor.id === CLIENT_ID && session?.code) {
      promoteSelfToHostDC(session.code, humans[0]?.name ?? 'The host');
      return;
    }
    if (stateRef.current || session?.code) {
      console.log('[MP] attempting to reconnect to the (possibly new) host…');
      attemptGuestReconnect();
    }
  };

  /** Banquet Browser: the relay promoted a successor; take over if it's us. */
  hostChangedRef.current = ({ newHostId, oldHostName, newHostName }) => {
    if (newHostId !== CLIENT_ID) return; // guests learn via the Herald chat line
    const inGame = !!stateRef.current;
    promotedRef.current = true;
    console.log('[MP] Banquet succession — this client becomes host');
    modeRef.current = inGame ? 'banquet-host' : 'banquet-lobby-host';
    setMode(modeRef.current);
    saveSession({
      transport: 'banquet',
      role: 'host',
      lobbyId: sockRef.current?.lobby?.id,
      name: myNameRef.current,
    });
    if (inGame) {
      const notice = `${oldHostName} left the game. ${newHostName} is now the host.`;
      pushChat({ name: 'Herald', text: notice, system: true });
      netBroadcastRoom('chat', { name: 'Herald', text: notice, system: true, id: nextChatId() });
      // Re-assert authority: guests already hold our last broadcast state.
      if (stateRef.current) broadcastState(stateRef.current);
    }
  };

  /* ------------------------------- setup -------------------------------- */

  const startAIGame = useCallback(
    (numAI: number) => {
      const players: Player[] = [
        { id: 'human', name: myName.trim() || 'Player', hand: [], isHost: true, isOut: false },
      ];
      for (let i = 0; i < numAI; i++) {
        players.push({
          id: `ai-${i}`,
          name: AI_NAMES[i % AI_NAMES.length],
          hand: [],
          isHost: false,
          isOut: false,
        });
      }
      const next = initializeNewGame(players, {
        timerEnabled: timerOn,
        timerSeconds: timerSecs,
        cardSet: getActiveSet(),
      });
      setDeclinedRevolution(-1);
      setChat([]);
      setKickedInfo(null);
      pushChat({ name: 'Herald', text: `A new game begins with ${players.length} players.`, system: true });
      setMode('local-ai');
      modeRef.current = 'local-ai';
      setState(next);
    },
    [myName, pushChat, timerOn, timerSecs]
  );

  const startHostedGame = useCallback(() => {
    const hostPlayer: Player = {
      id: CLIENT_ID,
      name: myName.trim() || 'Host',
      hand: [],
      isHost: true,
      isOut: false,
    };
    const guests: Player[] = peer.connectedPeers.map((p) => ({
      id: peerToClientRef.current[p.id] ?? p.id,
      name: peerNames[p.id] || 'Guest',
      hand: [],
      isHost: false,
      isOut: false,
    }));
    const ais: Player[] = aiSeats.map((a) => ({
      id: a.id,
      name: a.name,
      hand: [],
      isHost: false,
      isOut: false,
    }));
    const { active, spectators } = splitActiveSpectators([hostPlayer, ...guests, ...ais], MAX_SEATS);
    const next = initializeNewGame(active, {
      timerEnabled: timerOn,
      timerSeconds: timerSecs,
      cardSet: getActiveSet(),
    });
    setDeclinedRevolution(-1);
    setChat([]);
    setKickedInfo(null);
    pushChat({
      name: 'Herald',
      text:
        `A new game begins with ${active.length} players.` +
        (spectators.length > 0 ? ` ${spectators.length} will spectate this game.` : ''),
      system: true,
    });
    saveSession({ transport: 'direct', role: 'host', code: peer.roomCode, name: myName.trim() || 'Host' });
    setState(next);
    modeRef.current = 'online-host';
    setMode('online-host');
    broadcastState(next);
  }, [peer.connectedPeers, peer.roomCode, myName, peerNames, aiSeats, broadcastState, pushChat, timerOn, timerSecs]);

  /* --------------------- banquet (socket) session --------------------- */

  const startBanquetGame = useCallback(() => {
    const lobby = sock.lobby;
    if (!lobby) return;
    const players: Player[] = lobby.players.map((p) => ({
      id: p.id,
      name: p.name,
      hand: [],
      isHost: p.id === sock.myId,
      isOut: false,
    }));
    const { active, spectators } = splitActiveSpectators(players, MAX_SEATS);
    sock.startGame();
    const next = initializeNewGame(active, {
      timerEnabled: timerOn,
      timerSeconds: timerSecs,
      cardSet: getActiveSet(),
    });
    setDeclinedRevolution(-1);
    setChat([]);
    setKickedInfo(null);
    pushChat({
      name: 'Herald',
      text:
        `The banquet begins with ${active.length} players.` +
        (spectators.length > 0 ? ` ${spectators.length} will spectate this game.` : ''),
      system: true,
    });
    saveSession({ transport: 'banquet', role: lobby.hostId === sock.myId ? 'host' : 'guest', lobbyId: lobby.id, name: myName.trim() || 'Player' });
    modeRef.current = 'banquet-host';
    setMode('banquet-host');
    setState(next);
    broadcastState(next);
  }, [sock, broadcastState, pushChat, timerOn, timerSecs, myName]);

  // Follow the socket lobby in/out of the room screens.
  useEffect(() => {
    if (sock.lobby && (mode === 'none' || mode === 'banquet-lobby-host' || mode === 'banquet-lobby-guest')) {
      const mine = sock.lobby.players.find((p) => p.id === sock.myId);
      const next: GameMode = mine?.isHost ? 'banquet-lobby-host' : 'banquet-lobby-guest';
      if (modeRef.current !== next) {
        modeRef.current = next;
        setMode(next);
      }
      setLobbyError(null);
      saveSession({
        transport: 'banquet',
        role: mine?.isHost ? 'host' : 'guest',
        lobbyId: sock.lobby.id,
        name: myName.trim() || 'Player',
      });
    }
    if (!sock.lobby && inBanquetLobby(mode)) {
      modeRef.current = 'none';
      setMode('none');
    }
  }, [sock.lobby, sock.myId, mode, myName]);

  /* ------------------- lobby roster: AI (direct mode) ------------------- */

  const addAI = useCallback(() => {
    setAiSeats((prev) => {
      if (prev.length + peer.connectedPeers.length + 1 >= MAX_SEATS) return prev;
      const used = new Set(prev.map((a) => a.name));
      const name = AI_NAMES.find((n) => !used.has(n)) ?? `Courtier ${prev.length + 1}`;
      aiCounterRef.current += 1;
      return [...prev, { id: `ai-h${aiCounterRef.current}`, name }];
    });
  }, [peer.connectedPeers.length]);

  const removeAI = useCallback((id: string) => {
    setAiSeats((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const roster = useMemo<RosterEntry[]>(() => {
    if (mode === 'online-host') {
      return [
        { id: CLIENT_ID, name: myName.trim() || 'Host', kind: 'host' },
        ...peer.connectedPeers.map((p) => ({
          id: p.id,
          name: peerNames[p.id] || 'Guest',
          kind: 'human' as const,
        })),
        ...aiSeats.map((a) => ({ id: a.id, name: a.name, kind: 'ai' as const })),
      ];
    }
    if (mode === 'online-guest') return lobbyRoster;
    return [];
  }, [mode, myName, peer.connectedPeers, peerNames, aiSeats, lobbyRoster]);

  useEffect(() => {
    if (mode !== 'online-host') return;
    peer.broadcast({ type: 'lobby', payload: { roster } });
  }, [mode, roster, peer]);

  /* -------------------- seating reveal -> dealing ---------------------- */
  useEffect(() => {
    if (!state || state.phase !== 'seating') return;
    if (isGuestMode(mode) || inBanquetLobby(mode)) return;
    const delay = Math.max(6000, state.players.length * 900 + 4000);
    const t = setTimeout(() => {
      hostReduce((prev) => (prev.phase === 'seating' ? startDealing(prev) : prev));
    }, delay);
    return () => clearTimeout(t);
  }, [state?.phase, state?.handNumber, state?.players.length, mode, hostReduce, state]);

  const handleContinueSeating = useCallback(() => {
    if (isGuestMode(mode)) return;
    hostReduce((prev) => (prev.phase === 'seating' ? startDealing(prev) : prev));
  }, [mode, hostReduce]);

  /* -------------------- dealing phase -> taxation ---------------------- */
  useEffect(() => {
    if (!state || state.phase !== 'dealing') return;
    if (isGuestMode(mode) || inBanquetLobby(mode)) return;
    const t = setTimeout(() => {
      hostReduce((prev) => (prev.phase === 'dealing' ? startTaxation(prev) : prev));
    }, DEAL_DURATION_MS);
    return () => clearTimeout(t);
  }, [state?.phase, state?.handNumber, mode, hostReduce, state]);

  /* --------------------------- AI: taxation ----------------------------- */
  useEffect(() => {
    if ((mode !== 'local-ai' && mode !== 'online-host' && mode !== 'banquet-host') || !state || state.phase !== 'taxes' || !state.pendingTaxes)
      return;

    const t = state.pendingTaxes;

    const aiRevolter = state.players.find(
      (p) => isAI(p.id) && countJesters(p.hand) >= 2 && shouldCallRevolution(p.hand, p.role)
    );
    if (aiRevolter) {
      const timer = setTimeout(() => {
        pushChat({ name: aiRevolter.name, text: AI_REVOLT_LINES[Math.floor(Math.random() * AI_REVOLT_LINES.length)] });
        hostReduce((prev) => applyRevolution(prev, aiRevolter.role === 'greater-peon'));
      }, 900);
      return () => clearTimeout(timer);
    }

    const human = state.players.find((p) => p.id === 'human' || p.id === CLIENT_ID);
    if (human && countJesters(human.hand) >= 2 && declinedRevolution !== state.handNumber) {
      return;
    }

    const pending: { id: string; cards: Card[] }[] = [];
    if (t.greaterDalmutiCardsGiven === null && isAI(t.greaterDalmutiId)) {
      const gd = state.players.find((p) => p.id === t.greaterDalmutiId)!;
      pending.push({ id: gd.id, cards: aiSelectGreaterDalmutiTax(gd.hand) });
    }
    if (
      t.lesserExchangeRequired &&
      t.lesserDalmutiCardGiven === null &&
      t.lesserDalmutiId &&
      isAI(t.lesserDalmutiId)
    ) {
      const ld = state.players.find((p) => p.id === t.lesserDalmutiId)!;
      pending.push({ id: ld.id, cards: [aiSelectLesserDalmutiTax(ld.hand)] });
    }

    if (pending.length === 0) return;

    const timer = setTimeout(() => {
      hostReduce((prev) => {
        let next = prev;
        for (const sub of pending) {
          next = submitTribute(next, sub.id, sub.cards);
        }
        return next;
      });
    }, 1100);
    return () => clearTimeout(timer);
  }, [state, mode, declinedRevolution, pushChat, hostReduce]);

  /* -------------------------- AI: playing turns -------------------------- */
  /* Build the strategic context the AI evaluates against (rank, hand size,
     players left, whether it leads, and how far the trick has come). */
  const aiContextFor = (state: GameState, playerId: string): AIContext => {
    const p = state.players.find((pl) => pl.id === playerId);
    return {
      role: p?.role,
      handSize: p?.hand.length ?? 0,
      playersLeft: state.players.filter((pl) => !pl.isOut && pl.hand.length > 0).length,
      isLeader: state.lastValidPlay === null,
      trickAge: state.currentTrick.length,
    };
  };

  useEffect(() => {
    if ((mode !== 'local-ai' && mode !== 'online-host' && mode !== 'banquet-host') || !state || state.phase !== 'playing') return;
    const current = state.players[state.currentPlayerIndex];
    if (!current || !isAI(current.id) || current.isOut) return;

    const timer = setTimeout(() => {
      const decision = aiDecide(current.hand, state.lastValidPlay, aiContextFor(state, current.id));
      const goesOut =
        decision.action === 'play' && !!decision.cards && decision.cards.length === current.hand.length;
      hostReduce((prev) => {
        const p = prev.players[prev.currentPlayerIndex];
        if (!p || p.id !== current.id || p.isOut) return prev;
        const d = aiDecide(p.hand, prev.lastValidPlay, aiContextFor(prev, p.id));
        return d.action === 'play' && d.cards ? applyPlay(prev, p.id, d.cards) : applyPass(prev, p.id);
      });
      if (goesOut) {
        pushChat({ name: current.name, text: AI_OUT_LINES[Math.floor(Math.random() * AI_OUT_LINES.length)] });
      }
    }, 1000 + Math.random() * 700);

    return () => clearTimeout(timer);
  }, [state, mode, pushChat, hostReduce]);

  /* --------------- turn hourglass: auto-pass when time runs out --------------- */
  useEffect(() => {
    if (isGuestMode(mode) || inBanquetLobby(mode) || mode === 'none') return;
    if (!state || state.phase !== 'playing' || !state.timerEnabled) return;
    const cur = state.players[state.currentPlayerIndex];
    if (!cur || cur.isOut) return;
    const started = state.turnStartedAt;
    const delay = Math.max(0, started + state.timerSeconds * 1000 - Date.now());
    const t = setTimeout(() => {
      hostReduce((prev) => {
        if (prev.phase !== 'playing' || prev.turnStartedAt !== started) return prev;
        const p = prev.players[prev.currentPlayerIndex];
        if (!p || p.isOut) return prev;
        return applyPass(prev, p.id, { timedOut: true });
      });
    }, delay);
    return () => clearTimeout(t);
  }, [state?.turnStartedAt, state?.phase, state?.currentPlayerIndex, mode, hostReduce, state]);

  /* --------------------------- player actions ---------------------------- */
  const myId = mode === 'local-ai' ? 'human' : CLIENT_ID;

  const handlePlay = useCallback(
    (cards: Card[]) => {
      if (isGuestMode(modeRef.current)) netSendToHost('action', { kind: 'play', cards, clientId: CLIENT_ID });
      else hostReduce((prev) => applyPlay(prev, myId, cards));
    },
    [myId, hostReduce, netSendToHost]
  );

  const handlePass = useCallback(() => {
    if (isGuestMode(modeRef.current)) netSendToHost('action', { kind: 'pass', clientId: CLIENT_ID });
    else hostReduce((prev) => applyPass(prev, myId));
  }, [myId, hostReduce, netSendToHost]);

  const handleRevolution = useCallback(
    (greater: boolean) => {
      if (isGuestMode(modeRef.current))
        netSendToHost('action', { kind: 'revolution', greaterRevolution: greater, clientId: CLIENT_ID });
      else hostReduce((prev) => applyRevolution(prev, greater));
    },
    [hostReduce, netSendToHost]
  );

  const handleDeclineRevolution = useCallback(() => {
    setDeclinedRevolution(state?.handNumber ?? -1);
  }, [state?.handNumber]);

  const handleTribute = useCallback(
    (cards: Card[]) => {
      setDeclinedRevolution(state?.handNumber ?? -1);
      if (isGuestMode(modeRef.current)) netSendToHost('action', { kind: 'tribute', cards, clientId: CLIENT_ID });
      else hostReduce((prev) => submitTribute(prev, myId, cards));
    },
    [myId, hostReduce, netSendToHost, state?.handNumber]
  );

  const handleNextHand = useCallback(() => {
    // The human IS the host in single-player, so they (and the auto-advance)
    // may deal the next hand there too.
    if (!isHostMode(modeRef.current) && modeRef.current !== 'local-ai') return;
    setDeclinedRevolution(-1);
    hostReduce((prev) => reseatForNextHand(prev));
  }, [hostReduce]);

  /* Single-player: hands flow on their own. Show the results for a moment,
     then deal the next hand automatically — no "waiting for the host". */
  useEffect(() => {
    if (mode !== 'local-ai' || state?.phase !== 'hand-end') return;
    const t = setTimeout(() => handleNextHand(), 3500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, state?.phase, state?.handNumber, handleNextHand]);

  const handleSendChat = useCallback(
    (text: string) => {
      const name = myName.trim() || 'Player';
      const id = nextChatId();
      console.log('[CHAT] sent', id, name, ':', text);
      pushChat({ name, text, mine: true, id });
      if (isHostMode(modeRef.current)) netBroadcast('chat', { name, text, id });
      else if (isGuestMode(modeRef.current)) netSendToHost('chat', { name, text, id });
    },
    [myName, pushChat, netBroadcast, netSendToHost]
  );

  /* ---------------------- leave-after-round scheduling ---------------------- */

  const handleScheduleLeave = useCallback(
    (queued: boolean) => {
      if (isGuestMode(modeRef.current)) {
        netSendToHost('schedule-leave', { queued, clientId: CLIENT_ID });
      } else if (isHostMode(modeRef.current) || modeRef.current === 'local-ai') {
        hostReduce((prev) => setLeaveIntent(prev, myId, queued));
      }
    },
    [hostReduce, myId, netSendToHost]
  );

  const autoLeftRef = useRef(false);
  useEffect(() => {
    if (!state) {
      autoLeftRef.current = false;
      return;
    }
    if (state.phase !== 'hand-end') {
      autoLeftRef.current = false;
      return;
    }
    if (autoLeftRef.current) return;
    const me = state.players.find((p) => p.id === myId);
    if (me?.leavingAfterRound) {
      autoLeftRef.current = true;
      console.log('[MP] scheduled leave reached — leaving now');
      handleBackToLobby();
    }
  }, [state, myId, handleBackToLobby]);

  /* ---------------------------- player profile stats ---------------------------- */

  const prevHandCountRef = useRef<number | null>(null);
  useEffect(() => {
    if (!state) {
      prevHandCountRef.current = null;
      return;
    }
    const count = state.handResults.length;
    if (prevHandCountRef.current === null) {
      // Baseline at whatever count we first observe (0 for a fresh game,
      // N for a resumed one) so reconnecting never double-counts old hands.
      prevHandCountRef.current = count;
      return;
    }
    if (count > prevHandCountRef.current) {
      for (let i = prevHandCountRef.current; i < count; i++) {
        const hr = state.handResults[i];
        const mine = hr.standings.find((s) => s.playerId === myId);
        if (mine) recordHandOutcome(mine.place, hr.standings.length);
      }
      prevHandCountRef.current = count;
    }
  }, [state, myId]);

  /* ---------------------- host moderation & lobby flow ---------------------- */

  const handleKick = useCallback(
    (playerId: string, kind: 'remove' | 'ai') => {
      const victim = state?.players.find((p) => p.id === playerId);
      if (!victim) return;
      const aiName = AI_NAMES[Math.floor(Math.random() * AI_NAMES.length)];
      hostReduce((prev) => applyKick(prev, playerId, kind, aiName));
      // Tell the kicked client directly so it can show its own notice.
      netSendToPlayer(playerId, 'kicked', { kind });
      const text =
        kind === 'ai'
          ? `${victim.name} was replaced at the table by ${aiName}.`
          : `${victim.name} was removed from the table by the host.`;
      const id = nextChatId();
      pushChat({ name: 'Herald', text, system: true, id });
      netBroadcast('chat', { name: 'Herald', text, system: true, id });
    },
    [state, hostReduce, pushChat, netBroadcast, netSendToPlayer]
  );

  const handleReturnToLobby = useCallback(() => {
    setDeclinedRevolution(-1);
    const m = modeRef.current;
    if (m === 'banquet-host') {
      sock.broadcastGame('return-lobby', {});
      sock.reopenLobby();
      setState(null);
      modeRef.current = 'banquet-lobby-host';
      setMode('banquet-lobby-host');
    } else if (m === 'online-host') {
      peer.broadcast({ type: 'return-lobby', payload: {} });
      setState(null);
      modeRef.current = 'online-host';
      setMode('online-host');
    }
  }, [sock, peer]);

  const handleLeaveTable = useCallback(() => {
    setKickedInfo(null);
    if (modeRef.current === 'banquet-guest') {
      setState(null);
      modeRef.current = 'banquet-lobby-guest';
      setMode('banquet-lobby-guest');
      setDeclinedRevolution(-1);
    } else {
      handleBackToLobby();
    }
  }, [handleBackToLobby]);

  /* ------------------------------- lobby --------------------------------- */

  const handleHost = useCallback(() => {
    setLobbyError(null);
    setMode('online-host');
    modeRef.current = 'online-host';
    peer.initializeHostWithCode().catch((e: Error) => {
      setLobbyError(e.message || 'Could not create a room. Try again, or play against the AI.');
    });
  }, [peer]);

  const handleJoin = useCallback(
    (code: string) => {
      setLobbyError(null);
      setMode('online-guest');
      modeRef.current = 'online-guest';
      saveSession({ transport: 'direct', role: 'guest', code, name: myName.trim() || 'Guest' });
      peer.joinGame(code, myName.trim() || 'Guest').catch((e: Error) => {
        setLobbyError(e.message || 'Could not join that room. Check the code and try again.');
        clearSession();
      });
    },
    [peer, myName]
  );

  /* --------------------------- banquet actions --------------------------- */

  const handleBanquetCreate = useCallback(
    (o: { lobbyName: string; password: string; maxPlayers: number }) => {
      setLobbyError(null);
      sock.createLobby({ hostName: myName.trim() || 'Host', ...o }).catch((e: Error) => {
        setLobbyError(e.message);
      });
    },
    [sock, myName]
  );

  const handleBanquetRefresh = useCallback(() => {
    sock.refreshLobbies().catch(() => {
      /* banner shows sock.error */
    });
  }, [sock]);

  const handleBanquetJoin = useCallback(
    (id: string, pw: string) => {
      setLobbyError(null);
      sock.joinLobby(id, pw, myName.trim() || 'Guest').catch((e: Error) => {
        setLobbyError(e.message);
      });
    },
    [sock, myName]
  );

  const handleBanquetLeave = useCallback(() => {
    sock.leaveLobby();
    setLobbyChat([]);
    setMode('none');
    modeRef.current = 'none';
    clearSession();
    clearSnapshot();
  }, [sock]);

  const banquetIsHost = mode === 'banquet-lobby-host';
  const canStartBanquet =
    !!sock.lobby &&
    sock.lobby.players.length >= MIN_PLAYERS &&
    sock.lobby.players.slice(0, MAX_SEATS).filter((p) => !p.isAI).every((p) => p.ready);

  /* ============================== RESUME ON LOAD ============================== */
  /*  Highest-priority feature: if this browser was mid-game when it refreshed,   */
  /*  rehydrate instantly from the local snapshot, then quietly re-establish the  */
  /*  transport connection using the same persisted identity so the host          */
  /*  recognises us and resends the authoritative state.                          */
  /* ============================================================================ */

  const didAttemptResumeRef = useRef(false);
  useEffect(() => {
    if (didAttemptResumeRef.current) return;
    didAttemptResumeRef.current = true;

    const session = loadSession();
    if (!session) return;

    const snapshot = loadSnapshot();
    setResuming(true);
    setResumeNotice('Reconnecting to your game…');
    if (session.name) setMyName(session.name);

    const giveUp = (message: string) => {
      setResuming(false);
      setResumeNotice(null);
      clearSession();
      clearSnapshot();
      setLobbyError(message);
    };

    const timeout = setTimeout(() => giveUp('Could not resume your previous game.'), RESUME_TIMEOUT_MS);

    if (session.transport === 'direct') {
      const targetMode: GameMode = session.role === 'host' ? 'online-host' : 'online-guest';
      modeRef.current = targetMode;
      setMode(targetMode);
      if (snapshot) setState(snapshot);

      if (session.role === 'host' && session.code) {
        peer
          .initializeHostWithCode(session.code)
          .then(() => {
            clearTimeout(timeout);
            setResuming(false);
            setResumeNotice(null);
            // Re-broadcast our restored snapshot so any guest who reconnects
            // first (before we finish here) is immediately brought in sync.
            if (snapshot) broadcastState(snapshot);
          })
          .catch((e: Error) => {
            // Someone else already took the room over (host transfer happened
            // while we were away): fall back to rejoining as their guest.
            if (/taken|unavailable-id/i.test(e.message)) {
              peer
                .joinGame(session.code!, session.name)
                .then(() => {
                  clearTimeout(timeout);
                  modeRef.current = 'online-guest';
                  setMode('online-guest');
                  setResuming(false);
                  setResumeNotice(null);
                })
                .catch(() => {
                  clearTimeout(timeout);
                  giveUp('Could not re-open your hosted room. It may have expired.');
                });
              return;
            }
            clearTimeout(timeout);
            giveUp('Could not re-open your hosted room. It may have expired.');
          });
      } else if (session.code) {
        peer
          .joinGame(session.code, session.name)
          .then(() => {
            clearTimeout(timeout);
            // The host will recognise our clientId and resend authoritative
            // state; nothing else to do here but stop showing "resuming".
            setResuming(false);
            setResumeNotice(null);
          })
          .catch(() => {
            clearTimeout(timeout);
            giveUp('Could not reconnect to the host. They may have left.');
          });
      } else {
        clearTimeout(timeout);
        giveUp('Your previous session was incomplete.');
      }
      return;
    }

    if (session.transport === 'banquet') {
      const targetMode: GameMode = session.role === 'host' ? 'banquet-host' : 'banquet-guest';
      modeRef.current = snapshot ? targetMode : 'none';
      if (snapshot) {
        setMode(targetMode);
        setState(snapshot);
      }
      if (!session.lobbyId) {
        clearTimeout(timeout);
        giveUp('Your previous session was incomplete.');
        return;
      }
      sock
        .joinLobby(session.lobbyId, '', session.name)
        .then(() => {
          clearTimeout(timeout);
          setResuming(false);
          setResumeNotice(null);
          // If we had a game snapshot, proactively ask the host (ourselves,
          // if we are the host, or the real host otherwise) for a fresh
          // authoritative copy in case anything changed while we were away.
          if (snapshot) {
            setTimeout(() => netSendToHost('request-state', { clientId: CLIENT_ID }), 400);
          }
        })
        .catch(() => {
          clearTimeout(timeout);
          giveUp('Could not reconnect to the banquet. The lobby may have closed.');
        });
      return;
    }

    clearTimeout(timeout);
    setResuming(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------- persist session + snapshot as we go ------------------- */

  useEffect(() => {
    if (state && inGameMode(mode) && mode !== 'local-ai') {
      saveSnapshot(state);
    }
  }, [state, mode]);

  /* The table's card set travels inside GameState — adopt whatever it says. */
  useEffect(() => {
    if (state?.cardSet) applyCardSet(state.cardSet, false);
  }, [state?.cardSet, applyCardSet]);

  /* If the relay says somebody else holds the host seat (e.g. we resumed after
     a transfer while away), step down to guest instead of split-braining.
     Skipped right after our own promotion, before the relay's lobby:update
     confirming it has arrived. */
  useEffect(() => {
    if (mode !== 'banquet-host' || !sock.lobby || promotedRef.current) return;
    if (sock.lobby.hostId !== CLIENT_ID) {
      console.log('[MP] relay reports another host — stepping down to guest');
      modeRef.current = 'banquet-guest';
      setMode('banquet-guest');
    }
  }, [mode, sock.lobby]);

  /* Re-render when the artwork registry changes (runtime pack arriving, etc). */
  const [, bumpArtVersion] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribeToCardArt(bumpArtVersion), [bumpArtVersion]);

  if (mode === 'none' || !state || inBanquetLobby(mode)) {
    return (
      <>
        {resuming && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-2xl border-4 border-amber-900/30 px-8 py-6 text-center shadow-2xl max-w-sm">
              <div className="animate-spin mx-auto mb-3 h-8 w-8 rounded-full border-4 border-purple-800 border-t-transparent" />
              <p className="font-serif font-bold text-purple-900">{resumeNotice ?? 'Reconnecting…'}</p>
            </div>
          </div>
        )}
        <Lobby
          status={peer.status}
          roomCode={peer.roomCode}
          myName={myName}
          onNameChange={setMyName}
          onHost={handleHost}
          onJoin={handleJoin}
          onStart={startHostedGame}
          onStartAI={startAIGame}
          canStart={peer.connectedPeers.length + aiSeats.length + 1 >= MIN_PLAYERS}
          peers={peer.connectedPeers.map((p) => ({ id: p.id, name: peerNames[p.id] ?? p.name }))}
          roster={roster}
          onAddAI={addAI}
          onRemoveAI={removeAI}
          canAddAI={peer.connectedPeers.length + aiSeats.length + 1 < MAX_SEATS}
          maxSeats={MAX_SEATS}
          minSeats={MIN_PLAYERS}
          timerEnabled={timerOn}
          onToggleTimer={setTimerOn}
          timerSeconds={timerSecs}
          onTimerSeconds={setTimerSecs}
          error={lobbyError ?? peer.errorMessage}
          diagnostics={peer.diagnostics}
          networkTest={peer.networkTest}
          testingNetwork={peer.testingNetwork}
          hasDedicatedTurn={peer.hasDedicatedTurn}
          onTestNetwork={() => void peer.testNetwork()}
          banquet={{
            serverStatus: sock.serverStatus,
            error: sock.error,
            myId: sock.myId,
            lobby: sock.lobby,
            lobbies: sock.lobbies,
            listing: sock.listing,
            serverUrl: sock.serverUrl,
            stats: sock.stats,
          }}
          banquetChat={lobbyChat}
          banquetInLobby={inBanquetLobby(mode)}
          banquetIsHost={banquetIsHost}
          canStartBanquet={canStartBanquet}
          onBanquetCreate={handleBanquetCreate}
          onBanquetRefresh={handleBanquetRefresh}
          onBanquetJoin={handleBanquetJoin}
          onBanquetLeave={handleBanquetLeave}
          onBanquetReady={sock.setReady}
          onBanquetStart={startBanquetGame}
          onBanquetChat={sock.sendChat}
          onBanquetAddAI={() => {
            const used = new Set((sock.lobby?.players ?? []).map((p) => p.name));
            const name = AI_NAMES.find((n) => !used.has(n)) ?? `Courtier ${(sock.lobby?.players.length ?? 0) + 1}`;
            sock.addAI(name);
          }}
          onBanquetRemoveAI={sock.removeAI}
          currentCardSet={getActiveSet()}
          onCardSet={handleCardSetChoice}
        />
      </>
    );
  }

  const isHost = isHostMode(mode) || mode === 'local-ai';
  const myPlayerRecord = state.players.find((p) => p.id === myId);
  const isSpectator = !myPlayerRecord;

  return (
    <ErrorBoundary>
      <GameTable
        state={state}
        myPlayerId={myId}
        isHost={isHost}
        isSpectator={isSpectator}
        revolutionDeclined={declinedRevolution === state.handNumber}
        chat={chat}
        turnDeadline={
          state.phase === 'playing' && state.timerEnabled
            ? state.turnStartedAt + state.timerSeconds * 1000
            : null
        }
        onContinueSeating={isHost ? handleContinueSeating : undefined}
        onReturnToLobby={isHostMode(mode) ? handleReturnToLobby : undefined}
        onKick={isHost ? handleKick : undefined}
        autoAdvance={mode === 'local-ai'}
        onLeaveTable={handleLeaveTable}
        onScheduleLeave={!isHost ? handleScheduleLeave : undefined}
        kickedNotice={kickedInfo}
        onSendChat={handleSendChat}
        onPlay={handlePlay}
        onPass={handlePass}
        onTribute={handleTribute}
        onRevolution={handleRevolution}
        onDeclineRevolution={handleDeclineRevolution}
        onNextHand={handleNextHand}
        onBackToLobby={handleBackToLobby}
      />
    </ErrorBoundary>
  );
}
