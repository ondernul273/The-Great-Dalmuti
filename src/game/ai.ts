import type { Card, PlayedSet, Role } from './types';
import { getEffectiveRank } from './logic';
import { countJesters } from './cards';

/* =====================================================================
   AI strategy
   =====================================================================
   Core principle: in Dalmuti, LOW rank numbers are the powerful cards
   (a Dalmuti, rank 1, beats everything) and HIGH rank numbers are dead
   weight (a Peasant, rank 12, beats nothing). A competent player therefore:

   • LEADS with weak (high) cards — that is the only way to shed them —
     in small "medium" sets early, getting bolder as the hand shrinks.
   • FOLLOWS with the cheapest winning play, and PASSES when winning the
     trick would require spending a strong (low) card or a Jester.
   • TREATS Jesters as precious wild resources — never wasted on a play a
     normal card can cover.
   • BECOMES AGGRESSIVE in the endgame: when the hand is small, winning
     tricks (and going out) outweigh conserving power.

   Every decision therefore weighs: rank/role, hand size, number of
   players left, whether we are leading, the age of the trick, and how
   close we are to going out.
   ===================================================================== */

export interface AIContext {
  /** The player's role this hand (drives strategy, e.g. Peons hold cards back). */
  role?: Role;
  /** Cards in hand BEFORE this decision (so set.length === handSize ⇒ going out). */
  handSize: number;
  /** Players who still hold cards (fewer ⇒ each trick matters more). */
  playersLeft: number;
  /** True when this play opens a new trick. */
  isLeader: boolean;
  /** Plays already in the current trick (0 when leading). */
  trickAge: number;
}

export interface AIDecision {
  action: 'play' | 'pass';
  cards?: Card[];
}

/* ------------------------------- tuning ------------------------------- */

const CONTROL_BASE = 3.0; // base value of winning a trick (you lead the next)
const SHED_VALUE = 2.5; // value per card shed (you must shed all to win)
const STRONGEST_CARD_VALUE = 5.0; // how much a Dalmuti (rank 1) is worth keeping
const JESTER_VALUE = 7.0; // a Jester is worth more than any single card
const CONSERVE_EARLY = 1.15; // extra reluctance to spend power early
const CONSERVE_LATE = 0.5; // willingness to spend power late (aggressive)
const GOING_OUT_BONUS = 100; // shedding the final cards is everything
const JESTER_LEAD_PENALTY = 55; // never lead with wilds
const ENDGAME_HAND = 6; // hand this small or fewer ⇒ endgame mode

function isEndgame(ctx: AIContext): boolean {
  return ctx.handSize <= ENDGAME_HAND;
}

/** How much a single card is "worth keeping" = how many future tricks it can win.
 *  A Dalmuti (1) can win almost anything (most valuable); a Peasant (12) wins
 *  nothing (worthless, always happy to shed). A Jester tops the list. */
function cardValue(rank: number): number {
  if (rank === 13) return JESTER_VALUE;
  return ((13 - rank) / 12) * STRONGEST_CARD_VALUE;
}

/** Total "power" a set spends = how much strength you give up to play it. */
function setValue(set: Card[]): number {
  return set.reduce((s, c) => s + cardValue(c.rank), 0);
}

/* --------------------------- set enumeration --------------------------- */

function setsByRank(hand: Card[]): { byRank: Record<number, Card[]>; jesters: Card[] } {
  const byRank: Record<number, Card[]> = {};
  const jesters: Card[] = [];
  for (const c of hand) {
    if (c.rank === 13) jesters.push(c);
    else (byRank[c.rank] ??= []).push(c);
  }
  return { byRank, jesters };
}

/** Every legal lead set (any rank, any size, Jesters optional). */
function leadSets(hand: Card[]): Card[][] {
  const { byRank, jesters } = setsByRank(hand);
  const sets: Card[][] = [];
  for (const key of Object.keys(byRank)) {
    const cards = byRank[Number(key)];
    for (let t = 1; t <= cards.length; t++) {
      sets.push(cards.slice(0, t));
      for (let j = 1; j <= jesters.length; j++) sets.push([...cards.slice(0, t), ...jesters.slice(0, j)]);
    }
  }
  for (let j = 1; j <= jesters.length; j++) sets.push(jesters.slice(0, j));
  return sets;
}

