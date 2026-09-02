import { useState, useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { Card as CardType, ChatMessage, GameState, Player, Role } from '../game/types';
import { CARD_INFO, countJesters } from '../game/cards';
import { canPlayCards, getRoleName, describeSet, rolesForSeating, TURN_TIMER_MS } from '../game/logic';
import { Card, CardBackFace } from './Card';
import { ScorePanel } from './ScorePanel';
import { ChatPanel } from './ChatPanel';
import { RoleBadge } from './RoleBadge';
import { Fireworks } from './Celebrate';
import { cn } from '../utils/cn';
import { Trophy, MessageCircle, LogOut, Crown, Coins, Hourglass } from 'lucide-react';
import greatHall from '../assets/great-hall.jpg';

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

interface GameTableProps {
  state: GameState;
  myPlayerId: string;
  isHost: boolean;
  revolutionDeclined: boolean;
  chat: ChatMessage[];
  /** epoch ms when the current turn's 60s hourglass empties (null when not playing / timer off) */
  turnDeadline?: number | null;
  /** host-only: skip the opening seat-draw reveal and start dealing now */
  onContinueSeating?: () => void;
  onSendChat: (text: string) => void;
  onPlay: (cards: CardType[]) => void;
  onPass: () => void;
  onTribute: (cards: CardType[]) => void;
  onRevolution: (greaterRevolution: boolean) => void;
  onDeclineRevolution: () => void;
  onNextHand: () => void;
  onBackToLobby?: () => void;
}

const DEAL_TICK_MS = 45;

export function GameTable(props: GameTableProps) {
  const {
    state,
    myPlayerId,
    isHost,
    revolutionDeclined,
    chat,
    turnDeadline,
    onContinueSeating,
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

  const prevPhaseRef = useRef(state.phase);
  const prevHandIdsRef = useRef<Set<string>>(new Set(myPlayer?.hand.map((c) => c.id) ?? []));

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

  /* -------- celebration when I finish 1st or 2nd -------- */
  const myPlace = myPlayer?.finishOrder;
  useEffect(() => {
    if (myPlace !== 1 && myPlace !== 2) return;
    setCelebrate(myPlace === 1 ? 'big' : 'small');
    const t = setTimeout(() => setCelebrate(null), 3800);
    return () => clearTimeout(t);
  }, [myPlace]);

  /* -------- sealed tribute: reveal my received cards only after I submit -------- */
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
  useEffect(() => {
    if (!showChat) setUnread((u) => u + 0);
  }, [showChat]);
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
    !myPlayer?.isOut;

  const cardsInteractive = (isMyTurn && state.phase === 'playing') || !!myTributeDue;

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

  if (!myPlayer) {
    return (
      <div className="h-screen flex items-center justify-center text-amber-200 font-serif" style={{ fontSize: 'var(--font-xl)' }}>
        Waiting for the deal…
      </div>
    );
  }

  if (state.phase === 'hand-end') {
    return (
      <HandEndScreen
        state={state}
        myPlayerId={myPlayerId}
        isHost={isHost}
        onNextHand={onNextHand}
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

  // cards I am about to receive (shown face-up in the centre during taxes)
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
    <div
      className="fixed inset-0 flex flex-col overflow-hidden"
    >
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${greatHall})`, filter: 'brightness(0.72) saturate(1.1)' }}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/70" />
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

      {/* ---------------- header ---------------- */}
      <header className="shrink-0 relative z-30 bg-black/45 backdrop-blur border-b border-amber-400/25 px-3 py-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="font-heading italic font-bold text-amber-300 leading-none truncate" style={{ fontSize: 'var(--font-lg)' }}>
            The Great Dalmuti
          </h1>
          <p className="text-amber-100/60 leading-tight flex items-center gap-1.5" style={{ fontSize: 'var(--font-xs)' }}>
            Hand {state.handNumber}
            <span className="text-amber-100/30">·</span>
            <span className={cn('inline-flex items-center gap-1', state.timerEnabled ? 'text-amber-200/80' : 'text-amber-100/45')}>
              <Hourglass size="1em" /> {state.timerEnabled ? '60 s turns' : 'no timer'}
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
              onClick={onBackToLobby}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-red-900/70 hover:bg-red-800 text-amber-100 rounded-lg border border-red-400/30"
              style={{ fontSize: 'var(--font-xs)' }}
            >
              <LogOut size="1em" /> Leave
            </button>
          )}
        </div>
      </header>

      {/* ---------------- message banner ---------------- */}
      <div className="shrink-0 relative z-20 bg-purple-950/50 border-b border-amber-400/20 py-1 px-3 text-center">
        <p className="font-serif text-amber-100 truncate" style={{ fontSize: 'var(--font-sm)' }}>
          {state.message}
        </p>
      </div>

      {/* ---------------- table ---------------- */}
      <main className="flex-1 relative min-h-0 z-10">
        {/* tribute reveal banner — appears for a few seconds after I submit */}
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

        {/* finishing celebration */}
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
          dealtFor={
            seating
              ? () => 0
              : dealing
              ? (oppSeatIdxInPlayers: number) => dealtFor(oppSeatIdxInPlayers, dealTick)
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
            {/* action buttons above the pile */}
            {!dealing && (state.phase === 'playing' || inTaxes) && !myPlayer.isOut && (
              <div className="flex gap-2 mb-1">
                {inTaxes && myTributeDue ? (
                  <button
                    onClick={() => onTribute(selectedCards)}
                    disabled={selectedCards.length !== tributeCount}
                    className={cn(
                      'flex items-center gap-2 px-5 py-2 rounded-xl font-serif font-bold shadow-lg border-2 transition-all',
                      selectedCards.length === tributeCount
                        ? 'bg-amber-500 hover:bg-amber-400 text-purple-950 border-amber-300 hover:-translate-y-0.5'
                        : 'bg-stone-700/50 text-stone-400 border-stone-600/50 cursor-not-allowed'
                    )}
                    style={{ fontSize: 'var(--font-base)' }}
                  >
                    <Coins size="1em" /> Give Tribute ({selectedCards.length}/{tributeCount})
                  </button>
                ) : state.phase === 'playing' ? (
                  <>
                    <button
                      onClick={onPass}
                      disabled={!isMyTurn}
                      className={cn(
                        'px-5 py-2 rounded-xl font-serif font-bold shadow-lg border-2 transition-all',
                        isMyTurn
                          ? 'bg-red-800 hover:bg-red-700 text-amber-50 border-red-500 hover:-translate-y-0.5'
                          : 'bg-stone-700/40 text-stone-400 border-stone-600/40 cursor-not-allowed'
                      )}
                      style={{ fontSize: 'var(--font-base)' }}
                    >
                      Pass
                    </button>
                    <button
                      onClick={() => onPlay(selectedCards)}
                      disabled={!isMyTurn || !playValid}
                      className={cn(
                        'px-5 py-2 rounded-xl font-serif font-bold shadow-lg border-2 transition-all',
                        isMyTurn && playValid
                          ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-300 hover:-translate-y-0.5'
                          : 'bg-stone-700/40 text-stone-400 border-stone-600/40 cursor-not-allowed'
                      )}
                      style={{ fontSize: 'var(--font-base)' }}
                    >
                      {selectedCards.length > 0 ? `Play ${describeSet(selectedCards)}` : 'Play'}
                    </button>
                  </>
                ) : null}
              </div>
            )}

            {/* the opening draw for seats — first hand only */}
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
                {/* progress chip */}
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
                        <span
                          className="font-heading font-black text-amber-200/80 leading-none"
                          style={{ fontSize: 'var(--font-xs)' }}
                        >
                          #{i + 1}
                        </span>
                        {/* remount on reveal so the flip-in animation plays exactly once */}
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
                        <span
                          className="font-serif italic text-amber-200/90 flex items-center gap-1 leading-tight whitespace-nowrap"
                          style={{ fontSize: 'var(--font-xs)' }}
                        >
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
                    {seatsRevealed >= seatingCount
                      ? 'Take your seats — deal the cards'
                      : 'Skip the draw & deal now'}
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
                    <div
                      key={layer}
                      className="absolute inset-0"
                      style={{ transform: `translate(${layer * -2}px, ${layer * -2}px)` }}
                    >
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
            {!dealing && inTaxes && (
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

            {/* the turn hourglass — counts down beneath the centre cards */}
            {state.phase === 'playing' &&
              turnDeadline != null &&
              !state.players[state.currentPlayerIndex]?.isOut && (
                <TurnClock key={state.turnStartedAt} deadline={turnDeadline} totalMs={TURN_TIMER_MS} />
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
          </div>
        </div>
      </main>

      {/* ---------------- footer ---------------- */}
      <footer className="shrink-0 relative z-30 bg-black/50 backdrop-blur border-t-2 border-amber-400/30">
        <div className="px-3 py-1 flex items-center justify-between gap-2 border-b border-white/5 min-h-[2.4rem]">
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
          <p className="text-amber-100/70 font-serif whitespace-nowrap" style={{ fontSize: 'var(--font-xs)' }}>
            {myPlayer.hand.length} cards
          </p>
        </div>

        <div className="px-2 py-2 overflow-x-auto">
          <div className="flex justify-center items-end min-h-[calc(var(--card-h)_+_1.8rem)] pt-5 min-w-min">
            {visibleHand.length === 0 && !dealing && (
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
                  className="relative"
                  style={{
                    zIndex: isSel ? 200 + i : i,
                    marginLeft: i === 0 ? undefined : overlap,
                  }}
                >
                  <div className={isReceived ? 'card-receive' : dealing ? 'card-deal' : undefined}>
                    <Card
                      card={card}
                      selected={isSel}
                      dimmed={!cardsInteractive && state.phase === 'playing'}
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

/** A clock-faced countdown: depleting ring, sweeping hand, tick marks and seconds. */
function TurnClock({ deadline, totalMs }: { deadline: number; totalMs: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);

  const remaining = Math.max(0, deadline - now);
  const frac = Math.max(0, Math.min(1, remaining / totalMs));
  const secs = Math.ceil(remaining / 1000);
  const danger = remaining <= 5000;
  const warn = remaining <= 10000;
  const color = danger ? '#ef4444' : warn ? '#f59e0b' : '#34d399';
  const R = 30;
  const C = 2 * Math.PI * R;
  const hand = (1 - frac) * 360;

  return (
    <div className={cn('flex flex-col items-center gap-0.5 mt-2 pointer-events-none', danger && 'animate-pulse')}>
      <div
        className="relative drop-shadow-[0_4px_14px_rgba(0,0,0,0.6)]"
        style={{ width: 'clamp(76px, 6.2vw, 150px)', height: 'clamp(76px, 6.2vw, 150px)' }}
      >
        <svg viewBox="0 0 72 72" className="w-full h-full">
          {/* clock-face ticks */}
          {Array.from({ length: 12 }).map((_, i) => (
            <line
              key={i}
              x1="36"
              y1="3.5"
              x2="36"
              y2={i % 3 === 0 ? 9 : 7}
              stroke="rgba(245,176,65,0.55)"
              strokeWidth={i % 3 === 0 ? 2 : 1}
              transform={`rotate(${i * 30} 36 36)`}
            />
          ))}
          <circle cx="36" cy="36" r={R} fill="rgba(0,0,0,0.42)" stroke="rgba(245,176,65,0.22)" strokeWidth="4" />
          {/* depleting ring */}
          <circle
            cx="36"
            cy="36"
            r={R}
            fill="none"
            stroke={color}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - frac)}
            transform="rotate(-90 36 36)"
            style={{ transition: 'stroke-dashoffset 120ms linear, stroke 300ms linear' }}
          />
          {/* sweeping hand */}
          <line
            x1="36"
            y1="36"
            x2="36"
            y2="13"
            stroke={color}
            strokeWidth="2.2"
            strokeLinecap="round"
            transform={`rotate(${hand} 36 36)`}
            style={{ transition: 'transform 120ms linear' }}
          />
          <circle cx="36" cy="36" r="2.6" fill={color} />
        </svg>
        <div className="absolute inset-0 flex items-end justify-center pb-[16%]">
          <span
            className="font-heading font-black leading-none"
            style={{ fontSize: 'var(--font-base)', color, textShadow: '0 1px 8px rgba(0,0,0,0.85)' }}
          >
            {secs}
          </span>
        </div>
      </div>
      <p
        className="font-serif italic text-amber-200/90 flex items-center gap-1 bg-black/35 rounded-full px-2 py-0.5"
        style={{ fontSize: 'var(--font-tiny)' }}
      >
        <Hourglass size="1em" /> auto-pass in {secs}s
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
        <span className="font-bold text-amber-300 glow-pulse rounded px-2 py-0.5">Your turn</span>
      ) : (
        <>
          Waiting on{' '}
          <span className="font-bold text-amber-300 inline-flex items-center gap-1.5">
            {current ? (
              <>
                <RoleBadge role={current.role} /> {current.name}
              </>
            ) : (
              '…'
            )}
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
  dealtFor,
}: {
  opponents: Player[];
  state: GameState;
  dealing: boolean;
  myIdx: number;
  totalPlayers: number;
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
                opp.isOut && 'opacity-45 grayscale'
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
                {opp.isOut && opp.finishOrder
                  ? `finished #${opp.finishOrder}`
                  : owesTribute
                  ? 'choosing tribute…'
                  : `${opp.role ? getRoleName(opp.role) + ' · ' : ''}${shownCount} cards`}
              </p>
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

function HandEndScreen({
  state,
  myPlayerId,
  isHost,
  onNextHand,
  onBackToLobby,
}: {
  state: GameState;
  myPlayerId: string;
  isHost: boolean;
  onNextHand: () => void;
  onBackToLobby?: () => void;
}) {
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
            <button
              onClick={onNextHand}
              className="w-full py-3 bg-gradient-to-r from-purple-700 to-purple-900 hover:from-purple-600 hover:to-purple-800 text-amber-100 font-serif font-bold rounded-lg shadow-lg border-2 border-amber-400/30 transition-transform hover:-translate-y-0.5"
              style={{ fontSize: 'var(--font-base)' }}
            >
              Deal the Next Hand
            </button>
          ) : (
            <p className="text-center text-amber-800 font-serif italic py-2" style={{ fontSize: 'var(--font-sm)' }}>
              Waiting for the host to deal the next hand…
            </p>
          )}
          {onBackToLobby && (
            <button
              onClick={onBackToLobby}
              className="w-full py-2 bg-stone-200 hover:bg-stone-300 text-stone-800 font-serif rounded-lg"
              style={{ fontSize: 'var(--font-sm)' }}
            >
              Leave Game
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// keep CARD_INFO referenced for potential tooltips
void CARD_INFO;
