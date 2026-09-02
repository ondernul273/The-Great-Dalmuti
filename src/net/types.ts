/**
 * Transport-agnostic networking types.
 *
 * The game logic never talks to PeerJS or Socket.IO directly — it only ever
 * sees `NetMessage` objects and uses the small send/broadcast primitives the
 * active transport provides (see `useMultiplayer` for Direct Connect and
 * `useSocketLobby` for the Banquet Browser).
 */

export interface NetMessage {
  type: string;
  from: string;
  to?: string;
  payload: any;
  timestamp: number;
}

/** Kept as an alias so existing imports keep working. */
export type PeerMessage = NetMessage;

export type TransportKind = 'direct' | 'banquet';

/* ------------------------- Banquet Browser ------------------------- */

export interface BanquetPlayer {
  id: string;
  name: string;
  isHost: boolean;
  ready: boolean;
  isAI: boolean;
}

export interface BanquetLobby {
  id: string;
  name: string;
  hostId: string;
  hostName: string;
  passworded: boolean;
  maxPlayers: number;
  inGame: boolean;
  players: BanquetPlayer[];
}

export type LobbySummary = BanquetLobby;

export type ServerStatus = 'offline' | 'connecting' | 'online' | 'error';

export interface BanquetView {
  serverStatus: ServerStatus;
  error: string | null;
  myId: string;
  lobby: BanquetLobby | null;
  lobbies: LobbySummary[];
  listing: boolean;
  serverUrl: string;
}

export interface LobbyChatLine {
  id: string;
  name: string;
  text: string;
  system?: boolean;
  ts: number;
}
