import type { Card, GameState, Player, Rank, Role, PlayedSet, HandResult, SeatDraw } from './types';
import { CARD_INFO, createDeck, shuffle, lowestCards, countJesters, sortHand } from './cards';

/**
 * An all-Jester set is effectively rank 13 (the highest rank number, so it is
 * the weakest lead — a Jester is the "lowest" card, easily beaten by anything 12..1).
 */
export const ALL_JESTERS_RANK = 13 as Rank;

/** Every turn is limited to 60 seconds; on expiry the player passes automatically. */
export const TURN_TIMER_MS = 60_000;

/** The official game seats 4–8; we allow 3 so a small group can still play. 8 players = 10 cards each. */
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;

export function getRoleName(role: Role): string {
  switch (role) {
    case 'greater-dalmuti':
      return 'Greater Dalmuti';
    case 'lesser-dalmuti':
      return 'Lesser Dalmuti';
    case 'merchant':
      return 'Merchant';
    case 'lesser-peon':
      return 'Lesser Peon';
    case 'greater-peon':
      return 'Greater Peon';
  }
}

export function getRoleEmoji(role: Role): string {
  switch (role) {
    case 'greater-dalmuti':
      return '👑';
    case 'lesser-dalmuti':
      return '🎩';
    case 'merchant':
      return '💰';
    case 'lesser-peon':
      return '🧹';
    case 'greater-peon':
      return '👣';
  }
}

export function rolesForSeating(n: number): Role[] {
  const roles: Role[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) roles.push('greater-dalmuti');
    else if (i === 1) roles.push('lesser-dalmuti');
    else if (i === n - 1) roles.push('greater-peon');
    else if (i === n - 2) roles.push('lesser-peon');
    else roles.push('merchant');
  }
  return roles;
}

export function getPlayerIndexByRole(state: GameState, role: Role): number {
  return state.players.findIndex((p) => p.role === role);
}

function dealHands(players: Player[]): Player[] {
  const deck = shuffle(createDeck());
  const n = players.length;
  const hands: Card[][] = players.map(() => []);
  for (let i = 0; i < deck.length; i++) {
    hands[i % n].push(deck[i]);
  }
  return players.map((p, i) => ({
    ...p,
    hand: sortHand(hands[i]),
    finishOrder: undefined,
    isOut: false,
  }));
}

/**
 * Builds the taxation state: the Peons automatically surrender their lowest cards,
 * then we wait for the Dalmuti(s) to choose what to hand back.
 */
export function beginTaxation(state: GameState): GameState {
  const s = structuredClone(state);
  const gpIdx = getPlayerIndexByRole(s, 'greater-peon');
  const gdIdx = getPlayerIndexByRole(s, 'greater-dalmuti');
  const lpIdx = getPlayerIndexByRole(s, 'lesser-peon');
  const ldIdx = getPlayerIndexByRole(s, 'lesser-dalmuti');

  // Greater Peon surrenders lowest two cards
  const gpLowestTwo = lowestCards(s.players[gpIdx].hand, 2);
  s.players[gpIdx].hand = s.players[gpIdx].hand.filter(
    (c) => !gpLowestTwo.some((g) => g.id === c.id)
  );

  // Lesser Peon surrenders lowest card (only if LD and LP are distinct people)
  const lesserExchangeRequired =
    lpIdx !== -1 && ldIdx !== -1 && lpIdx !== ldIdx && lpIdx !== gpIdx && ldIdx !== gdIdx;
  let lesserPeonCardGiven: Card | null = null;
  if (lesserExchangeRequired) {
    lesserPeonCardGiven = lowestCards(s.players[lpIdx].hand, 1)[0] ?? null;
    if (lesserPeonCardGiven) {
      s.players[lpIdx].hand = s.players[lpIdx].hand.filter(
        (c) => c.id !== lesserPeonCardGiven!.id
      );
    }
  }

  s.phase = 'taxes';
  s.pendingTaxes = {
    greaterPeonCardsGiven: gpLowestTwo,
    lesserPeonCardGiven,
    greaterDalmutiCardsGiven: null,
    lesserDalmutiCardGiven: null,
    lesserExchangeRequired: lesserExchangeRequired && !!lesserPeonCardGiven,
    greaterDalmutiId: s.players[gdIdx].id,
    lesserDalmutiId: lesserExchangeRequired ? s.players[ldIdx].id : null,
  };
  s.message = 'Taxation: the Peons have surrendered their finest cards. The Dalmutis must return tribute.';
  return s;
}

