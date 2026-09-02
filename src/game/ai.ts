import type { Card, PlayedSet } from './types';
import { getEffectiveRank } from './logic';
import { countJesters } from './cards';

export interface AIDecision {
  action: 'play' | 'pass';
  cards?: Card[];
}

function findAllValidSets(
  hand: Card[],
  lastPlay: PlayedSet | null
): Card[][] {
  const sets: Card[][] = [];
  const byRank: Record<number, Card[]> = {};

  for (const c of hand) {
    if (c.rank !== 13) {
      if (!byRank[c.rank]) byRank[c.rank] = [];
      byRank[c.rank].push(c);
    }
  }
  const jesters = hand.filter((c) => c.rank === 13);

  if (!lastPlay) {
    for (const rankKey of Object.keys(byRank)) {
      const cards = byRank[Number(rankKey)];
      for (let t = 1; t <= cards.length; t++) {
        // pure non-jester set of size t
        sets.push([...cards.slice(0, t)]);
        // with j jesters to fill: set size t + j
        for (let j = 1; j <= jesters.length; j++) {
          sets.push([...cards.slice(0, t), ...jesters.slice(0, j)]);
        }
      }
    }
    // All-jesters sets
    for (let j = 1; j <= jesters.length; j++) {
      sets.push([...jesters.slice(0, j)]);
    }
  } else {
    const requiredCount = lastPlay.cards.length;
    const targetRank = lastPlay.effectiveRank; // 13 = Jester (easily beaten)

    for (const rankKey of Object.keys(byRank)) {
      const rank = Number(rankKey);
      if (rank >= targetRank) continue;
      const cards = byRank[rank];
      for (let nonJesterCount = 1; nonJesterCount <= Math.min(cards.length, requiredCount); nonJesterCount++) {
        const neededJesters = requiredCount - nonJesterCount;
        if (neededJesters < 0) continue;
        if (neededJesters <= jesters.length) {
          const setCards = [
            ...cards.slice(0, nonJesterCount),
            ...jesters.slice(0, neededJesters),
          ];
          const eff = getEffectiveRank(setCards);
          if (eff !== null && eff < targetRank) {
            sets.push(setCards);
          }
        }
      }
    }

    if (jesters.length >= requiredCount && 13 < targetRank) {
      sets.push(jesters.slice(0, requiredCount));
    }
  }

  return sets;
}

function scoreSet(set: Card[]): number {
  const eff = getEffectiveRank(set);
  if (eff === null) return -9999;
  const jestersUsed = set.filter((c) => c.rank === 13).length;
  // Prefer dumping high-rank (weak) cards first, but preserve Jesters at all costs.
  // Higher rank number = better to dump. Using Jesters is very bad unless necessary.
  return eff * 10 + set.length * 2 - jestersUsed * 40;
}

function isSoloJester(set: Card[]): boolean {
  return set.length === 1 && set[0].rank === 13;
}

function isAllJesters(set: Card[]): boolean {
  return set.every((c) => c.rank === 13);
}

export function aiDecide(hand: Card[], lastPlay: PlayedSet | null): AIDecision {
  const validSets = findAllValidSets(hand, lastPlay);

  if (validSets.length === 0) {
    return { action: 'pass' };
  }

  // Filter out solo-Jester and all-Jester plays unless they're the only option.
  // Jesters are too valuable as wild cards to waste on trivial plays.
  const normalSets = validSets.filter((s) => !isSoloJester(s) && !isAllJesters(s));
  const candidate = normalSets.length > 0 ? normalSets : validSets;

  candidate.sort((a, b) => scoreSet(b) - scoreSet(a));
  return { action: 'play', cards: candidate[0] };
}

export function aiSelectGreaterDalmutiTax(hand: Card[]): Card[] {
  const sorted = [...hand].sort((a, b) => {
    const ra = a.rank === 13 ? 0 : a.rank;
    const rb = b.rank === 13 ? 0 : b.rank;
    return rb - ra;
  });
  return sorted.slice(0, 2);
}

export function aiSelectLesserDalmutiTax(hand: Card[]): Card {
  const sorted = [...hand].sort((a, b) => {
    const ra = a.rank === 13 ? 0 : a.rank;
    const rb = b.rank === 13 ? 0 : b.rank;
    return rb - ra;
  });
  return sorted[0];
}

export function shouldCallRevolution(hand: Card[]): boolean {
  return countJesters(hand) >= 2;
}
