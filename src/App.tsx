import { useState, useEffect, useCallback, useRef, useMemo, Component } from 'react';
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
  TURN_TIMER_MS,
  MAX_PLAYERS,
  MIN_PLAYERS,
} from './game/logic';
import { countJesters } from './game/cards';
import { aiDecide, aiSelectGreaterDalmutiTax, aiSelectLesserDalmutiTax } from './game/ai';
import { useMultiplayer } from './hooks/useMultiplayer';
import type { PeerMessage } from './hooks/useMultiplayer';
import { useSocketLobby } from './net/useSocketLobby';
import type { LobbyChatLine } from './net/types';

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
const DEAL_DURATION_MS = 80 * 45 + 500;

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
  const aiCounterRef = useRef(0);

  const modeRef = useRef<GameMode>('none');
  modeRef.current = mode;

  const pushChat = useCallback((msg: Omit<ChatMessage, 'id' | 'ts'>) => {
    setChat((prev) => [...prev.slice(-140), { ...msg, id: nextChatId(), ts: Date.now() }]);
  }, []);

  const pushLobbyChat = useCallback((line: Omit<LobbyChatLine, 'id' | 'ts'>) => {
    setLobbyChat((prev) => [...prev.slice(-120), { ...line, id: nextChatId(), ts: Date.now() }]);
  }, []);

  /* =====================================================================
     TRANSPORT ABSTRACTION
     The game logic below only ever uses these four primitives. Which
     transport (PeerJS Direct Connect or Socket.IO Banquet Browser)
     satisfies them depends on the current GameMode.
     ===================================================================== */

  const netSendToAllExcept = useCallback((exceptId: string, type: string, payload: unknown) => {
    const m = modeRef.current;
    if (m === 'online-host') {
      peerRef.current?.connectedPeers.forEach((p) => {
        if (p.id !== exceptId) peerRef.current?.sendTo(p.id, { type, payload });
      });
    } else if (m === 'banquet-host') {
      sockRef.current?.lobby?.players.forEach((p) => {
        if (p.id !== exceptId && !p.isAI) sockRef.current?.sendGame(p.id, type, payload);
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
    } else if (m === 'banquet-guest') {
      sockRef.current?.sendGame('host', type, payload);
    }
  }, []);

  /* --------------------------- transports --------------------------- */

  const peerRef = useRef<ReturnType<typeof useMultiplayer> | null>(null);
  const sockRef = useRef<ReturnType<typeof useSocketLobby> | null>(null);
  const netMessageRef = useRef<(m: PeerMessage) => void>(() => {});
  const lobbyChatRef = useRef<(l: Omit<LobbyChatLine, 'id' | 'ts'>) => void>(() => {});
  const closedRef = useRef<(reason: string) => void>(() => {});

  const peer = useMultiplayer({ onMessage: (m) => netMessageRef.current(m) });
  peerRef.current = peer;

  const sock = useSocketLobby({
    onGameMessage: (m) => netMessageRef.current(m),
    onLobbyChat: (l) => lobbyChatRef.current(l),
    onClosed: (reason) => closedRef.current(reason),
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

  /* --------------------- unified message router --------------------- */

  const handleNetMessage = useCallback(
    (msg: PeerMessage) => {
      const m = modeRef.current;

      if (msg.type === 'state') {
        if (m === 'online-guest' || m === 'banquet-guest' || m === 'banquet-lobby-guest') {
          if (m === 'banquet-lobby-guest') {
            modeRef.current = 'banquet-guest';
            setMode('banquet-guest');
          }
          setState(msg.payload as GameState);
        }
        return;
      }

      if (msg.type === 'chat') {
        const p = msg.payload as { name: string; text: string };
        if (isHostMode(m)) {
          pushChat(p);
          netSendToAllExcept(msg.from, 'chat', p);
        } else if (isGuestMode(m)) {
          pushChat(p);
        }
        return;
      }

      if (msg.type === 'lobby' && m === 'online-guest') {
        setLobbyRoster((msg.payload as { roster?: RosterEntry[] }).roster ?? []);
        return;
      }

      if (!isHostMode(m)) return;

      if (msg.type === 'join') {
        const name = (msg.payload as { name?: string })?.name || 'Guest';
        setPeerNames((prev) => ({ ...prev, [msg.from]: name }));
        return;
      }

      if (msg.type === 'action') {
        const a = msg.payload as { kind: string; cards?: Card[]; greaterRevolution?: boolean };
        hostReduce((prev) => {
          if (a.kind === 'play' && a.cards) return applyPlay(prev, msg.from, a.cards);
          if (a.kind === 'pass') return applyPass(prev, msg.from);
          if (a.kind === 'revolution') return applyRevolution(prev, !!a.greaterRevolution);
          if (a.kind === 'tribute' && a.cards) return submitTribute(prev, msg.from, a.cards);
          return prev;
        });
      }
    },
    [hostReduce, pushChat, netSendToAllExcept]
  );
  netMessageRef.current = handleNetMessage;
  lobbyChatRef.current = pushLobbyChat;

  /* --------------------- lobby closed by server --------------------- */

  const handleBackToLobby = useCallback(() => {
    setState(null);
    setMode('none');
    modeRef.current = 'none';
    setDeclinedRevolution(-1);
    setChat([]);
    setLobbyChat([]);
    setAiSeats([]);
    setLobbyRoster([]);
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
      const next = initializeNewGame(players, { timerEnabled: timerOn });
      setDeclinedRevolution(-1);
      setChat([]);
      pushChat({ name: 'Herald', text: `A new game begins with ${players.length} players.`, system: true });
      setMode('local-ai');
      modeRef.current = 'local-ai';
      setState(next);
    },
    [myName, pushChat, timerOn]
  );

  const startHostedGame = useCallback(() => {
    const hostPlayer: Player = {
      id: peer.myId,
      name: myName.trim() || 'Host',
      hand: [],
      isHost: true,
      isOut: false,
    };
    const guests: Player[] = peer.connectedPeers.map((p) => ({
      id: p.id,
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
    const next = initializeNewGame([hostPlayer, ...guests, ...ais], { timerEnabled: timerOn });
    setDeclinedRevolution(-1);
    setChat([]);
    pushChat({ name: 'Herald', text: `A new game begins with ${next.players.length} players.`, system: true });
    setState(next);
    broadcastState(next);
  }, [peer.myId, peer.connectedPeers, myName, peerNames, aiSeats, broadcastState, pushChat, timerOn]);

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
    sock.startGame();
    const next = initializeNewGame(players, { timerEnabled: timerOn });
    setDeclinedRevolution(-1);
    setChat([]);
    pushChat({ name: 'Herald', text: `The banquet begins with ${players.length} players.`, system: true });
    modeRef.current = 'banquet-host';
    setMode('banquet-host');
    setState(next);
    broadcastState(next);
  }, [sock, broadcastState, pushChat, timerOn]);

  // Follow the socket lobby in/out of the room screens.
  useEffect(() => {
    if (sock.lobby && mode === 'none') {
      const mine = sock.lobby.players.find((p) => p.id === sock.myId);
      const next: GameMode = mine?.isHost ? 'banquet-lobby-host' : 'banquet-lobby-guest';
      modeRef.current = next;
      setMode(next);
      setLobbyError(null);
    }
    if (!sock.lobby && inBanquetLobby(mode)) {
      modeRef.current = 'none';
      setMode('none');
    }
  }, [sock.lobby, sock.myId, mode]);

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
        { id: peer.myId, name: myName.trim() || 'Host', kind: 'host' },
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
  }, [mode, peer.myId, peer.connectedPeers, peerNames, aiSeats, myName, lobbyRoster]);

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

    const aiRevolter = state.players.find((p) => isAI(p.id) && countJesters(p.hand) >= 2);
    if (aiRevolter) {
      const timer = setTimeout(() => {
        pushChat({ name: aiRevolter.name, text: AI_REVOLT_LINES[Math.floor(Math.random() * AI_REVOLT_LINES.length)] });
        hostReduce((prev) => applyRevolution(prev, aiRevolter.role === 'greater-peon'));
      }, 900);
      return () => clearTimeout(timer);
    }

    const human = state.players.find((p) => p.id === 'human' || p.id === peer.myId || p.id === sock.myId);
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
  }, [state, mode, declinedRevolution, pushChat, hostReduce, peer.myId, sock.myId]);

  /* -------------------------- AI: playing turns -------------------------- */
  useEffect(() => {
    if ((mode !== 'local-ai' && mode !== 'online-host' && mode !== 'banquet-host') || !state || state.phase !== 'playing') return;
    const current = state.players[state.currentPlayerIndex];
    if (!current || !isAI(current.id) || current.isOut) return;

    const timer = setTimeout(() => {
      const decision = aiDecide(current.hand, state.lastValidPlay);
      const goesOut =
        decision.action === 'play' && !!decision.cards && decision.cards.length === current.hand.length;
      hostReduce((prev) => {
        const p = prev.players[prev.currentPlayerIndex];
        if (!p || p.id !== current.id || p.isOut) return prev;
        const d = aiDecide(p.hand, prev.lastValidPlay);
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
    const delay = Math.max(0, started + TURN_TIMER_MS - Date.now());
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
  const myId = mode === 'local-ai' ? 'human' : mode === 'online-guest' || mode === 'online-host' ? peer.myId : sock.myId;

  const handlePlay = useCallback(
    (cards: Card[]) => {
      if (isGuestMode(modeRef.current)) netSendToHost('action', { kind: 'play', cards });
      else hostReduce((prev) => applyPlay(prev, myId, cards));
    },
    [myId, hostReduce, netSendToHost]
  );

  const handlePass = useCallback(() => {
    if (isGuestMode(modeRef.current)) netSendToHost('action', { kind: 'pass' });
    else hostReduce((prev) => applyPass(prev, myId));
  }, [myId, hostReduce, netSendToHost]);

  const handleRevolution = useCallback(
    (greater: boolean) => {
      if (isGuestMode(modeRef.current)) netSendToHost('action', { kind: 'revolution', greaterRevolution: greater });
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
      if (isGuestMode(modeRef.current)) netSendToHost('action', { kind: 'tribute', cards });
      else hostReduce((prev) => submitTribute(prev, myId, cards));
    },
    [myId, hostReduce, netSendToHost, state?.handNumber]
  );

  const handleNextHand = useCallback(() => {
    if (!isHostMode(modeRef.current)) return;
    setDeclinedRevolution(-1);
    hostReduce((prev) => reseatForNextHand(prev));
  }, [hostReduce]);

  const handleSendChat = useCallback(
    (text: string) => {
      const name = myName.trim() || 'Player';
      pushChat({ name, text, mine: true });
      if (isHostMode(modeRef.current)) netBroadcast('chat', { name, text });
      else if (isGuestMode(modeRef.current)) netSendToHost('chat', { name, text });
    },
    [mode, myName, pushChat, netBroadcast, netSendToHost]
  );

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
      peer.joinGame(code, myName.trim() || 'Guest').catch((e: Error) => {
        setLobbyError(e.message || 'Could not join that room. Check the code and try again.');
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
  }, [sock]);

  const banquetIsHost = mode === 'banquet-lobby-host';
  const canStartBanquet =
    !!sock.lobby &&
    sock.lobby.players.length >= MIN_PLAYERS &&
    sock.lobby.players.length <= MAX_SEATS &&
    sock.lobby.players.filter((p) => !p.isAI).every((p) => p.ready);

  if (mode === 'none' || !state || inBanquetLobby(mode)) {
    return (
      <Lobby
        status={peer.status}
        roomCode={peer.roomCode}
        myName={myName}
        onNameChange={setMyName}
        onHost={handleHost}
        onJoin={handleJoin}
        onStart={startHostedGame}
        onStartAI={startAIGame}
        canStart={
          peer.connectedPeers.length + aiSeats.length + 1 >= MIN_PLAYERS &&
          peer.connectedPeers.length + aiSeats.length + 1 <= MAX_SEATS
        }
        peers={peer.connectedPeers.map((p) => ({ id: p.id, name: peerNames[p.id] ?? p.name }))}
        roster={roster}
        onAddAI={addAI}
        onRemoveAI={removeAI}
        canAddAI={peer.connectedPeers.length + aiSeats.length + 1 < MAX_SEATS}
        maxSeats={MAX_SEATS}
        minSeats={MIN_PLAYERS}
        timerEnabled={timerOn}
        onToggleTimer={setTimerOn}
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
      />
    );
  }

  const isHost = isHostMode(mode);

  return (
    <ErrorBoundary>
      <GameTable
        state={state}
        myPlayerId={myId}
        isHost={isHost}
        revolutionDeclined={declinedRevolution === state.handNumber}
        chat={chat}
        turnDeadline={
          state.phase === 'playing' && state.timerEnabled ? state.turnStartedAt + TURN_TIMER_MS : null
        }
        onContinueSeating={isHost ? handleContinueSeating : undefined}
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
