import type { Card, Rank } from './types';

export interface CardInfo {
  rank: Rank;
  name: string;
  plural?: string;
  bgColor: string;
  borderColor: string;
  titleColor: string;
  illustration: string; // emoji fallback for the illustration
  describe: string;
}

export const CARD_INFO: Record<Rank, CardInfo> = {
  1: {
    rank: 1,
    name: 'Dalmuti',
    bgColor: '#9b59b6', // purple - royal
    borderColor: '#8e44ad',
    titleColor: '#f1c40f',
    illustration: '👑',
    describe: 'The Dalmuti',
  },
  2: {
    rank: 2,
    name: 'Archbishop',
    bgColor: '#c0392b', // red - church
    borderColor: '#a93226',
    titleColor: '#f4d03f',
    illustration: '⛪',
    describe: 'Archbishop',
  },
  3: {
    rank: 3,
    name: 'Earl Marshal',
    bgColor: '#7f8c8d', // grey - military
    borderColor: '#616a6b',
    titleColor: '#ecf0f1',
    illustration: '⚔️',
    describe: 'Earl Marshal',
  },
  4: {
    rank: 4,
    name: 'Baroness',
    bgColor: '#8e44ad', // deep purple
    borderColor: '#7d3c98',
    titleColor: '#f5b041',
    illustration: '🏰',
    describe: 'Baroness',
  },
  5: {
    rank: 5,
    name: 'Abbess',
    bgColor: '#27ae60', // green - nun/abbess
    borderColor: '#1e8449',
    titleColor: '#f9e79f',
    illustration: '✨',
    describe: 'Abbess',
  },
  6: {
    rank: 6,
    name: 'Knight',
    bgColor: '#2c3e50', // dark blue - knight
    borderColor: '#1b2631',
    titleColor: '#f1c40f',
    illustration: '🛡️',
    describe: 'Knight',
  },
  7: {
    rank: 7,
    name: 'Seamstress',
    bgColor: '#d4a017', // gold/yellow - seamstress
    borderColor: '#b7950b',
    titleColor: '#e74c3c',
    illustration: '🧵',
    describe: 'Seamstress',
  },
  8: {
    rank: 8,
    name: 'Mason',
    bgColor: '#a0522d', // brown - mason/stone
    borderColor: '#7f4524',
    titleColor: '#f0e68c',
    illustration: '🔨',
    describe: 'Mason',
  },
  9: {
    rank: 9,
    name: 'Cook',
    bgColor: '#e67e22', // orange - cook
    borderColor: '#ca6f1e',
    titleColor: '#fff8dc',
    illustration: '🍲',
    describe: 'Cook',
  },
  10: {
    rank: 10,
    name: 'Shepherdess',
    bgColor: '#52be80', // light green
    borderColor: '#27ae60',
    titleColor: '#fdfefe',
    illustration: '🐑',
    describe: 'Shepherdess',
  },
  11: {
    rank: 11,
    name: 'Stonecutter',
    bgColor: '#7f8c8d', // gray - stone
    borderColor: '#5d6d7e',
    titleColor: '#fad7a0',
    illustration: '⛏️',
    describe: 'Stonecutter',
  },
  12: {
    rank: 12,
    name: 'Peasant',
    bgColor: '#8b7355', // dark tan - peasant
    borderColor: '#6b5335',
    titleColor: '#fdebd0',
    illustration: '🌾',
    describe: 'Peasant',
  },
  13: {
    rank: 13,
    name: 'Jester',
    plural: 'Jesters',
    bgColor: '#4b0082', // indigo - jester
    borderColor: '#2e0854',
    titleColor: '#ffd700',
    illustration: '🃏',
    describe: 'Jester (Wild)',
  },
};

export function createDeck(): Card[] {
  const deck: Card[] = [];
  let idCounter = 0;

  for (let r = 1; r <= 12; r++) {
    const rank = r as Rank;
    const info = CARD_INFO[rank];
    for (let i = 0; i < r; i++) {
      deck.push({
        id: `card-${idCounter++}`,
        rank,
        name: info.name,
      });
    }
  }

  // Two Jesters
  for (let i = 0; i < 2; i++) {
    deck.push({
      id: `card-${idCounter++}`,
      rank: 13,
      name: CARD_INFO[13].name,
    });
  }

  return deck;
}

export function shuffle<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function sortHand(hand: Card[]): Card[] {
  return [...hand].sort((a, b) => a.rank - b.rank);
}

// Lowest card in a hand (for taxes). Jesters are highest for the initial draw,
// but for tax purposes, Jesters are treated as rank 13 (highest), so we give lowest non-jester.
export function lowestCards(hand: Card[], count: number): Card[] {
  const nonJesters = hand.filter((c) => c.rank !== 13);
  const jesters = hand.filter((c) => c.rank === 13);
  const sorted = [...nonJesters].sort((a, b) => a.rank - b.rank);
  const lowest = sorted.slice(0, count);
  // If we don't have enough non-jesters, add jesters (edge case)
  if (lowest.length < count) {
    lowest.push(...jesters.slice(0, count - lowest.length));
  }
  return lowest;
}

export function countJesters(hand: Card[]): number {
  return hand.filter((c) => c.rank === 13).length;
}
