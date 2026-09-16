import type { Card, GameState, Player, Rank, Role, PlayedSet, HandResult, SeatDraw } from './types';
import { CARD_INFO, createDeck, shuffle, lowestCards, sortHand } from './cards';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

export const ALL_JESTERS_RANK = 13 as Rank;
export const TURN_TIMER_MS = 60_000;
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;
/** Safety limit for skipping invalid players. */


/* ------------------------------------------------------------------ */
/*  Defensive helpers                                                   */
/* ------------------------------------------------------------------ */

function p(state: GameState, idx: number): Player | null {
  return state.players[idx] ?? null;
}

function pname(state: GameState, idx: number): string {
  return p(state, idx)?.name ?? 'Unknown';
}

function findNextActivePlayer(state: GameState, fromIdx: number): number {
  const n = state.players.length;
  if (n === 0) return 0;
  let idx = (fromIdx + 1) % n;
  let count = 0;
  while ((state.players[idx]?.isOut || state.players[idx]?.kicked) && count < n) {
    idx = (idx + 1) % n;
    count++;
  }
  return idx;
}

/* ------------------------------------------------------------------ */
/*  Roles, deck, dealing                                               */
/* ------------------------------------------------------------------ */

export function getRoleName(role: Role): string {
  const names: Record<Role, string> = {
    'greater-dalmuti': 'Greater Dalmuti',
    'lesser-dalmuti': 'Lesser Dalmuti',
    merchant: 'Merchant',
    'lesser-peon': 'Lesser Peon',
    'greater-peon': 'Greater Peon',
  };
  return names[role] ?? role;
}

export function getRoleEmoji(role: Role): string {
  const emojis: Record<Role, string> = {
    'greater-dalmuti': '👑',
    'lesser-dalmuti': '🎩',
    merchant: '💰',
    'lesser-peon': '🧹',
    'greater-peon': '👣',
  };
  return emojis[role] ?? '•';
}

export function rolesForSeating(n: number): Role[] {
  if (n <= 0) return [];
  if (n === 1) return ['greater-dalmuti'];
  if (n === 2) return ['greater-dalmuti', 'greater-peon'];
  if (n === 3) return ['greater-dalmuti', 'lesser-dalmuti', 'greater-peon'];
  const roles: Role[] = ['greater-dalmuti', 'lesser-dalmuti'];
  for (let i = 2; i < n - 2; i++) roles.push('merchant');
  roles.push('lesser-peon', 'greater-peon');
  return roles;
}

export function getPlayerIndexByRole(state: GameState, role: Role): number {
  const idx = state.players.findIndex((pl) => pl?.role === role);
  return idx >= 0 ? idx : -1;
}

function dealHands(players: Player[]): Player[] {
  const deck = shuffle(createDeck());
  const n = players.length;
  if (n === 0) return [];
  const hands: Card[][] = players.map(() => []);
  for (let i = 0; i < deck.length; i++) {
    hands[i % n].push(deck[i]);
  }
  return players.map((pl, i) => ({
    ...pl,
    hand: sortHand(hands[i]),
    finishOrder: undefined,
    isOut: false,
  }));
}

/* ------------------------------------------------------------------ */
/*  Seating & dealing phases                                           */
/* ------------------------------------------------------------------ */

export function drawForSeats(players: Player[]): { ordered: Player[]; draws: SeatDraw[] } {
  const deck = shuffle(createDeck());
  const shuffledPlayers = shuffle(players);
  const draws: SeatDraw[] = shuffledPlayers.map((pl, i) => ({ playerId: pl.id, card: deck[i] }));
  const sorted = [...draws].sort((a, b) => a.card.rank - b.card.rank);
  const roles = rolesForSeating(sorted.length);
  const ordered = sorted.map((d, i) => ({
    ...shuffledPlayers.find((pl) => pl.id === d.playerId)!,
    role: roles[i],
  }));
  return { ordered, draws: sorted };
}

export function initializeNewGame(
  players: Player[],
  opts: { timerEnabled?: boolean; timerSeconds?: number; cardSet?: string } = {}
): GameState {
  const { ordered, draws } = drawForSeats(players.map((pl) => ({ ...pl, hand: [] })));
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
    cardSet: opts.cardSet ?? 'default',
  };
}

export function startDealing(state: GameState): GameState {
  if (state.phase !== 'seating') return state;
  const s = structuredClone(state);
  s.phase = 'dealing';
  s.message = 'Seats taken. The Greater Peon shuffles and deals the whole deck…';
  s.turnStartedAt = Date.now();
  return s;
}

export function startTaxation(state: GameState): GameState {
  if (state.phase !== 'dealing') return state;
  return beginTaxation(state);
}

