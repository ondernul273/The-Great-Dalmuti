/**
 * Local player profile statistics — tracked entirely in the browser
 * (localStorage). No accounts, no server. One "game" = one completed hand,
 * matching how this app scores and reseats between hands.
 */

const STATS_KEY = 'dalmuti.stats';

export interface PlayerStats {
  gamesPlayed: number;
  gamesWon: number;
  /** Finished #1 (becomes Greater Dalmuti next hand). */
  dalmutiFinishes: number;
  /** Finished last (becomes Greater Peon next hand). */
  peasantFinishes: number;
  currentStreak: number;
  longestStreak: number;
}

const EMPTY_STATS: PlayerStats = {
  gamesPlayed: 0,
  gamesWon: 0,
  dalmutiFinishes: 0,
  peasantFinishes: 0,
  currentStreak: 0,
  longestStreak: 0,
};

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — stats just won't persist this session */
  }
}

export function loadStats(): PlayerStats {
  const raw = safeGet(STATS_KEY);
  if (!raw) return { ...EMPTY_STATS };
  try {
    const parsed = JSON.parse(raw) as Partial<PlayerStats>;
    return { ...EMPTY_STATS, ...parsed };
  } catch {
    return { ...EMPTY_STATS };
  }
}

function save(stats: PlayerStats): void {
  safeSet(STATS_KEY, JSON.stringify(stats));
}

/** Call once per completed hand, with this player's finishing place. */
export function recordHandOutcome(place: number, totalPlayers: number): PlayerStats {
  const stats = loadStats();
  stats.gamesPlayed += 1;
  const won = place === 1;
  if (won) {
    stats.gamesWon += 1;
    stats.dalmutiFinishes += 1;
    stats.currentStreak += 1;
    stats.longestStreak = Math.max(stats.longestStreak, stats.currentStreak);
  } else {
    stats.currentStreak = 0;
    if (place >= totalPlayers) stats.peasantFinishes += 1;
  }
  save(stats);
  return stats;
}

export function resetStats(): PlayerStats {
  save({ ...EMPTY_STATS });
  return { ...EMPTY_STATS };
}

export function winRate(stats: PlayerStats): number {
  if (stats.gamesPlayed === 0) return 0;
  return stats.gamesWon / stats.gamesPlayed;
}