/**
 * Official setup: every player draws one card. The lowest card becomes the
 * Greater Dalmuti, the next the Lesser Dalmuti, … and the highest the Greater
 * Peon. The Jester counts as the highest card for the draw. Ties are broken by
 * lot (the players are shuffled first and the sort is stable).
 */
export function drawForSeats(players: Player[]): { ordered: Player[]; draws: SeatDraw[] } {
  const deck = shuffle(createDeck());
  const shuffledPlayers = shuffle(players);
  const draws: SeatDraw[] = shuffledPlayers.map((p, i) => ({ playerId: p.id, card: deck[i] }));
  const sorted = [...draws].sort((a, b) => a.card.rank - b.card.rank);
  const roles = rolesForSeating(sorted.length);
  const ordered = sorted.map((d, i) => ({
    ...shuffledPlayers.find((p) => p.id === d.playerId)!,
    role: roles[i],
  }));
  return { ordered, draws: sorted };
}

/**
 * A fresh game: the players draw for seats, then the whole deck is dealt.
 * The table shows the 'seating' reveal first, then the 'dealing' animation,
 * and only then moves on to taxation.
 */
export function initializeNewGame(
  players: Player[],
  opts: { timerEnabled?: boolean; timerSeconds?: number } = {}
): GameState {
  const { ordered, draws } = drawForSeats(players.map((p) => ({ ...p, hand: [] })));
  const dealt = dealHands(ordered);

  return {
    phase: 'seating',
    players: dealt,
    deck: [],
    currentPlayerIndex: 0,
    currentTrick: [],
    lastValidPlay: null,
    leaderIndex: 0,
    handNumber: 1,
    message: 'Drawing for seats — the lowest card becomes the Greater Dalmuti (the Jester counts highest).',
    revolutionCalled: false,
    pendingTaxes: null,
    handResults: [],
    totalScores: {},
    turnStartedAt: Date.now(),
    timerEnabled: opts.timerEnabled ?? true,
    timerSeconds: opts.timerSeconds ?? 60,
    afkCounts: {},
    passedIds: [],
    seatingDraw: draws,
  };
}

/**
 * Host-only moderation. `remove` empties the seat (spectator until the next
 * reseat, where it disappears); `ai` hands the seat to a court AI that plays on.
 */
export function applyKick(
  state: GameState,
  playerId: string,
  kind: 'remove' | 'ai',
  aiName?: string
): GameState {
  const s = structuredClone(state);
  const idx = s.players.findIndex((p) => p.id === playerId);
  if (idx === -1) return state;
  const p = s.players[idx];
  if (p.kicked) return state;
  const oldName = p.name;
  p.kicked = true;

  if (kind === 'ai') {
    p.id = `ai-kick-${Math.random().toString(36).slice(2, 7)}`;
    p.name = aiName ?? 'Courtier';
    p.isHost = false;
    s.message = `${oldName} left the seat — ${p.name} takes over the hand.`;
  } else {
    p.dropped = true;
    p.isOut = true;
    p.hand = [];
    p.finishOrder = 900; // always sorted last; last place scores 0
    s.passedIds = s.passedIds.filter((id) => id !== playerId);
    s.message = `${oldName} was removed from the table by the host.`;
    if (s.currentPlayerIndex === idx) {
      s.currentPlayerIndex = findNextActivePlayer(s, idx);
      s.turnStartedAt = Date.now();
    }
    if (s.leaderIndex === idx) {
      s.leaderIndex = s.lastValidPlay
        ? Math.max(0, s.players.findIndex((pl) => pl.id === s.lastValidPlay!.playerId))
        : s.currentPlayerIndex;
    }
  }
  return s;
}

/** Moves from the 'seating' reveal into the dealing animation. */
export function startDealing(state: GameState): GameState {
  if (state.phase !== 'seating') return state;
  const s = structuredClone(state);
  s.phase = 'dealing';
  s.message = 'Seats taken. The Greater Peon shuffles and deals the whole deck…';
  s.turnStartedAt = Date.now();
  return s;
}

/** Moves from the 'dealing' phase into taxation (peons surrender lowest cards). */
export function startTaxation(state: GameState): GameState {
  if (state.phase !== 'dealing') return state;
  return beginTaxation(state);
}