/** Every legal FOLLOW set that beats lastPlay. */
function followSets(hand: Card[], lastPlay: PlayedSet): Card[][] {
  const { byRank, jesters } = setsByRank(hand);
  const sets: Card[][] = [];
  const requiredCount = lastPlay.cards.length;
  const targetRank = lastPlay.effectiveRank; // lower beats; 13 (Jester) is weakest

  for (const key of Object.keys(byRank)) {
    const rank = Number(key);
    if (rank >= targetRank) continue;
    const cards = byRank[rank];
    for (let real = 1; real <= Math.min(cards.length, requiredCount); real++) {
      const neededJesters = requiredCount - real;
      if (neededJesters > jesters.length) continue;
      const set = [...cards.slice(0, real), ...jesters.slice(0, neededJesters)];
      const eff = getEffectiveRank(set);
      if (eff !== null && eff < targetRank) sets.push(set);
    }
  }
  // All-Jester follow: only ever beats a Jester lead (13) — effectively never
  // useful, so we deliberately do not generate it (protects the wilds).
  return sets;
}

/* ----------------------------- valuation ------------------------------ */

function jestersIn(set: Card[]): number {
  return set.filter((c) => c.rank === 13).length;
}

function avgRank(set: Card[]): number {
  const real = set.filter((c) => c.rank !== 13);
  if (real.length === 0) return 13;
  return real.reduce((s, c) => s + c.rank, 0) / real.length;
}

/* --------------------------- follow decision --------------------------- */

/**
 * Decide whether to follow a trick.
 *
 * We only ever consider the CHEAPEST winning set (least strength spent). If
 * winning with it is worth the strength we'd give up, we play it; otherwise we
 * pass and conserve our strong cards and Jesters for when they matter.
 */
function chooseFollow(sets: Card[][] | null, ctx: AIContext): AIDecision {
  if (!sets || sets.length === 0) return { action: 'pass' };

  // Winning a trick is worth more when fewer players remain (heads-up decides
  // the game), and slightly less as the trick ages (the leader will likely
  // take it anyway once everyone has passed it over).
  let control = CONTROL_BASE + Math.max(0, 3 - (ctx.playersLeft - 1)) * 0.5;
  control *= 1 - Math.min(0.4, ctx.trickAge * 0.08);

  // Early on, conserve strength; late (endgame / few left), spend it to shed.
  const late = isEndgame(ctx) || ctx.playersLeft <= 2;
  const conserve = late ? CONSERVE_LATE : CONSERVE_EARLY;

  // Pick the cheapest winning set (min strength spent; tiebreak shed more).
  let cheapest: Card[] | null = null;
  let cheapestVal = Infinity;
  for (const set of sets) {
    const v = setValue(set) - set.length * 0.01; // tiny tiebreak: shed more
    if (v < cheapestVal) {
      cheapestVal = v;
      cheapest = set;
    }
  }
  if (!cheapest) return { action: 'pass' };

  // Shedding our final cards ends the hand — always take it.
  if (cheapest.length === ctx.handSize) return { action: 'play', cards: cheapest };

  const trickValue = control + cheapest.length * SHED_VALUE;
  if (trickValue > setValue(cheapest) * conserve) {
    return { action: 'play', cards: cheapest };
  }
  return { action: 'pass' }; // conserve strength and Jesters for later
}

/* ---------------------------- lead decision ---------------------------- */

/** Context-aware preference for how big a lead should be. */
function sizePreference(size: number, ctx: AIContext): number {
  if (isEndgame(ctx)) return size >= 2 ? 3 + Math.min(size - 2, 2) * 0.5 : 1;
  if (ctx.handSize > 12) return size <= 2 ? 2 : size === 3 ? 0 : -2; // conservative: small
  return size >= 2 && size <= 3 ? 3 : size === 1 ? 1.5 : 1; // medium
}

