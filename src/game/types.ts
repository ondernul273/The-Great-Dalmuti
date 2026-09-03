export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

export interface Card {
  id: string;
  rank: Rank;
  name: string;
}

export type Role =
  | 'greater-dalmuti'
  | 'lesser-dalmuti'
  | 'merchant'
  | 'lesser-peon'
  | 'greater-peon';

export interface Player {
  id: string;
  name: string;
  hand: Card[];
  isHost: boolean;
  role?: Role;
  finishOrder?: number; // 1 = first out (next Greater Dalmuti), highest = Greater Peon
  isOut: boolean;
  /** removed from the table by the host (spectating this hand) */
  kicked?: boolean;
  /** seat disappears at the next reseat */
  dropped?: boolean;
  /** player asked to leave once the current hand finishes (visible to everyone) */
  leavingAfterRound?: boolean;
  /** true once this seat has been reclaimed by a live connection (reconnect bookkeeping) */
  connected?: boolean;
}

export type Phase =
  | 'lobby'
  | 'seating'
  | 'dealing'
  | 'taxes'
  | 'playing'
  | 'hand-end';

/** One player's card in the opening draw for seats (first hand only). */
export interface SeatDraw {
  playerId: string;
  card: Card;
}

export interface PlayedSet {
  playerId: string;
  cards: Card[];
  effectiveRank: Rank;
}

export interface Standing {
  playerId: string;
  name: string;
  place: number;
  points: number;
}

export interface HandResult {
  hand: number;
  standings: Standing[];
}

export interface ChatMessage {
  id: string;
  name: string;
  text: string;
  ts: number;
  system?: boolean;
  mine?: boolean;
}

export interface PendingTaxes {
  /** lowest 2 cards already surrendered by the Greater Peon */
  greaterPeonCardsGiven: Card[];
  /** lowest card already surrendered by the Lesser Peon (null if none) */
  lesserPeonCardGiven: Card | null;
  /** what the Greater Dalmuti hands back (null until chosen) */
  greaterDalmutiCardsGiven: Card[] | null;
  /** what the Lesser Dalmuti hands back (null until chosen) */
  lesserDalmutiCardGiven: Card | null;
  /** is a Lesser Dalmuti / Lesser Peon exchange part of this hand? */
  lesserExchangeRequired: boolean;
  greaterDalmutiId: string;
  lesserDalmutiId: string | null;
}

export interface RosterEntry {
  id: string;
  name: string;
  kind: 'host' | 'human' | 'ai';
}

export interface GameState {
  /** epoch ms of when the current turn began — drives the 60s turn clock */
  turnStartedAt: number;
  /** whether the turn hourglass (and auto-pass on timeout) is active this game */
  timerEnabled: boolean;
  /** chosen turn length in seconds (15…120), part of the lobby settings */
  timerSeconds: number;
  /** consecutive-per-hand timeout count per player id (AFK tracking) */
  afkCounts: Record<string, number>;
  /** players who have passed during the current trick */
  passedIds: string[];
  /** the opening draw for seats, in seat order (Greater Dalmuti first); null after hand 1 */
  seatingDraw: SeatDraw[] | null;
  /** name of the card set in use — travels with the game state so guests stay in sync */
  cardSet: string;
  /** clientId → epoch-ms of first connection. Lowest value = "longest connected"; used for host transfer. */
  joinTimestamps: Record<string, number>;
  phase: Phase;
  players: Player[];
  deck: Card[];
  currentPlayerIndex: number;
  currentTrick: PlayedSet[];
  lastValidPlay: PlayedSet | null;
  leaderIndex: number;
  handNumber: number;
  message: string;
  revolutionCalled: boolean;
  pendingTaxes: PendingTaxes | null;
  /** results of every completed hand, in order */
  handResults: HandResult[];
  /** running total per player id */
  totalScores: Record<string, number>;
}

export interface NetworkMessage {
  type: string;
  payload: any;
}