export function reseatForNextHand(state: GameState): GameState {
  const s = structuredClone(state);
  // Dropped seats (host-kicked "remove") leave the table for good.
  const continuing = s.players.filter((p) => !p.dropped);
  const ordered = [...continuing].sort(
    (a, b) => (a.kicked ? 1_000_000 : a.finishOrder ?? 99) - (b.kicked ? 1_000_000 : b.finishOrder ?? 99)
  );
  const roles = rolesForSeating(ordered.length);
  const reseated = ordered.map((p, i) => ({ ...p, role: roles[i], hand: [], kicked: false }));

  s.players = dealHands(reseated);
  s.currentPlayerIndex = 0;
  s.leaderIndex = 0;
  s.currentTrick = [];
  s.lastValidPlay = null;
  s.handNumber += 1;
  s.revolutionCalled = false;
  s.pendingTaxes = null;
  s.seatingDraw = null;
  s.passedIds = [];
  s.phase = 'dealing';
  s.message = 'New ranks assigned. The Greater Peon shuffles and deals…';
  s.turnStartedAt = Date.now();

  return s;
}

/* ------------------------------------------------------------------ */
/*  Revolution                                                         */
/* ------------------------------------------------------------------ */

export function playersWithTwoJesters(state: GameState): Player[] {
  return state.players.filter((p) => countJesters(p.hand) >= 2);
}

export function checkRevolution(state: GameState): {
  canRevolution: boolean;
  playerId: string | null;
  isGreaterRevolution: boolean;
} {
  for (const p of state.players) {
    if (countJesters(p.hand) >= 2) {
      return {
        canRevolution: true,
        playerId: p.id,
        isGreaterRevolution: p.role === 'greater-peon',
      };
    }
  }
  return { canRevolution: false, playerId: null, isGreaterRevolution: false };
}

/**
 * Revolution ends taxation. If the caller was the Greater Peon it is a
 * Greater Revolution: every player is reseated in reverse order.
 * The cards the peons already surrendered are handed back to them.
 */
export function applyRevolution(state: GameState, greaterRevolution: boolean): GameState {
  let s = structuredClone(state);

  // Return the surrendered peon cards
  if (s.pendingTaxes) {
    const gpIdx = getPlayerIndexByRole(s, 'greater-peon');
    if (gpIdx !== -1) {
      s.players[gpIdx].hand.push(...s.pendingTaxes.greaterPeonCardsGiven);
    }
    const lpIdx = getPlayerIndexByRole(s, 'lesser-peon');
    if (lpIdx !== -1 && s.pendingTaxes.lesserPeonCardGiven) {
      s.players[lpIdx].hand.push(s.pendingTaxes.lesserPeonCardGiven);
    }
  }
  s.players = s.players.map((p) => ({ ...p, hand: sortHand(p.hand) }));

  if (greaterRevolution) {
    const reversed = [...s.players].reverse();
    const roles = rolesForSeating(reversed.length);
    s.players = reversed.map((p, i) => ({ ...p, role: roles[i] }));
    s.message = '⚔️ GREATER REVOLUTION! The order of the realm is overturned!';
  } else {
    s.message = '🃏 Revolution! Taxation is cancelled this hand.';
  }

  s.revolutionCalled = true;
  s.pendingTaxes = null;
  s.phase = 'playing';
  s.currentTrick = [];
  s.lastValidPlay = null;
  const gdIdx = Math.max(0, getPlayerIndexByRole(s, 'greater-dalmuti'));
  s.currentPlayerIndex = gdIdx;
  s.leaderIndex = gdIdx;
  s.turnStartedAt = Date.now();
  return s;
}

/* ------------------------------------------------------------------ */
/*  Taxes                                                              */
/* ------------------------------------------------------------------ */

export function taxesComplete(state: GameState): boolean {
  const t = state.pendingTaxes;
  if (!t) return true;
  const gdDone = t.greaterDalmutiCardsGiven !== null;
  const ldDone = !t.lesserExchangeRequired || t.lesserDalmutiCardGiven !== null;
  return gdDone && ldDone;
}

/** Record one Dalmuti's tribute choice. Finalises the exchange once everyone has chosen. */
export function submitTribute(
  state: GameState,
  playerId: string,
  cards: Card[]
): GameState {
  const s = structuredClone(state);
  const t = s.pendingTaxes;
  if (!t || s.phase !== 'taxes') return state;

  if (playerId === t.greaterDalmutiId) {
    if (cards.length !== 2) return state;
    if (t.greaterDalmutiCardsGiven !== null) return state; // already submitted
    t.greaterDalmutiCardsGiven = cards;
  } else if (t.lesserDalmutiId && playerId === t.lesserDalmutiId) {
    if (cards.length !== 1) return state;
    if (t.lesserDalmutiCardGiven !== null) return state;
    t.lesserDalmutiCardGiven = cards[0];
  } else {
    return state;
  }

  if (!taxesComplete(s)) {
    s.message = 'Tribute received. Awaiting the other Dalmuti...';
    return s;
  }

  return finalizeTaxes(s);
}