/* ------------------------------------------------------------------ */
/*  Kicking & leaving                                                   */
/* ------------------------------------------------------------------ */

export function applyKick(state: GameState, playerId: string, kind: 'remove' | 'ai', aiName?: string): GameState {
  const s = structuredClone(state);
  const idx = s.players.findIndex((pl) => pl.id === playerId);
  if (idx === -1) return s;
  const target = s.players[idx];
  if (!target || target.kicked) return s;

  const oldName = target.name;
  target.kicked = true;

  if (kind === 'ai') {
    target.kicked = false;
    const newId = `ai-kick-${Math.random().toString(36).slice(2, 7)}`;
    target.id = newId;
    target.name = aiName ?? 'Courtier';
    target.isHost = false;
    s.message = `${oldName} left the seat — ${target.name} takes over the hand.`;
    // CRITICAL: if the kicked player was current or leader, update the timer
    // so the AI replacement's turn fires immediately.
    if (s.currentPlayerIndex === idx) {
      s.turnStartedAt = Date.now(); // force the timeout to re-fire
    }
    if (s.leaderIndex === idx) {
      s.leaderIndex = idx;
    }
  } else {
    target.kicked = true;
    target.dropped = true;
    target.isOut = true;
    target.hand = [];
    target.finishOrder = 900;
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

export function setLeaveIntent(state: GameState, playerId: string, queued: boolean): GameState {
  const s = structuredClone(state);
  const idx = s.players.findIndex((pl) => pl.id === playerId);
  if (idx === -1) return s;
  if (!!s.players[idx].leavingAfterRound === queued) return s;
  s.players[idx].leavingAfterRound = queued;
  s.message = queued
    ? `🚪 ${s.players[idx].name} will leave after this round.`
    : `${s.players[idx].name} changed their mind and is staying.`;
  return s;
}

/* ------------------------------------------------------------------ */
/*  Reseat for next hand                                                */
/* ------------------------------------------------------------------ */

export function reseatForNextHand(state: GameState): GameState {
  const s = structuredClone(state);
  const continuing = s.players.filter((pl) => !pl.dropped);
  const ordered = [...continuing].sort(
    (a, b) => (a.kicked ? 1_000_000 : a.finishOrder ?? 99) - (b.kicked ? 1_000_000 : b.finishOrder ?? 99)
  );
  const roles = rolesForSeating(ordered.length);
  const reseated = ordered.map((pl, i) => ({ ...pl, role: roles[i], hand: [], kicked: false }));

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
/*  Taxation                                                           */
/* ------------------------------------------------------------------ */

export function beginTaxation(state: GameState): GameState {
  const s = structuredClone(state);
  const gpIdx = getPlayerIndexByRole(s, 'greater-peon');
  const gdIdx = getPlayerIndexByRole(s, 'greater-dalmuti');
  const lpIdx = getPlayerIndexByRole(s, 'lesser-peon');
  const ldIdx = getPlayerIndexByRole(s, 'lesser-dalmuti');

  if (gpIdx < 0 || gdIdx < 0) {
    s.phase = 'playing';
    s.message = 'Taxation skipped — not all ranks present.';
    return s;
  }

  const gpLowestTwo = lowestCards(s.players[gpIdx].hand, 2);
  s.players[gpIdx].hand = s.players[gpIdx].hand.filter((c) => !gpLowestTwo.some((g) => g.id === c.id));

  const lesserExchangeRequired = lpIdx !== -1 && ldIdx !== -1 && lpIdx !== ldIdx && lpIdx !== gpIdx && ldIdx !== gdIdx;
  let lesserPeonCardGiven: Card | null = null;
  if (lesserExchangeRequired && lpIdx >= 0) {
    lesserPeonCardGiven = lowestCards(s.players[lpIdx].hand, 1)[0] ?? null;
    if (lesserPeonCardGiven) {
      s.players[lpIdx].hand = s.players[lpIdx].hand.filter((c) => c.id !== lesserPeonCardGiven!.id);
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
    lesserDalmutiId: lesserExchangeRequired && ldIdx >= 0 ? s.players[ldIdx].id : null,
  };
  s.message = 'Taxation: the Peons have surrendered their finest cards. The Dalmutis must return tribute.';
  return s;
}

export function taxesComplete(state: GameState): boolean {
  const t = state.pendingTaxes;
  if (!t) return true;
  return (t.greaterDalmutiCardsGiven !== null) && (!t.lesserExchangeRequired || t.lesserDalmutiCardGiven !== null);
}

export function submitTribute(state: GameState, playerId: string, cards: Card[]): GameState {
  const s = structuredClone(state);
  const t = s.pendingTaxes;
  if (!t || s.phase !== 'taxes') return s;
  if (playerId === t.greaterDalmutiId) {
    if (cards.length !== 2 || t.greaterDalmutiCardsGiven !== null) return s;
    t.greaterDalmutiCardsGiven = cards;
  } else if (t.lesserDalmutiId && playerId === t.lesserDalmutiId) {
    if (cards.length !== 1 || t.lesserDalmutiCardGiven !== null) return s;
    t.lesserDalmutiCardGiven = cards[0];
  } else {
    return s;
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

  if (gdIdx < 0 || gpIdx < 0) {
    s.phase = 'playing';
    s.pendingTaxes = null;
    s.turnStartedAt = Date.now();
    return s;
  }

  const gdCards = t.greaterDalmutiCardsGiven ?? [];
  s.players[gdIdx].hand = s.players[gdIdx].hand.filter((c) => !gdCards.some((g) => g.id === c.id));
  s.players[gdIdx].hand.push(...t.greaterPeonCardsGiven);
  s.players[gpIdx].hand.push(...gdCards);

  if (t.lesserExchangeRequired && t.lesserDalmutiCardGiven && ldIdx >= 0 && lpIdx >= 0) {
    const ldCard = t.lesserDalmutiCardGiven;
    s.players[ldIdx].hand = s.players[ldIdx].hand.filter((c) => c.id !== ldCard.id);
    if (t.lesserPeonCardGiven) s.players[ldIdx].hand.push(t.lesserPeonCardGiven);
    s.players[lpIdx].hand.push(ldCard);
  }

  s.players = s.players.map((pl) => ({ ...pl, hand: sortHand(pl.hand) }));
  s.pendingTaxes = null;
  s.phase = 'playing';
  s.currentTrick = [];
  s.lastValidPlay = null;
  const leadIdx = Math.max(0, gdIdx);
  s.currentPlayerIndex = leadIdx;
  s.leaderIndex = leadIdx;
  s.message = `Taxes paid. ${pname(s, leadIdx)} (Greater Dalmuti) leads.`;
  s.turnStartedAt = Date.now();
  return s;
}

/* ------------------------------------------------------------------ */
/*  Revolution                                                         */
/* ------------------------------------------------------------------ */

export function applyRevolution(state: GameState, greaterRevolution: boolean): GameState {
  const s = structuredClone(state);
  if (s.pendingTaxes) {
    const gpIdx = getPlayerIndexByRole(s, 'greater-peon');
    if (gpIdx >= 0) s.players[gpIdx].hand.push(...s.pendingTaxes.greaterPeonCardsGiven);
    const lpIdx = getPlayerIndexByRole(s, 'lesser-peon');
    if (lpIdx >= 0 && s.pendingTaxes.lesserPeonCardGiven) s.players[lpIdx].hand.push(s.pendingTaxes.lesserPeonCardGiven);
  }
  s.players = s.players.map((pl) => ({ ...pl, hand: sortHand(pl.hand) }));
  if (greaterRevolution) {
    const reversed = [...s.players].reverse();
    const roles = rolesForSeating(reversed.length);
    s.players = reversed.map((pl, i) => ({ ...pl, role: roles[i] }));
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
/*  Play & Pass                                                        */
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
  return effRank < lastPlay.effectiveRank;
}

export function describeSet(cards: Card[]): string {
  const eff = getEffectiveRank(cards);
  if (eff === null) return '';
  const name = CARD_INFO[eff].name;
  const plural = cards.length > 1 ? (name.endsWith('s') ? name : `${name}s`) : name;
  return `${cards.length} × ${plural}`;
}

function recordHandResult(s: GameState): void {
  const n = s.players.length;
  const sorted = [...s.players].sort(
    (a, b) => (a.kicked ? 1_000_000 : a.finishOrder ?? 99) - (b.kicked ? 1_000_000 : b.finishOrder ?? 99)
  );
  const result: HandResult = {
    hand: s.handNumber,
    standings: sorted.map((pl, idx) => ({
      playerId: pl.id,
      name: pl.kicked ? `${pl.name} (removed)` : pl.name,
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
  const playerIdx = s.players.findIndex((pl) => pl.id === playerId);
  if (playerIdx < 0) return state;
  const player = s.players[playerIdx];
  if (!player || player.isOut || player.kicked || player.dropped) return state;

  const effRank = getEffectiveRank(cards);
  if (effRank === null) return state;
  if (!canPlayCards(cards, s.lastValidPlay)) return state;

  const wasClear = s.lastValidPlay === null;
  const cardIds = new Set(cards.map((c) => c.id));
  player.hand = player.hand.filter((c) => !cardIds.has(c.id));

  const play: PlayedSet = { playerId, cards, effectiveRank: effRank };
  s.currentTrick.push(play);
  if (wasClear) s.passedIds = [];
  s.passedIds = s.passedIds.filter((id) => id !== playerId);
  s.lastValidPlay = play;
  s.leaderIndex = playerIdx;

  const hasJester = cards.some((c) => c.rank === 13);
  const jesterNote = hasJester && !cards.every((c) => c.rank === 13) ? ' (with Jester wild)' : '';
  s.message = `${pname(s, playerIdx)} plays ${describeSet(cards)}${jesterNote}`;

  if (player.hand.length === 0) {
    const outCount = s.players.filter((pl) => pl.isOut).length;
    player.isOut = true;
    player.finishOrder = outCount + 1;
    s.message = `${pname(s, playerIdx)} sheds their last card and finishes #${outCount + 1}!`;
  }

  const activePlayers = s.players.filter((pl) => !pl.isOut && !pl.kicked);
  if (activePlayers.length <= 1) {
    const remaining = activePlayers[0];
    if (remaining) {
      const outCount = s.players.filter((pl) => pl.isOut).length;
      const remIdx = s.players.findIndex((pl) => pl.id === remaining.id);
      if (remIdx >= 0) {
        s.players[remIdx].isOut = true;
        s.players[remIdx].finishOrder = outCount + 1;
      }
    }
    recordHandResult(s);
    for (const pl of s.players) {
      if (pl.leavingAfterRound) pl.dropped = true;
    }
    s.phase = 'hand-end';
    s.message = 'The hand is over! Points have been awarded.';
    return s;
  }

  s.currentPlayerIndex = findNextActivePlayer(s, playerIdx);
  s.turnStartedAt = Date.now();
  return s;
}

export function applyPass(state: GameState, playerId: string, opts?: { timedOut?: boolean }): GameState {
  const s = structuredClone(state);
  const playerIdx = s.players.findIndex((pl) => pl.id === playerId);
  if (playerIdx < 0) return state;
  const player = s.players[playerIdx];
  if (!player || player.isOut || player.kicked || player.dropped) return s;

  // Safety: if phase is not 'playing', or this player isn't the current player,
  // just move to the next active player anyway — the game MUST advance.
  const currentPlayer = s.players[s.currentPlayerIndex];
  const isMyTurn = currentPlayer?.id === playerId;

  const nextIdx = findNextActivePlayer(s, playerIdx);
  const name = pname(s, playerIdx);

  if (opts?.timedOut) {
    const count = (s.afkCounts[playerId] ?? 0) + 1;
    s.afkCounts[playerId] = count;
    s.message = count >= 2
      ? `⏳ ${name} appears to be AFK. (missed ${count} turns)`
      : `⏳ Warning: ${name} missed a turn.`;
  } else {
    s.message = `${name} passes.`;
  }
  if (!s.passedIds.includes(playerId)) s.passedIds.push(playerId);

  let effectiveLeader = s.leaderIndex;
  if (effectiveLeader >= 0 && s.players[effectiveLeader]?.isOut) {
    effectiveLeader = findNextActivePlayer(s, effectiveLeader);
  }

  // Special handling: if it IS the current player's turn (normal pass) or if
  // it's a timeout but the player already moved on, still advance.
  if (isMyTurn) {
    if (nextIdx === effectiveLeader) {
      if (!opts?.timedOut) s.message = `${pname(s, effectiveLeader)} takes the trick and leads.`;
      s.currentTrick = [];
      s.lastValidPlay = null;
      s.passedIds = [];
      s.leaderIndex = effectiveLeader;
      s.currentPlayerIndex = effectiveLeader;
    } else {
      s.currentPlayerIndex = nextIdx;
    }
  } else {
    // Out-of-turn pass (timeout arrived late) — just advance to the next player.
    s.currentPlayerIndex = nextIdx;
  }

  s.turnStartedAt = Date.now();
  return s;
}

/**
 * Hard safety net: if the current player is somehow invalid (out, kicked,
 * or idx doesn't exist), force-advance to the next valid player.
 * Call this as a last resort after a timeout or reconnect.
 */
export function forceAdvanceTurn(state: GameState): GameState {
  const s = structuredClone(state);
  const cur = s.players[s.currentPlayerIndex];
  if (!cur || cur.isOut || cur.kicked || cur.dropped) {
    const next = findNextActivePlayer(s, s.currentPlayerIndex);
    s.currentPlayerIndex = next;
    s.turnStartedAt = Date.now();
  }
  return s;
}
