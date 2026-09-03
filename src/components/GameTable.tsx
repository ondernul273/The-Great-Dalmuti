import { useState, useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { Card as CardType, ChatMessage, GameState, Player, Role } from '../game/types';
import { countJesters } from '../game/cards';
import {
  canPlayCards,
  getRoleName,
  describeSet,
  rolesForSeating,
} from '../game/logic';
import { Card, CardBackFace } from './Card';
import { ScorePanel } from './ScorePanel';
import { ChatPanel } from './ChatPanel';
import { RoleBadge } from './RoleBadge';
import { Fireworks } from './Celebrate';
import { cn } from '../utils/cn';
import {
  Trophy,
  MessageCircle,
  LogOut,
  Crown,
  Coins,
  Hourglass,
  Swords,
  Ban,
  UserX,
  AlarmClock,
  UserMinus,
  Bot,
  DoorOpen,
  X,
  Eye,
  Layers,
} from 'lucide-react';

interface GameTableProps {
  state: GameState;
  myPlayerId: string;
  isHost: boolean;
  /** true when myPlayerId isn't seated in state.players — watch only, no actions. */
  isSpectator?: boolean;
  revolutionDeclined: boolean;
  chat: ChatMessage[];
  turnDeadline?: number | null;
  onContinueSeating?: () => void;
  onReturnToLobby?: () => void;
  onKick?: (playerId: string, kind: 'remove' | 'ai') => void;
  onLeaveTable?: () => void;
  /** Ask to leave once this hand ends (true), or cancel that request (false). Hidden for the host. */
  onScheduleLeave?: (queued: boolean) => void;
  kickedNotice?: { kind: 'remove' | 'ai' } | null;
  onSendChat: (text: string) => void;
  onPlay: (cards: CardType[]) => void;
  onPass: () => void;
  onTribute: (cards: CardType[]) => void;
  onRevolution: (greaterRevolution: boolean) => void;
  onDeclineRevolution: () => void;
  onNextHand: () => void;
  onBackToLobby?: () => void;
}

/** Polar seat around the oval table. angle 0 = top, clockwise. Human sits at 180° (bottom). */
function tableSeat(kFromHuman: number, total: number): { x: number; y: number; angle: number } {
  const angle = 180 + (360 * kFromHuman) / total;
  const rx = 38;
  const ry = 33;
  const rad = (angle * Math.PI) / 180;
  return {
    x: 50 + rx * Math.sin(rad),
    y: 48 - ry * Math.cos(rad),
    angle,
  };
}

const DEAL_TICK_MS = 45;

export function GameTable(props: GameTableProps) {
  const {
    state,
    myPlayerId,
    isHost,
    isSpectator = false,
    revolutionDeclined,
    chat,
    turnDeadline,
    onContinueSeating,
    onReturnToLobby,
    onKick,
    onLeaveTable,
    onScheduleLeave,
    kickedNotice,
    onSendChat,
    onPlay,
    onPass,
    onTribute,
    onRevolution,
    onDeclineRevolution,
    onNextHand,
    onBackToLobby,
  } = props;

  const myPlayer = state.players.find((p) => p.id === myPlayerId);
  const myIdx = state.players.findIndex((p) => p.id === myPlayerId);
  const n = state.players.length;

  const [selected, setSelected] = useState<string[]>([]);
  const [showScore, setShowScore] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [unread, setUnread] = useState(0);
  const [dealTick, setDealTick] = useState(0);
  const [seatsRevealed, setSeatsRevealed] = useState(0);
  const [receiveIds, setReceiveIds] = useState<string[]>([]);
  const [celebrate, setCelebrate] = useState<'big' | 'small' | null>(null);
  const [reveal, setReveal] = useState<CardType[] | null>(null);
  // A one-shot intention for this trick. It is intentionally local to the
  // player: the host only receives the normal, authoritative Pass action
  // once this player actually becomes the current player.
  const [passQueued, setPassQueued] = useState(false);
  const [kickTarget, setKickTarget] = useState<string | null>(null);
  const [showLeaveDialog, setShowLeaveDialog] = useState(false);

  const prevPhaseRef = useRef(state.phase);
  const prevHandIdsRef = useRef<Set<string>>(new Set(myPlayer?.hand.map((c) => c.id) ?? []));
  const prevLastPlayRef = useRef(state.lastValidPlay);
  const passQueueExecutionRef = useRef('');

  /* -------- dealing animation clock -------- */
  const totalCards = useMemo(
    () => state.players.reduce((sum, p) => sum + p.hand.length, 0),
    [state.players]
  );
  const dealing = state.phase === 'dealing';
  const seating = state.phase === 'seating';

  useEffect(() => {
    if (!dealing) {
      setDealTick(totalCards);
      return;
    }
    setDealTick(0);
    const t = setInterval(() => {
      setDealTick((prev) => {
        if (prev + 1 >= totalCards) clearInterval(t);
        return Math.min(prev + 1, totalCards);
      });
    }, DEAL_TICK_MS);
    return () => clearInterval(t);
  }, [dealing, state.handNumber, totalCards]);

  const dealtFor = (seatIdx: number, tick: number) =>
    seatIdx < tick ? Math.ceil((tick - seatIdx) / n) : 0;

  /* -------- sequential reveal of the opening draw for seats -------- */
  const seatingCount = state.seatingDraw?.length ?? 0;
  useEffect(() => {
    if (!seating || seatingCount === 0) {
      setSeatsRevealed(seatingCount);
      return;
    }
    setSeatsRevealed(0);
    const t = setInterval(() => {
      setSeatsRevealed((prev) => {
        if (prev + 1 >= seatingCount) clearInterval(t);
        return Math.min(prev + 1, seatingCount);
      });
    }, 900);
    return () => clearInterval(t);
  }, [seating, state.handNumber, seatingCount]);

  /* -------- cards sliding into my hand after taxes -------- */
  useEffect(() => {
    const prevPhase = prevPhaseRef.current;
    prevPhaseRef.current = state.phase;
    const currentIds = new Set(myPlayer?.hand.map((c) => c.id) ?? []);

    if (state.phase === 'playing' && prevPhase === 'taxes') {
      const fresh = [...currentIds].filter((id) => !prevHandIdsRef.current.has(id));
      if (fresh.length > 0) {
        setReceiveIds(fresh);
        const t = setTimeout(() => setReceiveIds([]), 1900);
        prevHandIdsRef.current = currentIds;
        return () => clearTimeout(t);
      }
    }
    prevHandIdsRef.current = currentIds;
    return;
  }, [state.phase, myPlayer?.hand]);

  /* -------- Pass Queue resets on every trick boundary and phase change -------- */
  useEffect(() => {
    const was = prevLastPlayRef.current;
    prevLastPlayRef.current = state.lastValidPlay;
    // null -> card means a new trick has started; card -> null means one has
    // finished. A queue may never cross either boundary.
    if (was !== state.lastValidPlay && (was === null || state.lastValidPlay === null)) {
      setPassQueued(false);
      passQueueExecutionRef.current = '';
    }
  }, [state.lastValidPlay]);
  useEffect(() => {
    if (state.phase !== 'playing') {
      setPassQueued(false);
      passQueueExecutionRef.current = '';
    }
  }, [state.phase]);

  /* -------- celebration when I finish 1st or 2nd -------- */
  const myPlace = myPlayer?.finishOrder;
  useEffect(() => {
    if (myPlace !== 1 && myPlace !== 2) return;
    setCelebrate(myPlace === 1 ? 'big' : 'small');
    const t = setTimeout(() => setCelebrate(null), 3800);
    return () => clearTimeout(t);
  }, [myPlace]);

  /* -------- sealed tribute reveal -------- */
  const taxNow = state.pendingTaxes;
  const iSubmittedNow =
    !!taxNow &&
    ((taxNow.greaterDalmutiId === myPlayerId && taxNow.greaterDalmutiCardsGiven !== null) ||
      (taxNow.lesserDalmutiId === myPlayerId &&
        taxNow.lesserExchangeRequired &&
        taxNow.lesserDalmutiCardGiven !== null));
  useEffect(() => {
    if (!iSubmittedNow || !taxNow) return;
    const cards =
      taxNow.greaterDalmutiId === myPlayerId
        ? taxNow.greaterPeonCardsGiven
        : taxNow.lesserPeonCardGiven
        ? [taxNow.lesserPeonCardGiven]
        : [];
    if (cards.length === 0) return;
    setReveal(cards);
    const t = setTimeout(() => setReveal(null), 3400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iSubmittedNow]);

  /* -------- unread chat badge -------- */
  const lastChatIdRef = useRef<string | null>(null);
  useEffect(() => {
    const last = chat[chat.length - 1];
    if (!last) return;
    if (lastChatIdRef.current === null) {
      lastChatIdRef.current = last.id;
      return;
    }
    if (last.id !== lastChatIdRef.current) {
      lastChatIdRef.current = last.id;
      if (!showChat && !last.mine && !last.system) setUnread((u) => u + 1);
    }
  }, [chat, showChat]);
  useEffect(() => {
    if (showChat) setUnread(0);
  }, [showChat]);

  useEffect(() => {
    setSelected([]);
  }, [state.currentPlayerIndex, state.phase, state.lastValidPlay, state.handNumber]);

  const tax = state.pendingTaxes;
  const inTaxes = state.phase === 'taxes' && !!tax;
  const iAmGD = !!tax && tax.greaterDalmutiId === myPlayerId;
  const iAmLD = !!tax && tax.lesserDalmutiId === myPlayerId && tax.lesserExchangeRequired;
  const myTributeDue =
    inTaxes &&
    ((iAmGD && tax!.greaterDalmutiCardsGiven === null) ||
      (iAmLD && tax!.lesserDalmutiCardGiven === null));
  const tributeCount = iAmGD ? 2 : 1;
  const canCallRevolution =
    inTaxes && !!myPlayer && countJesters(myPlayer.hand) >= 2 && !revolutionDeclined;

  const selectedCards = useMemo(
    () => (myPlayer ? myPlayer.hand.filter((c) => selected.includes(c.id)) : []),
    [myPlayer, selected]
  );
  const playValid = useMemo(
    () => canPlayCards(selectedCards, state.lastValidPlay),
    [selectedCards, state.lastValidPlay]
  );

  const isMyTurn =
    state.phase === 'playing' &&
    state.players[state.currentPlayerIndex]?.id === myPlayerId &&
    !myPlayer?.isOut &&
    !myPlayer?.kicked;

  const cardsInteractive = (isMyTurn && state.phase === 'playing') || !!myTributeDue;

  /* -------- Pass Queue executes only after authoritative state gives me the turn -------- */
  useEffect(() => {
    if (!isMyTurn || !passQueued || !myPlayer) return;
    const key = `${state.handNumber}:${state.currentPlayerIndex}:${state.turnStartedAt}`;
    if (passQueueExecutionRef.current === key) return;
    passQueueExecutionRef.current = key;
    // A small delay leaves the queued state visible as the turn reaches us.
    const t = setTimeout(() => {
      setPassQueued(false);
      onPass();
    }, 250);
    return () => clearTimeout(t);
  }, [isMyTurn, passQueued, myPlayer, state.handNumber, state.currentPlayerIndex, state.turnStartedAt, onPass]);

  const canUsePassQueue =
    state.phase === 'playing' && !myPlayer?.isOut && !myPlayer?.kicked;

  const handlePassButton = () => {
    if (!canUsePassQueue) return;
    if (passQueued) {
      // Clicking the highlighted button is always a cancellation, including
      // the short beat after the turn arrives.
      setPassQueued(false);
      passQueueExecutionRef.current = '';
      return;
    }
    if (isMyTurn) {
      // Normal immediate pass remains unchanged for the current player.
      onPass();
      return;
    }
    setPassQueued(true);
  };

  const handlePlayButton = () => {
    // A real play always supersedes an earlier pass intention.
    setPassQueued(false);
    passQueueExecutionRef.current = '';
    onPlay(selectedCards);
  };

  const toggleCard = (card: CardType) => {
    setSelected((prev) => {
      if (prev.includes(card.id)) return prev.filter((id) => id !== card.id);
      if (myTributeDue) {
        if (prev.length >= tributeCount) {
          return tributeCount === 1 ? [card.id] : [...prev.slice(1), card.id];
        }
        return [...prev, card.id];
      }
      const sel = myPlayer!.hand.filter((c) => prev.includes(c.id));
      if (sel.length === 0) return [card.id];
      const nonJesters = sel.filter((c) => c.rank !== 13);
      if (card.rank === 13) return [...prev, card.id];
      if (nonJesters.length === 0) return [...prev, card.id];
      if (nonJesters[0].rank === card.rank) return [...prev, card.id];
      return [card.id];
    });
  };

  /* -------- kicked out of the table -------- */
  if ((myPlayer?.kicked && myPlayer?.dropped) || (!myPlayer && kickedNotice)) {
    return (
      <KickedScreen
        kind={myPlayer?.dropped ? 'remove' : kickedNotice?.kind ?? 'remove'}
        onLeave={onLeaveTable ?? onBackToLobby}
      />
    );
  }

  /* -------- spectator: not seated in this game (joined late / lobby overflow) -------- */
  if (!myPlayer || isSpectator) {
    if (state.phase === 'hand-end') {
      return (
        <HandEndScreen
          state={state}
          myPlayerId={myPlayerId}
          isHost={false}
          onNextHand={onNextHand}
          onBackToLobby={onBackToLobby}
        />
      );
    }
    return (
      <SpectatorView
        state={state}
        chat={chat}
        onSendChat={onSendChat}
        onBackToLobby={onBackToLobby}
      />
    );
  }

  if (state.phase === 'hand-end') {
    return (
      <HandEndScreen
        state={state}
        myPlayerId={myPlayerId}
        isHost={isHost}
        onNextHand={onNextHand}
        onReturnToLobby={onReturnToLobby}
        onBackToLobby={onBackToLobby}
      />
    );
  }

  const opponents = (() => {
    return [...state.players.slice(myIdx + 1), ...state.players.slice(0, myIdx)];
  })();

  const seatPos = (seatIdx: number): [number, number] => {
    const k = (seatIdx - myIdx + n) % n;
    const s = tableSeat(k, n);
    return [s.x, s.y];
  };

  const handSorted = [...myPlayer.hand].sort((a, b) => a.rank - b.rank);
  const visibleHand = seating
    ? []
    : dealing
    ? handSorted.slice(0, dealtFor(myIdx, dealTick))
    : handSorted;

  const receivingCards: CardType[] = myTributeDue
    ? iAmGD
      ? tax?.greaterPeonCardsGiven ?? []
      : tax?.lesserPeonCardGiven
      ? [tax.lesserPeonCardGiven]
      : []
    : [];
  const receivingFrom = iAmGD
    ? state.players.find((p) => p.role === 'greater-peon')
    : state.players.find((p) => p.role === 'lesser-peon');
  const iAmGP = myPlayer.role === 'greater-peon';
  const iAmLP = myPlayer.role === 'lesser-peon';

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden">
      <div className="great-table z-[1]" />

      {showScore && (
        <ScorePanel state={state} myPlayerId={myPlayerId} onClose={() => setShowScore(false)} />
      )}
      <ChatPanel
        open={showChat}
        messages={chat}
        myName={myPlayer.name}
        onSend={onSendChat}
        onClose={() => setShowChat(false)}
      />

      {kickTarget && onKick && (
        <KickDialog
          name={state.players.find((p) => p.id === kickTarget)?.name ?? 'this player'}
          onCancel={() => setKickTarget(null)}
          onChoose={(kind) => {
            onKick(kickTarget, kind);
            setKickTarget(null);
          }}
        />
      )}

      {/* ---------------- header ---------------- */}
      <header className="shrink-0 relative z-30 bg-black/45 backdrop-blur border-b border-amber-400/25 px-3 py-1.5 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="font-heading italic font-bold text-amber-300 leading-none truncate" style={{ fontSize: 'var(--font-lg)' }}>
            The Great Dalmuti
          </h1>
          <p className="text-amber-100/60 leading-tight flex items-center gap-1.5" style={{ fontSize: 'var(--font-xs)' }}>
            Hand {state.handNumber}
            <span className="text-amber-100/30">·</span>
            <span className={cn('inline-flex items-center gap-1', state.timerEnabled ? 'text-amber-200/80' : 'text-amber-100/45')}>
              <Hourglass size="1em" /> {state.timerEnabled ? `${state.timerSeconds} s turns` : 'no timer'}
            </span>
          </p>
        </div>

        <div className="text-center px-3 py-1 rounded-lg bg-amber-400/10 border border-amber-400/25">
          <p className="text-amber-100/60 leading-none" style={{ fontSize: 'var(--font-tiny)' }}>Your rank</p>
          <p className="font-serif font-bold text-amber-300 leading-tight whitespace-nowrap flex items-center gap-1.5" style={{ fontSize: 'var(--font-sm)' }}>
            <RoleBadge role={myPlayer.role} /> {myPlayer.role ? getRoleName(myPlayer.role) : '—'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowScore(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-purple-950 font-serif font-bold rounded-lg shadow-md border-2 border-amber-900/30 transition-transform hover:-translate-y-0.5"
            style={{ fontSize: 'var(--font-sm)' }}
          >
            <Trophy size="1em" /> Scores
          </button>
          <button
            onClick={() => setShowChat(true)}
            className="relative flex items-center gap-1.5 px-3 py-1.5 bg-purple-700 hover:bg-purple-600 text-amber-100 font-serif font-bold rounded-lg shadow-md border-2 border-amber-400/30 transition-transform hover:-translate-y-0.5"
            style={{ fontSize: 'var(--font-sm)' }}
          >
            <MessageCircle size="1em" /> Chat
            {unread > 0 && (
              <span className="absolute -top-2 -right-2 min-w-[1.3em] h-[1.3em] px-1 rounded-full bg-red-600 text-white text-center font-bold border border-red-300" style={{ fontSize: 'var(--font-tiny)' }}>
                {unread}
              </span>
            )}
          </button>
          {onBackToLobby && (
            <button
              onClick={() => setShowLeaveDialog(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-red-900/70 hover:bg-red-800 text-amber-100 rounded-lg border border-red-400/30"
              style={{ fontSize: 'var(--font-xs)' }}
            >
              <LogOut size="1em" /> Leave
            </button>
          )}
        </div>
      </header>

      {showLeaveDialog && (
        <LeaveDialog
          canScheduleLeave={!isHost && !!onScheduleLeave}
          onLeaveNow={() => {
            setShowLeaveDialog(false);
            (onLeaveTable ?? onBackToLobby)?.();
          }}
          onScheduleLeave={() => {
            setShowLeaveDialog(false);
            onScheduleLeave?.(true);
          }}
          onCancel={() => setShowLeaveDialog(false)}
        />
      )}

      {/* ---------------- message banner ---------------- */}
      <div className="shrink-0 relative z-20 bg-purple-950/50 border-b border-amber-400/20 py-1 px-3 text-center">
        <p className="font-serif text-amber-100 truncate" style={{ fontSize: 'var(--font-sm)' }}>
          {state.message}
        </p>
      </div>

      {/* ---------------- "leave scheduled" persistent notice ---------------- */}
      {myPlayer.leavingAfterRound && (
        <div className="shrink-0 relative z-20 bg-amber-900/60 border-b border-amber-400/40 py-1.5 px-3 flex items-center justify-center gap-3 flex-wrap">
          <p className="font-serif text-amber-100 flex items-center gap-1.5" style={{ fontSize: 'var(--font-xs)' }}>
            <DoorOpen size="1em" /> Leave Scheduled — you will leave once this round ends.
          </p>
          {onScheduleLeave && (
            <button
              onClick={() => onScheduleLeave(false)}
              className="px-2.5 py-0.5 rounded-full bg-amber-500 hover:bg-amber-400 text-purple-950 font-serif font-bold border border-amber-200"
              style={{ fontSize: 'var(--font-tiny)' }}
            >
              Cancel Planned Leave
            </button>
          )}
        </div>
      )}

      {/* ---------------- table ---------------- */}
      <main className="flex-1 relative min-h-0 z-10">
        {isSpectator && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 pointer-events-none slide-up">
            <p className="font-serif italic text-sky-200 bg-black/50 border border-sky-400/40 rounded-full px-4 py-1 flex items-center gap-2" style={{ fontSize: 'var(--font-xs)' }}>
              <Eye size="1em" /> Spectating — a seat will open once this game ends.
            </p>
          </div>
        )}

        {reveal && (
          <div className="absolute left-1/2 top-[4%] -translate-x-1/2 z-40 pointer-events-none fade-in">
            <div className="flex flex-col items-center gap-1.5 px-5 py-2.5 rounded-xl bg-black/70 border-2 border-amber-400/70 shadow-2xl backdrop-blur-sm">
              <p className="font-heading font-bold text-amber-300 italic" style={{ fontSize: 'var(--font-sm)' }}>
                The seal breaks — you receive:
              </p>
              <div className="flex gap-2">
                {reveal.map((c, i) => (
                  <div key={c.id} className="card-fly glow-pulse rounded-md" style={{ animationDelay: `${i * 0.1}s` }}>
                    <Card card={c} size="lg" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {celebrate && (
          <>
            <Fireworks big={celebrate === 'big'} />
            <div className="absolute left-1/2 top-[16%] -translate-x-1/2 z-[85] pointer-events-none slide-up">
              <p
                className="font-heading font-black italic text-amber-300 px-6 py-2 rounded-xl bg-black/60 border-2 border-amber-400/70 shadow-2xl whitespace-nowrap"
                style={{ fontSize: 'var(--font-xl)', textShadow: '0 0 24px rgba(245,176,65,0.8)' }}
              >
                {celebrate === 'big' ? '👑 First to shed every card!' : '🎩 Second place — well fought!'}
              </p>
            </div>
          </>
        )}

        <OpponentRing
          opponents={opponents}
          state={state}
          dealing={dealing}
          myIdx={myIdx}
          totalPlayers={n}
          canKick={!!onKick}
          onKick={(id) => setKickTarget(id)}
          dealtFor={
            seating
              ? () => 0
              : dealing
              ? (seatIdxInPlayers: number) => dealtFor(seatIdxInPlayers, dealTick)
              : null
          }
        />

        {/* flying cards from the deck */}
        {dealing && dealTick > 0 && (
          <>
            {Array.from({ length: Math.min(9, dealTick) }).map((_, k) => {
              const t = dealTick - 1 - k;
              const seat = t % n;
              const [sx, sy] = seatPos(seat);
              return (
                <div
                  key={`${state.handNumber}-${t}`}
                  className="fly-seat"
                  style={{ '--sx': `${sx}%`, '--sy': `${sy}%` } as CSSProperties}
                >
                  <CardBackFace size="xs" />
                </div>
              );
            })}
          </>
        )}

        {/* centre of the table */}
        <div className="absolute inset-0 flex items-center justify-center px-2 pointer-events-none">
          <div className="flex flex-col items-center gap-2 pointer-events-auto">
            {/* the opening draw for seats */}
            {seating && state.seatingDraw && (
              <div
                className="rounded-2xl px-5 py-4 bg-black/60 border-2 border-amber-400/70 shadow-2xl flex flex-col items-center gap-3 fade-in max-w-[94vw] max-h-[72vh] overflow-y-auto"
                style={{ backdropFilter: 'blur(4px)' }}
              >
                <p className="font-heading font-black text-amber-300 italic text-center" style={{ fontSize: 'var(--font-lg)' }}>
                  🃏 The Draw for Seats
                </p>
                <p className="font-serif italic text-amber-100/85 text-center leading-snug" style={{ fontSize: 'var(--font-xs)' }}>
                  Every player drew one card. The lowest card takes the highest rank — the Jester counts as the highest card.
                </p>
                <p
                  className={cn(
                    'px-3 py-0.5 rounded-full border font-heading font-bold tracking-wide',
                    seatsRevealed >= seatingCount
                      ? 'bg-emerald-700/70 border-emerald-400/70 text-emerald-100'
                      : 'bg-purple-900/70 border-amber-400/50 text-amber-200 animate-pulse'
                  )}
                  style={{ fontSize: 'var(--font-xs)' }}
                >
                  {seatsRevealed >= seatingCount
                    ? `All ${seatingCount} seats drawn`
                    : `Drawing seat ${seatsRevealed + 1} of ${seatingCount}…`}
                </p>
                <div className="flex flex-wrap justify-center gap-2.5">
                  {state.seatingDraw.map((d, i) => {
                    const p = state.players.find((pp) => pp.id === d.playerId);
                    const isMe = d.playerId === myPlayerId;
                    const revealed = i < seatsRevealed;
                    const isNext = i === seatsRevealed;
                    return (
                      <div
                        key={d.playerId}
                        className={cn(
                          'flex flex-col items-center gap-1 px-2.5 py-2 rounded-xl border-2 transition-all duration-300',
                          isMe
                            ? 'bg-amber-400/25 border-amber-300 shadow-lg shadow-amber-500/30'
                            : 'bg-black/35 border-amber-700/50',
                          !revealed && !isNext && 'opacity-40',
                          isNext && 'border-amber-300/80 ring-2 ring-amber-400/50'
                        )}
                      >
                        <span className="font-heading font-black text-amber-200/80 leading-none" style={{ fontSize: 'var(--font-xs)' }}>
                          #{i + 1}
                        </span>
                        <div key={revealed ? 'up' : 'down'} className={revealed ? 'card-fly' : 'animate-pulse'}>
                          {revealed ? <Card card={d.card} size="sm" /> : <CardBackFace size="sm" />}
                        </div>
                        <span
                          className={cn('font-serif font-bold truncate max-w-[9rem] text-center leading-tight', isMe ? 'text-amber-200' : 'text-amber-50')}
                          style={{ fontSize: 'var(--font-sm)' }}
                        >
                          {revealed ? (
                            <>
                              {p?.name ?? '—'}
                              {isMe ? ' (you)' : ''}
                            </>
                          ) : (
                            <span className="text-amber-100/50">• • •</span>
                          )}
                        </span>
                        <span className="font-serif italic text-amber-200/90 flex items-center gap-1 leading-tight whitespace-nowrap" style={{ fontSize: 'var(--font-xs)' }}>
                          {revealed ? (
                            <>
                              <RoleBadge role={p?.role} /> {p?.role ? getRoleName(p.role) : ''}
                            </>
                          ) : (
                            <span className="text-amber-100/40">awaiting the draw…</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {onContinueSeating ? (
                  <button
                    onClick={onContinueSeating}
                    className="mt-1 px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-purple-950 font-heading font-bold border-2 border-amber-300 shadow-lg transition-transform hover:-translate-y-0.5"
                    style={{ fontSize: 'var(--font-sm)' }}
                  >
                    {seatsRevealed >= seatingCount ? 'Take your seats — deal the cards' : 'Skip the draw & deal now'}
                  </button>
                ) : (
                  <p className="font-serif italic text-amber-100/70" style={{ fontSize: 'var(--font-xs)' }}>
                    The Greater Peon will shuffle and deal in a moment…
                  </p>
                )}
              </div>
            )}

            {/* deck stack while dealing */}
            {dealing && (
              <div className="flex flex-col items-center gap-2">
                <div className="relative deck-pulse" style={{ width: 'var(--card-w-lg)', height: 'var(--card-h-lg)' }}>
                  {[4, 3, 2, 1, 0].map((layer) => (
                    <div key={layer} className="absolute inset-0" style={{ transform: `translate(${layer * -2}px, ${layer * -2}px)` }}>
                      <CardBackFace size="lg" />
                    </div>
                  ))}
                </div>
                <p className="font-serif font-bold text-amber-200 bg-black/40 rounded-full px-3 py-0.5 border border-amber-400/30" style={{ fontSize: 'var(--font-sm)' }}>
                  Dealing… {totalCards - dealTick} left
                </p>
              </div>
            )}

            {/* tribute showcase */}
            {!dealing && !seating && inTaxes && (
              <div className="rounded-2xl px-5 py-3 bg-black/35 border-2 border-amber-400/40 shadow-inner flex flex-col items-center gap-2 max-w-[92vw]">
                {myTributeDue ? (
                  <>
                    <p className="font-heading font-bold text-amber-300 italic flex items-center gap-2" style={{ fontSize: 'var(--font-base)' }}>
                      <Coins size="1em" /> Tribute exchange
                    </p>
                    <p className="text-amber-100/90 font-serif" style={{ fontSize: 'var(--font-sm)' }}>
                      Sealed tribute from <span className="font-bold text-amber-300">{receivingFrom?.name}</span>:
                    </p>
                    <div className="flex gap-2">
                      {receivingCards.map((c, i) => (
                        <div key={c.id} className="card-fly rounded-md" style={{ animationDelay: `${i * 0.12}s` }}>
                          <CardBackFace size="lg" />
                        </div>
                      ))}
                    </div>
                    <p className="text-amber-100/80 font-serif italic" style={{ fontSize: 'var(--font-xs)' }}>
                      The seal breaks once you submit your {tributeCount} card{tributeCount > 1 ? 's' : ''} — then the cards slide into your hand.
                    </p>
                  </>
                ) : (iAmGP || iAmLP) && tax ? (
                  <>
                    <p className="font-heading font-bold text-amber-300 italic" style={{ fontSize: 'var(--font-base)' }}>
                      Your surrender
                    </p>
                    <div className="flex gap-2">
                      {(iAmGP ? tax.greaterPeonCardsGiven : tax.lesserPeonCardGiven ? [tax.lesserPeonCardGiven] : []).map((c) => (
                        <Card key={c.id} card={c} size="lg" />
                      ))}
                    </div>
                    <p className="text-amber-100/80 font-serif italic" style={{ fontSize: 'var(--font-xs)' }}>
                      Handed to the {iAmGP ? 'Greater' : 'Lesser'} Dalmuti.
                    </p>
                  </>
                ) : (
                  <TaxCentre state={state} myPlayerId={myPlayerId} />
                )}
              </div>
            )}

            {/* played pile */}
            {!dealing && !seating && !inTaxes && (
              <div className="rounded-2xl px-5 py-3 bg-black/25 border border-amber-400/20 shadow-inner flex flex-col items-center gap-2">
                {state.lastValidPlay ? (
                  <>
                    <p className="text-amber-200 font-serif text-center" style={{ fontSize: 'var(--font-sm)' }}>
                      <span className="font-bold text-amber-300">
                        {state.players.find((p) => p.id === state.lastValidPlay!.playerId)?.name ?? 'Someone'}
                      </span>{' '}
                      played {describeSet(state.lastValidPlay.cards)} - beat it or pass
                    </p>
                    <div className="flex">
                      {state.lastValidPlay.cards.map((c, i) => (
                        <div key={c.id} className={i > 0 ? '-ml-5' : ''} style={{ zIndex: i }}>
                          <div className="card-fly">
                            <Card card={c} size="lg" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <CardBackFace size="lg" className="opacity-40" />
                    <p className="text-amber-200/70 italic font-serif" style={{ fontSize: 'var(--font-xs)' }}>
                      Table is clear — lead any set
                    </p>
                  </>
                )}
              </div>
            )}

            {canCallRevolution && (
              <div className="bg-gradient-to-br from-red-950 to-red-800 border-2 border-amber-400 rounded-xl p-3 text-center shadow-2xl max-w-[22rem] fade-in">
                <p className="text-amber-300 font-serif font-bold mb-1" style={{ fontSize: 'var(--font-base)' }}>
                  🃏 Two Jesters! 🃏
                </p>
                <p className="text-amber-100/90 mb-2 font-serif italic leading-snug" style={{ fontSize: 'var(--font-xs)' }}>
                  {myPlayer.role === 'greater-peon'
                    ? 'As Greater Peon you may call a GREATER REVOLUTION — every rank is reversed!'
                    : 'You may call a revolution to abolish taxation this hand.'}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => onRevolution(myPlayer.role === 'greater-peon')}
                    className="flex-1 py-1.5 bg-amber-500 hover:bg-amber-400 text-red-950 font-bold rounded-lg font-serif border-2 border-amber-300"
                    style={{ fontSize: 'var(--font-sm)' }}
                  >
                    Revolution!
                  </button>
                  <button
                    onClick={onDeclineRevolution}
                    className="flex-1 py-1.5 bg-stone-800 hover:bg-stone-700 text-amber-100 rounded-lg font-serif border-2 border-stone-600"
                    style={{ fontSize: 'var(--font-sm)' }}
                  >
                    Pay taxes
                  </button>
                </div>
              </div>
            )}

            {/* Hourglass + remaining seconds + YOUR TURN belong to the table.
                They sit at the bottom of the table area, above the hand, and
                can never be covered by the player's cards. */}
            {state.phase === 'playing' && state.timerEnabled && turnDeadline != null && (
              <HourglassTimer key={state.turnStartedAt} deadline={turnDeadline} totalMs={state.timerSeconds * 1000} />
            )}
            {isMyTurn && (
              <div className="turn-banner">
                <Swords size="1em" /> YOUR TURN
              </div>
            )}
          </div>
        </div>
      </main>

      {/* ---------------- footer: compact control bar + hand ---------------- */}
      <footer className="shrink-0 relative z-30 bg-black/55 backdrop-blur border-t-2 border-amber-400/30">
        {/* Control bar — three zones, kept optically balanced in every phase:
              [ Turn status ]   [ Actions ]   [ Card count ]
            The side columns are equal-width (1fr) so the action group is
            genuinely centred, no matter how long the status text runs or
            whether buttons are present at all (seating / dealing / out). */}
        <div
          className={cn(
            'px-2.5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 border-b border-amber-400/20',
            inTaxes && myTributeDue ? 'py-1.5' : 'py-1'
          )}
        >
          {/* zone 1 — turn status, left */}
          <div className="min-w-0 justify-self-start">
            <ActionBarStatus
              state={state}
              myPlayer={myPlayer}
              isMyTurn={isMyTurn}
              myTributeDue={!!myTributeDue}
              iAmGD={iAmGD}
              tributeCount={tributeCount}
              selectedCount={selectedCards.length}
              dealing={dealing}
            />
          </div>

          {/* zone 2 — all turn actions, centred as a group */}
          <div className="justify-self-center flex items-center gap-2 flex-wrap justify-center">
            {inTaxes && myTributeDue ? (
              <button
                onClick={() => onTribute(selectedCards)}
                disabled={selectedCards.length !== tributeCount}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-serif font-bold shadow border-2 transition-all',
                  selectedCards.length === tributeCount
                    ? 'bg-amber-500 hover:bg-amber-400 text-purple-950 border-amber-300'
                    : 'bg-stone-700/50 text-stone-400 border-stone-600/50 cursor-not-allowed'
                )}
                style={{ fontSize: 'var(--font-sm)' }}
              >
                <Coins size="1em" /> Give Tribute ({selectedCards.length}/{tributeCount})
              </button>
            ) : state.phase === 'playing' ? (
              <>
                <button
                  onClick={handlePassButton}
                  disabled={!canUsePassQueue}
                  className={cn(
                    'relative px-4 py-1.5 rounded-lg font-serif font-bold shadow border-2 transition-all',
                    passQueued
                      ? 'bg-amber-500 hover:bg-amber-400 text-purple-950 border-amber-100 pass-queue-glow'
                      : isMyTurn
                      ? 'bg-red-800 hover:bg-red-700 text-amber-50 border-red-500'
                      : canUsePassQueue
                      ? 'bg-stone-700/80 hover:bg-stone-600 text-amber-100 border-stone-400'
                      : 'bg-stone-700/40 text-stone-400 border-stone-600/40 cursor-not-allowed'
                  )}
                  style={{ fontSize: 'var(--font-sm)' }}
                  title={
                    passQueued
                      ? 'Click to cancel the queued pass'
                      : isMyTurn
                      ? 'Pass now'
                      : 'Queue a pass for when your turn arrives'
                  }
                >
                  {passQueued ? 'PASS ✓ QUEUED' : isMyTurn ? 'Pass' : 'Queue Pass'}
                </button>
                <button
                  onClick={handlePlayButton}
                  disabled={!isMyTurn || !playValid}
                  className={cn(
                    'px-4 py-1.5 rounded-lg font-serif font-bold shadow border-2 transition-all',
                    isMyTurn && playValid
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-300'
                      : 'bg-stone-700/40 text-stone-400 border-stone-600/40 cursor-not-allowed'
                  )}
                  style={{ fontSize: 'var(--font-sm)' }}
                >
                  {selectedCards.length > 0 ? `Play ${describeSet(selectedCards)}` : 'Play'}
                </button>
              </>
            ) : null}
          </div>

          {/* zone 3 — remaining card count, right */}
          <div className="min-w-0 justify-self-end text-right">
            <span
              className="inline-flex items-center gap-1.5 font-serif text-amber-100/70 whitespace-nowrap"
              style={{ fontSize: 'var(--font-xs)' }}
              title="Cards remaining in your hand"
            >
              <Layers size="1em" className="opacity-70 shrink-0" aria-hidden />
              {myPlayer.hand.length} cards
            </span>
          </div>
        </div>

        {/* the hand — always fully visible. Extra top padding leaves room for
            selected cards to lift without being clipped by the container. */}
        <div className="px-2 pt-8 pb-1.5 overflow-x-auto">
          <div className="flex justify-center items-end min-h-[calc(var(--card-h)_+_0.75rem)] min-w-min">
            {visibleHand.length === 0 && !dealing && !seating && (
              <p className="text-amber-200/70 font-serif italic py-8" style={{ fontSize: 'var(--font-sm)' }}>
                Your hand is empty — you are out for this deal.
              </p>
            )}
            {visibleHand.map((card, i) => {
              const count = visibleHand.length;
              const overlap =
                count > 18
                  ? 'calc(var(--card-w) * -0.62)'
                  : count > 14
                  ? 'calc(var(--card-w) * -0.5)'
                  : count > 10
                  ? 'calc(var(--card-w) * -0.35)'
                  : 'var(--gutter)';
              const isSel = selected.includes(card.id);
              const isReceived = receiveIds.includes(card.id);
              return (
                <div
                  key={card.id}
                  // Fixed stacking order (no z-index bump on selection) so a
                  // selected card can never cover its neighbours' hit areas.
                  style={{
                    zIndex: i,
                    marginLeft: i === 0 ? undefined : overlap,
                  }}
                >
                  <div className={isReceived ? 'card-receive' : dealing ? 'card-deal' : undefined}>
                    <Card
                      card={card}
                      selected={isSel}
                      onClick={cardsInteractive ? () => toggleCard(card) : undefined}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** Medieval hourglass with draining sand. */
function HourglassTimer({ deadline, totalMs }: { deadline: number; totalMs: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);

  const remaining = Math.max(0, deadline - now);
  const frac = Math.max(0, Math.min(1, remaining / totalMs));
  const secs = Math.ceil(remaining / 1000);
  const warn = remaining <= 5000 && remaining > 0;
  const sand = '#e8c56b';
  const sandDark = '#c9992e';
  const frame = '#d4af37';

  return (
    <div className={cn('flex flex-col items-center gap-0.5 mt-2 pointer-events-none', warn && 'hg-warn')}>
      <svg viewBox="0 0 80 96" style={{ width: 'clamp(64px, 5.6vw, 132px)', height: 'auto' }} aria-label={`${secs} seconds left`}>
        {/* frame caps */}
        <rect x="8" y="2" width="64" height="6" rx="3" fill={frame} />
        <rect x="8" y="88" width="64" height="6" rx="3" fill={frame} />
        <rect x="12" y="8" width="4" height="80" rx="2" fill={frame} opacity="0.85" />
        <rect x="64" y="8" width="4" height="80" rx="2" fill={frame} opacity="0.85" />
        {/* glass */}
        <path
          d="M18 8 C18 34 34 40 38 46 L38 50 C34 56 18 62 18 88 L62 88 C62 62 46 56 42 50 L42 46 C46 40 62 34 62 8 Z"
          fill="rgba(255,250,230,0.10)"
          stroke="rgba(255,250,230,0.45)"
          strokeWidth="1.6"
        />
        {/* top sand: shrinks toward the neck */}
        <g transform={`translate(0 ${46 * (1 - frac)}) scale(1 ${Math.max(0.001, frac)})`}>
          <path d="M20 10 C20 32 35 39 39 45 L41 45 C45 39 60 32 60 10 Z" fill={sand} />
          <path d="M20 10 L60 10 L58 15 L22 15 Z" fill={sandDark} opacity="0.7" />
        </g>
        {/* falling stream: spans from the neck down to the top of the mound */}
        {frac > 0 && remaining > 0 && (
          <rect x="39" y="46" width="2" height={8 + 34 * frac} fill={sand} className="hg-stream" />
        )}
        {/* bottom mound: grows from the base */}
        <g transform={`translate(0 ${88 * frac}) scale(1 ${Math.max(0.001, 1 - frac)})`}>
          <path d="M20 88 C24 66 36 60 40 54 C44 60 56 66 60 88 Z" fill={sand} />
          <path d="M24 88 L56 88 L52 82 L28 82 Z" fill={sandDark} opacity="0.55" />
        </g>
      </svg>
      <span
        className="font-heading font-black leading-none"
        style={{
          fontSize: 'var(--font-base)',
          color: warn ? '#fca5a5' : '#fcd34d',
          textShadow: '0 1px 8px rgba(0,0,0,0.85)',
        }}
      >
        {secs}
      </span>
      <p className="font-serif italic text-amber-200/90 flex items-center gap-1 bg-black/35 rounded-full px-2 py-0.5" style={{ fontSize: 'var(--font-tiny)' }}>
        <Hourglass size="1em" /> the sand runs out — auto-pass
      </p>
    </div>
  );
}

function ActionBarStatus({
  state,
  myPlayer,
  isMyTurn,
  myTributeDue,
  iAmGD,
  tributeCount,
  selectedCount,
  dealing,
}: {
  state: GameState;
  myPlayer: Player;
  isMyTurn: boolean;
  myTributeDue: boolean;
  iAmGD: boolean;
  tributeCount: number;
  selectedCount: number;
  dealing: boolean;
}) {
  if (state.phase === 'seating') {
    return (
      <p className="text-amber-200 font-serif italic" style={{ fontSize: 'var(--font-sm)' }}>
        Drawing cards for seats — you are the{' '}
        <span className="font-bold text-amber-300 not-italic inline-flex items-center gap-1">
          <RoleBadge role={myPlayer.role} /> {myPlayer.role ? getRoleName(myPlayer.role) : '…'}
        </span>
      </p>
    );
  }

  if (dealing) {
    return (
      <p className="text-amber-200 font-serif italic" style={{ fontSize: 'var(--font-sm)' }}>
        The Greater Peon deals the deck…
      </p>
    );
  }

  if (myTributeDue) {
    return (
      <div className="text-amber-100 font-serif leading-tight" style={{ fontSize: 'var(--font-sm)' }}>
        <span className="font-bold text-amber-300">
          Choose {tributeCount} card{tributeCount > 1 ? 's' : ''} from your hand to give the{' '}
          {iAmGD ? 'Greater' : 'Lesser'} Peon
        </span>
        {selectedCount > 0 && selectedCount !== tributeCount && (
          <span className="block text-amber-400/90" style={{ fontSize: 'var(--font-xs)' }}>
            {tributeCount - selectedCount} more to select
          </span>
        )}
      </div>
    );
  }

  if (state.phase === 'taxes') {
    return (
      <p className="text-amber-100/80 font-serif italic" style={{ fontSize: 'var(--font-sm)' }}>
        Taxation in progress — the Dalmutis are choosing their tribute…
      </p>
    );
  }

  if (myPlayer.isOut) {
    return (
      <p className="text-emerald-300 font-serif font-bold" style={{ fontSize: 'var(--font-sm)' }}>
        ✨ You finished #{myPlayer.finishOrder} — waiting for the others…
      </p>
    );
  }

  const current = state.players[state.currentPlayerIndex];
  return (
    <p className="text-amber-100 font-serif" style={{ fontSize: 'var(--font-sm)' }}>
      {isMyTurn ? (
        <span className="font-bold text-amber-300">Your turn</span>
      ) : (
        <>
          Waiting on{' '}
          <span className="font-bold text-amber-300 inline-flex items-center gap-1.5">
            <RoleBadge role={current?.role} /> {current?.name ?? '…'}
          </span>
        </>
      )}
    </p>
  );
}

function TaxCentre({ state, myPlayerId }: { state: GameState; myPlayerId: string }) {
  const tax = state.pendingTaxes!;
  const gd = state.players.find((p) => p.id === tax.greaterDalmutiId);
  const ld = tax.lesserDalmutiId ? state.players.find((p) => p.id === tax.lesserDalmutiId) : null;

  const rows: { who: Player | undefined; done: boolean; label: string }[] = [
    { who: gd ?? undefined, done: tax.greaterDalmutiCardsGiven !== null, label: 'Greater Dalmuti · 2 cards' },
  ];
  if (tax.lesserExchangeRequired) {
    rows.push({
      who: ld ?? undefined,
      done: tax.lesserDalmutiCardGiven !== null,
      label: 'Lesser Dalmuti · 1 card',
    });
  }

  return (
    <div className="text-center">
      <p className="text-amber-300 font-serif font-bold mb-1 flex items-center gap-2 justify-center" style={{ fontSize: 'var(--font-base)' }}>
        <Coins size="1em" /> Taxation
      </p>
      <div className="space-y-1">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2 text-amber-100/85 justify-center font-serif" style={{ fontSize: 'var(--font-xs)' }}>
            <span className={r.done ? 'text-emerald-400 font-bold' : 'text-amber-400'}>{r.done ? '✔' : '⏳'}</span>
            <span className={cn(r.who?.id === myPlayerId && 'font-bold text-amber-300')}>{r.who?.name ?? '—'}</span>
            <span className="text-amber-100/50">{r.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function OpponentRing({
  opponents,
  state,
  dealing,
  myIdx,
  totalPlayers,
  canKick,
  onKick,
  dealtFor,
}: {
  opponents: Player[];
  state: GameState;
  dealing: boolean;
  myIdx: number;
  totalPlayers: number;
  canKick: boolean;
  onKick: (id: string) => void;
  dealtFor: ((seatIdxInPlayers: number) => number) | null;
}) {
  return (
    <>
      {opponents.map((opp) => {
        const seatIdx = state.players.findIndex((p) => p.id === opp.id);
        const k = (seatIdx - myIdx + totalPlayers) % totalPlayers;
        const seat = tableSeat(k, totalPlayers);
        const isCurrent =
          state.phase === 'playing' && state.players[state.currentPlayerIndex]?.id === opp.id;
        const owesTribute =
          state.phase === 'taxes' &&
          state.pendingTaxes &&
          ((state.pendingTaxes.greaterDalmutiId === opp.id &&
            state.pendingTaxes.greaterDalmutiCardsGiven === null) ||
            (state.pendingTaxes.lesserDalmutiId === opp.id &&
              state.pendingTaxes.lesserExchangeRequired &&
              state.pendingTaxes.lesserDalmutiCardGiven === null));
        const passed = state.passedIds.includes(opp.id);
        const afk = state.afkCounts[opp.id] ?? 0;
        const leaving = !!opp.leavingAfterRound;

        const shownCount = dealing && dealtFor ? dealtFor(seatIdx) : opp.hand.length;
        const shown = Math.min(shownCount, 7);
        const tilt = (seat.angle - 180) * 0.12;
        return (
          <div
            key={opp.id}
            className="absolute flex flex-col items-center"
            style={{
              left: `${seat.x}%`,
              top: `${seat.y}%`,
              transform: `translate(-50%, -50%) rotate(${tilt}deg)`,
            }}
          >
            <div
              className={cn(
                'px-2 py-0.5 rounded-md border text-center mb-1 transition-all backdrop-blur-sm',
                isCurrent
                  ? 'bg-amber-400/90 border-amber-200 shadow-lg shadow-amber-500/40 scale-105'
                  : owesTribute
                  ? 'bg-purple-800/80 border-amber-400/60'
                  : 'bg-black/55 border-amber-700/40',
                opp.isOut && 'opacity-45 grayscale',
                passed && !opp.isOut && 'opacity-60'
              )}
            >
              <p
                className={cn(
                  'font-serif font-bold leading-tight max-w-[11rem] truncate',
                  isCurrent ? 'text-purple-950' : 'text-amber-100'
                )}
                style={{ fontSize: 'var(--font-sm)' }}
              >
                <span className="inline-flex items-center gap-1.5">
                  <RoleBadge role={opp.role} /> {opp.name}
                </span>
              </p>
              <p
                className={cn('leading-tight', isCurrent ? 'text-purple-900/80' : 'text-amber-200/70')}
                style={{ fontSize: 'var(--font-tiny)' }}
              >
                {opp.isOut && opp.finishOrder && opp.finishOrder < 900
                  ? `finished #${opp.finishOrder}`
                  : owesTribute
                  ? 'choosing tribute…'
                  : `${opp.role ? getRoleName(opp.role) + ' · ' : ''}${shownCount} cards`}
              </p>
              {/* badges: PASSED / AFK / leaving / kick */}
              <div className="flex items-center justify-center gap-1 mt-0.5 min-h-[1.2em] flex-wrap">
                {leaving && (
                  <span className="inline-flex items-center gap-1 px-1.5 rounded-full bg-amber-800/90 border border-amber-300/70 text-amber-50 font-heading font-bold" style={{ fontSize: 'var(--font-tiny)' }}>
                    <DoorOpen size="1em" /> Leaving After This Round
                  </span>
                )}
                {passed && !opp.isOut && (
                  <span className="inline-flex items-center gap-1 px-1.5 rounded-full bg-stone-700/90 border border-stone-400/70 text-stone-100 font-heading font-bold" style={{ fontSize: 'var(--font-tiny)' }}>
                    <Ban size="1em" /> PASSED
                  </span>
                )}
                {afk === 1 && (
                  <span className="inline-flex items-center gap-1 px-1.5 rounded-full bg-amber-600/90 border border-amber-300/70 text-amber-50 font-heading font-bold" style={{ fontSize: 'var(--font-tiny)' }}>
                    <AlarmClock size="1em" /> missed turn
                  </span>
                )}
                {afk >= 2 && (
                  <span className="inline-flex items-center gap-1 px-1.5 rounded-full bg-red-700/90 border border-red-300/70 text-red-50 font-heading font-bold" style={{ fontSize: 'var(--font-tiny)' }}>
                    <UserX size="1em" /> AFK
                  </span>
                )}
                {canKick && afk >= 2 && !opp.kicked && !opp.isOut && (
                  <button
                    onClick={() => onKick(opp.id)}
                    className="inline-flex items-center gap-1 px-1.5 rounded-full bg-red-900 hover:bg-red-700 border border-red-400/70 text-red-100 font-heading font-bold transition-colors"
                    style={{ fontSize: 'var(--font-tiny)' }}
                    title={`Kick ${opp.name} (missed ${afk} turns)`}
                  >
                    <UserMinus size="1em" /> Kick
                  </button>
                )}
              </div>
            </div>
            <div className="flex items-end" style={{ minHeight: 'var(--card-h-xs)' }}>
              {Array.from({ length: shown }).map((_, ci) => (
                <div key={ci} className={ci > 0 ? '-ml-4' : ''} style={{ zIndex: ci }}>
                  <div className={dealing ? 'card-deal' : undefined}>
                    <CardBackFace size="xs" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function LeaveDialog({
  canScheduleLeave,
  onLeaveNow,
  onScheduleLeave,
  onCancel,
}: {
  canScheduleLeave: boolean;
  onLeaveNow: () => void;
  onScheduleLeave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-gradient-to-br from-amber-50 to-amber-100 rounded-2xl border-4 border-purple-900/40 p-6 max-w-sm w-full slide-up text-center">
        <button onClick={onCancel} className="absolute top-3 right-3 text-amber-800/70 hover:text-amber-950" aria-label="Close">
          <X size="1.2rem" />
        </button>
        <DoorOpen className="mx-auto mb-2 text-purple-800" size="2.4rem" />
        <p className="font-heading font-black text-purple-900 italic mb-4" style={{ fontSize: 'var(--font-base)' }}>
          Leave Game
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={onLeaveNow}
            className="w-full py-2.5 flex items-center justify-center gap-2 bg-red-800 hover:bg-red-700 text-red-50 rounded-lg font-serif font-bold"
            style={{ fontSize: 'var(--font-sm)' }}
          >
            <LogOut size="1em" /> Leave Now
          </button>
          {canScheduleLeave && (
            <button
              onClick={onScheduleLeave}
              className="w-full py-2.5 flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-purple-950 rounded-lg font-serif font-bold border-2 border-amber-300"
              style={{ fontSize: 'var(--font-sm)' }}
            >
              <DoorOpen size="1em" /> Leave After This Round
            </button>
          )}
          <button
            onClick={onCancel}
            className="w-full py-2.5 bg-stone-200 hover:bg-stone-300 text-stone-800 rounded-lg font-serif font-bold"
            style={{ fontSize: 'var(--font-sm)' }}
          >
            Cancel
          </button>
        </div>
        {canScheduleLeave && (
          <p className="font-serif italic text-amber-800/80 mt-3" style={{ fontSize: 'var(--font-tiny)' }}>
            Leaving after this round keeps you seated until the current hand ends, then you're
            removed from the lobby automatically. You can change your mind any time before then.
          </p>
        )}
      </div>
    </div>
  );
}

/** Read-only view for a joined-but-unseated observer (lobby overflow, or joined mid-game). */
function SpectatorView({
  state,
  chat,
  onSendChat,
  onBackToLobby,
}: {
  state: GameState;
  chat: ChatMessage[];
  onSendChat: (text: string) => void;
  onBackToLobby?: () => void;
}) {
  const [showScore, setShowScore] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const n = state.players.length;

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden">
      <div className="great-table z-[1]" />

      {showScore && <ScorePanel state={state} myPlayerId="" onClose={() => setShowScore(false)} />}
      <ChatPanel open={showChat} messages={chat} myName="Spectator" onSend={onSendChat} onClose={() => setShowChat(false)} />

      <header className="shrink-0 relative z-30 bg-black/45 backdrop-blur border-b border-amber-400/25 px-3 py-1.5 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="font-heading italic font-bold text-amber-300 leading-none truncate" style={{ fontSize: 'var(--font-lg)' }}>
            The Great Dalmuti
          </h1>
          <p className="text-amber-100/60 leading-tight" style={{ fontSize: 'var(--font-xs)' }}>Hand {state.handNumber}</p>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-sky-400/10 border border-sky-400/30">
          <Eye size="1em" className="text-sky-300" />
          <p className="font-serif font-bold text-sky-300" style={{ fontSize: 'var(--font-sm)' }}>Spectating</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowScore(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-purple-950 font-serif font-bold rounded-lg shadow-md border-2 border-amber-900/30"
            style={{ fontSize: 'var(--font-sm)' }}
          >
            <Trophy size="1em" /> Scores
          </button>
          <button
            onClick={() => setShowChat(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-700 hover:bg-purple-600 text-amber-100 font-serif font-bold rounded-lg shadow-md border-2 border-amber-400/30"
            style={{ fontSize: 'var(--font-sm)' }}
          >
            <MessageCircle size="1em" /> Chat
          </button>
          {onBackToLobby && (
            <button
              onClick={onBackToLobby}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-red-900/70 hover:bg-red-800 text-amber-100 rounded-lg border border-red-400/30"
              style={{ fontSize: 'var(--font-xs)' }}
            >
              <LogOut size="1em" /> Leave
            </button>
          )}
        </div>
      </header>

      <div className="shrink-0 relative z-20 bg-purple-950/50 border-b border-amber-400/20 py-1 px-3 text-center">
        <p className="font-serif text-amber-100 truncate" style={{ fontSize: 'var(--font-sm)' }}>{state.message}</p>
      </div>

      <main className="flex-1 relative min-h-0 z-10">
        <OpponentRing
          opponents={state.players}
          state={state}
          dealing={state.phase === 'dealing'}
          myIdx={-1}
          totalPlayers={n}
          canKick={false}
          onKick={() => {}}
          dealtFor={null}
        />

        <div className="absolute inset-0 flex items-center justify-center px-2 pointer-events-none">
          <div className="rounded-2xl px-5 py-3 bg-black/25 border border-amber-400/20 shadow-inner flex flex-col items-center gap-2 pointer-events-auto">
            {state.phase === 'taxes' && state.pendingTaxes ? (
              <TaxCentre state={state} myPlayerId="" />
            ) : state.lastValidPlay ? (
              <>
                <p className="text-amber-200 font-serif text-center" style={{ fontSize: 'var(--font-sm)' }}>
                  <span className="font-bold text-amber-300">
                    {state.players.find((p) => p.id === state.lastValidPlay!.playerId)?.name ?? 'Someone'}
                  </span>{' '}
                  played {describeSet(state.lastValidPlay.cards)}
                </p>
                <div className="flex">
                  {state.lastValidPlay.cards.map((c, i) => (
                    <div key={c.id} className={i > 0 ? '-ml-5' : ''} style={{ zIndex: i }}>
                      <Card card={c} size="lg" />
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <CardBackFace size="lg" className="opacity-40" />
                <p className="text-amber-200/70 italic font-serif" style={{ fontSize: 'var(--font-xs)' }}>
                  {state.phase === 'dealing' ? 'Dealing the deck…' : state.phase === 'seating' ? 'Drawing for seats…' : 'Table is clear'}
                </p>
              </>
            )}
          </div>
        </div>
      </main>

      <footer className="shrink-0 relative z-30 bg-black/50 backdrop-blur border-t-2 border-amber-400/30 py-3 text-center">
        <p className="font-serif italic text-amber-200/80" style={{ fontSize: 'var(--font-xs)' }}>
          <Eye size="1em" className="inline mr-1.5 -mt-0.5" />
          You're watching this game. A seat will open up once it ends.
        </p>
      </footer>
    </div>
  );
}

function KickDialog({
  name,
  onChoose,
  onCancel,
}: {
  name: string;
  onChoose: (kind: 'remove' | 'ai') => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-gradient-to-br from-amber-50 to-amber-100 rounded-2xl border-4 border-red-900/50 p-6 max-w-sm w-full slide-up text-center">
        <UserX className="mx-auto mb-2 text-red-800" size="2.4rem" />
        <p className="font-heading font-black text-red-900 italic mb-1" style={{ fontSize: 'var(--font-base)' }}>
          Remove {name}?
        </p>
        <p className="font-serif text-amber-800 mb-4" style={{ fontSize: 'var(--font-xs)' }}>
          They have missed two turns. Replacing the seat with an AI keeps the hand going; removing it
          empties the chair until the next deal.
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => onChoose('ai')}
            className="w-full py-2 flex items-center justify-center gap-2 bg-purple-800 hover:bg-purple-700 text-amber-100 rounded-lg font-serif font-bold"
            style={{ fontSize: 'var(--font-sm)' }}
          >
            <Bot size="1em" /> Replace with an AI
          </button>
          <button
            onClick={() => onChoose('remove')}
            className="w-full py-2 flex items-center justify-center gap-2 bg-red-800 hover:bg-red-700 text-red-50 rounded-lg font-serif font-bold"
            style={{ fontSize: 'var(--font-sm)' }}
          >
            <UserMinus size="1em" /> Remove from the table
          </button>
          <button onClick={onCancel} className="w-full py-2 bg-stone-200 hover:bg-stone-300 text-stone-800 rounded-lg font-serif font-bold" style={{ fontSize: 'var(--font-sm)' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function KickedScreen({ kind, onLeave }: { kind: 'remove' | 'ai'; onLeave?: () => void }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ background: 'radial-gradient(ellipse at center, #4a1a6b 0%, #1a0a2e 55%, #0a0518 100%)' }}>
      <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-2xl shadow-2xl border-4 border-red-900/40 p-7 max-w-md w-full text-center slide-up">
        <UserX className="mx-auto mb-3 text-red-800" size="3rem" />
        <h2 className="font-heading font-black text-red-900 italic mb-2" style={{ fontSize: 'var(--font-xl)' }}>
          You left the table
        </h2>
        <p className="font-serif text-amber-900 mb-5" style={{ fontSize: 'var(--font-sm)' }}>
          {kind === 'ai'
            ? 'The host handed your seat to a court AI for the rest of this hand.'
            : 'The host removed your seat from this hand.'}{' '}
          You can head back to the lobby and join the next game.
        </p>
        {onLeave && (
          <button
            onClick={onLeave}
            className="w-full py-3 flex items-center justify-center gap-2 bg-purple-800 hover:bg-purple-700 text-amber-100 font-serif font-bold rounded-lg shadow-lg"
            style={{ fontSize: 'var(--font-base)' }}
          >
            <DoorOpen size="1em" /> Return to the lobby
          </button>
        )}
      </div>
    </div>
  );
}

function HandEndScreen({
  state,
  myPlayerId,
  isHost,
  onNextHand,
  onReturnToLobby,
  onBackToLobby,
}: {
  state: GameState;
  myPlayerId: string;
  isHost: boolean;
  onNextHand: () => void;
  onReturnToLobby?: () => void;
  onBackToLobby?: () => void;
}) {
  const [confirmReturn, setConfirmReturn] = useState(false);
  const last = state.handResults[state.handResults.length - 1];
  const roles: Role[] = rolesForSeating(state.players.length);
  const me = last?.standings.find((s) => s.playerId === myPlayerId);
  const myNewRoleIdx = last ? last.standings.findIndex((s) => s.playerId === myPlayerId) : 0;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4 overflow-y-auto"
      style={{
        backgroundImage: 'radial-gradient(ellipse at center, #4a1a6b 0%, #1a0a2e 55%, #0a0518 100%)',
      }}
    >
      {me?.place === 1 && <Fireworks big />}
      {me?.place === 2 && <Fireworks big={false} />}
      <div className="relative bg-gradient-to-br from-amber-50 to-amber-100 rounded-2xl shadow-2xl border-4 border-amber-900/30 p-6 max-w-xl w-full fade-in my-4">
        <div className="text-center mb-4">
          <div className="mb-1" style={{ fontSize: 'var(--font-xxl)' }}>
            {me?.place === 1 ? (
              <Crown className="inline text-amber-500" size="1em" />
            ) : (
              <RoleBadge role={roles[myNewRoleIdx] ?? 'merchant'} />
            )}
          </div>
          <h2 className="font-heading font-black text-purple-900 italic leading-tight" style={{ fontSize: 'var(--font-xl)' }}>
            Hand {last?.hand ?? state.handNumber} over
          </h2>
          <p className="text-amber-800 font-serif italic" style={{ fontSize: 'var(--font-sm)' }}>
            {me ? `You finished #${me.place} and earn ${me.points} point${me.points === 1 ? '' : 's'}.` : ''}{' '}
            Next hand you are the {getRoleName(roles[myNewRoleIdx] ?? 'merchant')}.
          </p>
        </div>

        <div className="mb-5 space-y-1">
          {(last?.standings ?? []).map((st, i) => {
            const isMe = st.playerId === myPlayerId;
            return (
              <div
                key={st.playerId}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-lg border',
                  isMe ? 'bg-purple-200 border-purple-500' : 'bg-white/60 border-amber-300'
                )}
              >
                <span className="font-serif font-black text-amber-900 w-8" style={{ fontSize: 'var(--font-base)' }}>
                  #{st.place}
                </span>
                <span style={{ fontSize: 'var(--font-base)' }}>
                  <RoleBadge role={roles[i]} />
                </span>
                <span
                  className={cn('font-serif flex-1 truncate', isMe ? 'text-purple-900 font-bold' : 'text-amber-900')}
                  style={{ fontSize: 'var(--font-sm)' }}
                >
                  {st.name}
                  {isMe && ' (You)'}
                </span>
                <span className="font-serif italic text-amber-800 hidden sm:block" style={{ fontSize: 'var(--font-xs)' }}>
                  {getRoleName(roles[i])}
                </span>
                <span className="font-heading font-black text-emerald-700 w-10 text-right" style={{ fontSize: 'var(--font-base)' }}>
                  +{st.points}
                </span>
                <span className="font-serif text-purple-800 w-14 text-right" style={{ fontSize: 'var(--font-xs)' }}>
                  {state.totalScores[st.playerId] ?? 0} total
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-2">
          {isHost ? (
            <>
              <button
                onClick={onNextHand}
                className="w-full py-3 bg-gradient-to-r from-purple-700 to-purple-900 hover:from-purple-600 hover:to-purple-800 text-amber-100 font-serif font-bold rounded-lg shadow-lg border-2 border-amber-400/30 transition-transform hover:-translate-y-0.5"
                style={{ fontSize: 'var(--font-base)' }}
              >
                Start Next Game
              </button>
              {onReturnToLobby && (
                <button
                  onClick={() => setConfirmReturn(true)}
                  className="w-full py-2.5 flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-purple-950 font-serif font-bold rounded-lg shadow-lg border-2 border-amber-300 transition-transform hover:-translate-y-0.5"
                  style={{ fontSize: 'var(--font-sm)' }}
                >
                  <DoorOpen size="1em" /> Return To Lobby
                </button>
              )}
            </>
          ) : (
            <p className="text-center text-amber-800 font-serif italic py-2" style={{ fontSize: 'var(--font-sm)' }}>
              Waiting for the host to deal the next hand…
            </p>
          )}
          {onBackToLobby && (
            <button
              onClick={onBackToLobby}
              className="w-full py-2 flex items-center justify-center gap-2 bg-stone-200 hover:bg-stone-300 text-stone-800 font-serif rounded-lg"
              style={{ fontSize: 'var(--font-sm)' }}
            >
              <LogOut size="1em" /> Leave Game
            </button>
          )}
        </div>
      </div>

      {confirmReturn && onReturnToLobby && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmReturn(false)} />
          <div className="relative bg-gradient-to-br from-amber-50 to-amber-100 rounded-2xl border-4 border-amber-900/40 p-6 max-w-sm w-full slide-up text-center">
            <DoorOpen className="mx-auto mb-2 text-purple-800" size="2.4rem" />
            <p className="font-heading font-black text-purple-900 italic mb-1" style={{ fontSize: 'var(--font-base)' }}>
              Return everyone to the lobby?
            </p>
            <p className="font-serif text-amber-800 mb-4" style={{ fontSize: 'var(--font-xs)' }}>
              The table stays open, nobody is disconnected, and ready status resets so new guests can join.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmReturn(false)} className="flex-1 py-2 bg-stone-200 hover:bg-stone-300 text-stone-800 rounded-lg font-serif font-bold" style={{ fontSize: 'var(--font-sm)' }}>
                Cancel
              </button>
              <button
                onClick={() => {
                  setConfirmReturn(false);
                  onReturnToLobby();
                }}
                className="flex-1 py-2 bg-purple-800 hover:bg-purple-700 text-amber-100 rounded-lg font-serif font-bold"
                style={{ fontSize: 'var(--font-sm)' }}
              >
                Return To Lobby
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