function finalizeTaxes(state: GameState): GameState {
  const s = structuredClone(state);
  const t = s.pendingTaxes!;
  const gpIdx = getPlayerIndexByRole(s, 'greater-peon');
  const gdIdx = getPlayerIndexByRole(s, 'greater-dalmuti');
  const lpIdx = getPlayerIndexByRole(s, 'lesser-peon');
  const ldIdx = getPlayerIndexByRole(s, 'lesser-dalmuti');

  const gdCards = t.greaterDalmutiCardsGiven ?? [];

  // Greater Dalmuti <-> Greater Peon
  s.players[gdIdx].hand = s.players[gdIdx].hand.filter(
    (c) => !gdCards.some((g) => g.id === c.id)
  );
  s.players[gdIdx].hand.push(...t.greaterPeonCardsGiven);
  s.players[gpIdx].hand.push(...gdCards);

  // Lesser Dalmuti <-> Lesser Peon
  if (t.lesserExchangeRequired && t.lesserDalmutiCardGiven && ldIdx !== -1 && lpIdx !== -1) {
    const ldCard = t.lesserDalmutiCardGiven;
    s.players[ldIdx].hand = s.players[ldIdx].hand.filter((c) => c.id !== ldCard.id);
    if (t.lesserPeonCardGiven) s.players[ldIdx].hand.push(t.lesserPeonCardGiven);
    s.players[lpIdx].hand.push(ldCard);
  }

  s.players = s.players.map((p) => ({ ...p, hand: sortHand(p.hand) }));
  s.pendingTaxes = null;
  s.phase = 'playing';
  s.currentTrick = [];
  s.lastValidPlay = null;
  const leadIdx = Math.max(0, gdIdx);
  s.currentPlayerIndex = leadIdx;
  s.leaderIndex = leadIdx;
  s.message = `Taxes paid. ${s.players[leadIdx].name} (Greater Dalmuti) leads.`;
  s.turnStartedAt = Date.now();
  return s;
}

/* ------------------------------------------------------------------ */
/*  Play                                                               */
/* ------------------------------------------------------------------ */

export function getEffectiveRank(cards: Card[]): Rank | null {
  const nonJesters = cards.filter((c) => c.rank !== 13);
  if (cards.length === 0) return null;
  if (nonJesters.length === 0) return ALL_JESTERS_RANK;
  const rank = nonJesters[0].rank;
  if (!nonJesters.every((c) => c.rank === rank)) return null;
  return rank;
}

export function canPlayCards(selectedCards: Card[], lastPlay: PlayedSet | null): boolean {
  if (selectedCards.length === 0) return false;
  const effRank = getEffectiveRank(selectedCards);
  if (effRank === null) return false;
  if (!lastPlay) return true;
  if (selectedCards.length !== lastPlay.cards.length) return false;
  // Lower rank number beats higher rank number. Jester is rank 13 (highest),
  // so anything 1-12 can beat it.
  return effRank < lastPlay.effectiveRank;
}

function findNextActivePlayer(state: GameState, fromIdx: number): number {
  const n = state.players.length;
  let idx = (fromIdx + 1) % n;
  let count = 0;
  while (state.players[idx].isOut && count < n) {
    idx = (idx + 1) % n;
    count++;
  }
  return idx;
}

export function describeSet(cards: Card[]): string {
  const eff = getEffectiveRank(cards);
  if (eff === null) return '';
  const name = CARD_INFO[eff].name;
  const plural = cards.length > 1 ? (name.endsWith('s') ? name : `${name}s`) : name;
  return `${cards.length} × ${plural}`;
}

/**
 * Score a finished hand: with N players, 1st place earns N-1 points,
 * 2nd N-2, ... last place 0. (5 players -> 4,3,2,1,0)
 */
function recordHandResult(s: GameState): void {
  const n = s.players.length;
  const sortedStandings = [...s.players].sort(
    (a, b) =>
      (a.kicked ? 1_000_000 : a.finishOrder ?? 99) - (b.kicked ? 1_000_000 : b.finishOrder ?? 99)
  );
  const result: HandResult = {
    hand: s.handNumber,
    standings: sortedStandings.map((p, idx) => ({
      playerId: p.id,
      name: p.kicked ? `${p.name} (removed)` : p.name,
      place: idx + 1,
      points: Math.max(0, n - 1 - idx),
    })),
  };
  s.handResults.push(result);
  for (const st of result.standings) {
    s.totalScores[st.playerId] = (s.totalScores[st.playerId] ?? 0) + st.points;
  }
}