function chooseLead(hand: Card[], ctx: AIContext): AIDecision {
  const sets = leadSets(hand);
  if (sets.length === 0) return { action: 'pass' };

  let best: Card[] | null = null;
  let bestScore = -Infinity;
  for (const set of sets) {
    const jesters = jestersIn(set);
    if (jesters === set.length) continue; // never lead an all-Jester set

    // We want to shed weak (high) cards; strong (low) cards have little "dump
    // value", so strong sets naturally score low and get held back.
    const dumpValue = avgRank(set) * 1.5;
    const sizePref = sizePreference(set.length, ctx);
    const jesterPenalty = jesters * JESTER_LEAD_PENALTY;
    let score = dumpValue + sizePref - jesterPenalty;

    // Going out by leading the whole hand is the best possible move.
    if (set.length === ctx.handSize) score += GOING_OUT_BONUS;

    // Slight noise so consecutive leads are not perfectly predictable.
    score += Math.random() * 0.6;

    if (score > bestScore) {
      bestScore = score;
      best = set;
    }
  }

  // If every legal set was an all-Jester set (hand is all Jesters), just play
  // one — there is nothing else to do.
  if (!best) {
    const solo = sets.find((s) => s.length === 1);
    return { action: 'play', cards: (solo ?? sets[0]) };
  }
  return { action: 'play', cards: best };
}

/* ------------------------------ main entry ----------------------------- */

export function aiDecide(hand: Card[], lastPlay: PlayedSet | null, ctx?: Partial<AIContext>): AIDecision {
  const context: AIContext = {
    role: ctx?.role,
    handSize: ctx?.handSize ?? hand.length,
    playersLeft: ctx?.playersLeft ?? 5,
    isLeader: ctx?.isLeader ?? lastPlay === null,
    trickAge: ctx?.trickAge ?? 0,
  };
  if (hand.length === 0) return { action: 'pass' };

  if (lastPlay === null) return chooseLead(hand, context);
  return chooseFollow(followSets(hand, lastPlay), context);
}

/* ------------------------- taxation selection -------------------------- */

/**
 * Dalmutis must hand back cards they do NOT want. Correct strategy: give away
 * the weakest (highest-rank) cards, keep strong (low) cards, and never give a
 * Jester unless it is literally the only card available.
 */
function weakestFirst(hand: Card[]): Card[] {
  return [...hand].sort((a, b) => {
    // Jesters sort to the very bottom (least desirable to give away).
    if (a.rank === 13 && b.rank === 13) return 0;
    if (a.rank === 13) return 1;
    if (b.rank === 13) return -1;
    return b.rank - a.rank; // higher (weaker) rank first
  });
}

export function aiSelectGreaterDalmutiTax(hand: Card[]): Card[] {
  return weakestFirst(hand).slice(0, 2);
}

export function aiSelectLesserDalmutiTax(hand: Card[]): Card {
  return weakestFirst(hand)[0];
}

/* ---------------------------- revolution ------------------------------- */

/**
 * Evaluate whether calling a Revolution (cancelling taxation) is a good
 * decision for this player, given their role and hand.
 *
 * • Dalmutis BENEFIT from taxes (they receive strong cards and dump weak
 *   ones) — they should NOT revolt.
 * • Peons LOSE strong cards to taxes — they SHOULD be willing to revolt when
 *   the cards they would surrender are genuinely valuable.
 * • Merchants are unaffected by taxes — revolting is a "tell" with no gain,
 *   so they stay put.
 */
export function shouldCallRevolution(hand: Card[], role?: Role): boolean {
  if (countJesters(hand) < 2) return false;
  if (!role) return false;

  // Only Peons stand to gain from cancelling taxes.
  if (role === 'greater-dalmuti' || role === 'lesser-dalmuti') return false;
  if (role === 'merchant') return false;

  // How valuable are the cards this role would be forced to surrender?
  const weakest = [...hand].sort((a, b) => a.rank - b.rank); // lowest (strongest) first
  const surrendered = role === 'greater-peon' ? weakest.slice(0, 2) : weakest.slice(0, 1);
  const valueLost = surrendered.reduce((s, c) => s + (12 - c.rank), 0);

  // Call when the taxes would cost a lot (i.e. we hold strong low cards).
  // A little randomness keeps it from being a perfectly predictable rule.
  const threshold = (role === 'greater-peon' ? 13 : 8) - Math.random() * 2;
  return valueLost >= threshold;
}