export function applyPlay(state: GameState, playerId: string, cards: Card[]): GameState {
  const s = structuredClone(state);
  const playerIdx = s.players.findIndex((p) => p.id === playerId);
  if (playerIdx === -1) return state;
  if (s.players[playerIdx].isOut) return state;

  const effRank = getEffectiveRank(cards);
  if (effRank === null) return state;
  if (!canPlayCards(cards, s.lastValidPlay)) return state;

  const wasClear = s.lastValidPlay === null;
  const cardIds = new Set(cards.map((c) => c.id));
  s.players[playerIdx].hand = s.players[playerIdx].hand.filter((c) => !cardIds.has(c.id));

  const play: PlayedSet = { playerId, cards, effectiveRank: effRank };
  s.currentTrick.push(play);
  // A fresh lead clears every PASSED badge; playing also clears your own.
  if (wasClear) s.passedIds = [];
  s.passedIds = s.passedIds.filter((id) => id !== playerId);
  s.lastValidPlay = play;
  s.leaderIndex = playerIdx;

  const playerName = s.players[playerIdx].name;
  const hasJester = cards.some((c) => c.rank === 13);
  const jesterNote = hasJester && !cards.every((c) => c.rank === 13) ? ' (with Jester wild)' : '';
  s.message = `${playerName} plays ${describeSet(cards)}${jesterNote}`;

  if (s.players[playerIdx].hand.length === 0) {
    const outCount = s.players.filter((p) => p.isOut).length;
    s.players[playerIdx].isOut = true;
    s.players[playerIdx].finishOrder = outCount + 1;
    s.message = `${playerName} sheds their last card and finishes #${outCount + 1}!`;
  }

  const activePlayers = s.players.filter((p) => !p.isOut);
  if (activePlayers.length <= 1) {
    const remaining = activePlayers[0];
    if (remaining) {
      const outCount = s.players.filter((p) => p.isOut).length;
      const remIdx = s.players.findIndex((p) => p.id === remaining.id);
      s.players[remIdx].isOut = true;
      s.players[remIdx].finishOrder = outCount + 1;
    }
    recordHandResult(s);
    s.phase = 'hand-end';
    s.message = 'The hand is over! Points have been awarded.';
    return s;
  }

  s.currentPlayerIndex = findNextActivePlayer(s, playerIdx);
  s.turnStartedAt = Date.now();
  return s;
}

export function applyPass(
  state: GameState,
  playerId: string,
  opts?: { timedOut?: boolean }
): GameState {
  const s = structuredClone(state);
  const playerIdx = s.players.findIndex((p) => p.id === playerId);
  if (playerIdx === -1) return state;
  // The host is authoritative. Queued UI passes, delayed network packets and
  // duplicate clicks are ignored unless this player is truly on turn now.
  if (s.phase !== 'playing' || s.players[s.currentPlayerIndex]?.id !== playerId) return state;
  if (s.players[playerIdx].isOut || s.players[playerIdx].kicked) return state;

  const nextIdx = findNextActivePlayer(s, playerIdx);
  const name = s.players[playerIdx].name;

  if (opts?.timedOut) {
    const count = (s.afkCounts[playerId] ?? 0) + 1;
    s.afkCounts[playerId] = count;
    s.message =
      count >= 2
        ? `⏳ ${name} appears to be AFK. (missed ${count} turns)`
        : `⏳ Warning: ${name} missed a turn.`;
  } else {
    s.message = `${name} passes.`;
  }
  if (!s.passedIds.includes(playerId)) s.passedIds.push(playerId);

  let effectiveLeader = s.leaderIndex;
  if (s.players[effectiveLeader].isOut) {
    effectiveLeader = findNextActivePlayer(s, effectiveLeader);
  }

  if (nextIdx === effectiveLeader) {
    if (!opts?.timedOut) s.message = `${s.players[effectiveLeader].name} takes the trick and leads.`;
    s.currentTrick = [];
    s.lastValidPlay = null;
    s.passedIds = [];
    s.leaderIndex = effectiveLeader;
    s.currentPlayerIndex = effectiveLeader;
  } else {
    s.currentPlayerIndex = nextIdx;
  }

  s.turnStartedAt = Date.now();
  return s;
}
