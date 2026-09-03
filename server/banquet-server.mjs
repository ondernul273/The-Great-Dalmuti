/**
 * The Great Dalmuti — Banquet Browser relay server (Transport #2).
 *
 * Run with:   node server/banquet-server.mjs        (needs `socket.io` installed)
 * Then point the client at it:  VITE_BANQUET_URL=http://localhost:3001 npm run dev
 *
 * A deliberately dumb relay: it owns lobby membership, passwords, ready
 * flags, listing and chat. All game rules stay in the browser; game traffic
 * is forwarded verbatim via `game:message`.
 *
 * v1.3 — reconnect support & spectators
 * --------------------------------------
 * Every player is identified by a stable, browser-persisted `clientId` (see
 * `src/net/identity.ts`), NOT by their Socket.IO `socket.id` (which changes
 * on every reconnect/page refresh). This server keeps a `socketId` per
 * player internally for routing, but game code and player-facing IDs are
 * always the `clientId`.
 *
 * On a raw socket disconnect (e.g. a page refresh) a player is not removed
 * immediately — they are marked `connected: false` and kept for a grace
 * period (RECONNECT_GRACE_MS). If they reconnect with the same clientId
 * before the grace period elapses, they silently resume their seat (host or
 * guest, in-lobby or mid-game). An explicit `lobby:leave` is always
 * immediate and permanent.
 *
 * Lobbies also accept more humans than `maxPlayers`: the first `maxPlayers`
 * joiners (by join order) are the active seats; anyone beyond that is a
 * spectator. The client slices the same `players` array the same way, so no
 * separate "spectator" wire format is needed. When an active player leaves,
 * the next spectator in line becomes active automatically on the next game.
 */
import { createServer } from 'node:http';
import { Server } from 'socket.io';

const PORT = Number(process.env.PORT ?? 3001);
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_LOBBIES = 200;
const MAX_SEATS = 8;
/** Hard ceiling per lobby including spectators, to prevent abuse. */
const MAX_LOBBY_MEMBERS = 24;
/** How long a disconnected player's seat is held open for a reconnect. */
const RECONNECT_GRACE_MS = 90_000;

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      ok: true,
      service: 'dalmuti-banquet',
      lobbies: lobbies.size,
      playersOnline: io?.engine?.clientsCount ?? 0,
    })
  );
});

const io = new Server(httpServer, {
  cors: { origin: true },
  pingTimeout: 25000,
});

/** @type {Map<string, object>} lobbyId -> lobby */
const lobbies = new Map();
/** @type {Map<string, { lobbyId: string, clientId: string }>} socket.id -> where they sit */
const socketIndex = new Map();
/** @type {Map<string, ReturnType<typeof setTimeout>>} clientId -> pending-removal timer */
const graceTimers = new Map();

const genCode = () => {
  let c = '';
  for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
};

const uniqueCode = () => {
  for (let i = 0; i < 50; i++) {
    const c = genCode();
    if (!lobbies.has(c)) return c;
  }
  return genCode() + genCode();
};

/** Public shape sent to clients — strips the internal `socketId`. */
const summary = (l) => ({
  id: l.id,
  name: l.name,
  hostId: l.hostId,
  hostName: l.hostName,
  passworded: !!l.password,
  maxPlayers: l.maxPlayers,
  inGame: l.inGame,
  players: l.players.map((p) => ({
    id: p.id,
    name: p.name,
    isHost: p.isHost,
    ready: p.ready,
    isAI: p.isAI,
    connected: p.connected !== false,
  })),
});

const room = (lobbyId) => `lobby:${lobbyId}`;

const lobbyOfSocket = (socket) => {
  const idx = socketIndex.get(socket.id);
  if (!idx) return null;
  return lobbies.get(idx.lobbyId) ?? null;
};

const lobbyOfClient = (clientId) => {
  for (const l of lobbies.values()) {
    if (l.players.some((p) => p.id === clientId)) return l;
  }
  return null;
};

const socketForPlayer = (player) => (player?.socketId ? io.sockets.sockets.get(player.socketId) : null);

const broadcastLobby = (l) => {
  io.to(room(l.id)).emit('lobby:update', summary(l));
};

const broadcastStats = () => {
  const stats = {
    activeLobbies: lobbies.size,
    playersOnline: io.engine.clientsCount,
  };
  io.emit('stats:update', stats);
};

const removeLobby = (l, reason) => {
  lobbies.delete(l.id);
  io.to(room(l.id)).emit('lobby:closed', { reason });
  for (const p of l.players) {
    const s = socketForPlayer(p);
    s?.leave(room(l.id));
    if (p.socketId) socketIndex.delete(p.socketId);
  }
  clearGrace(l);
  broadcastStats();
};

const clearGrace = (l) => {
  for (const p of l.players) {
    const t = graceTimers.get(p.id);
    if (t) {
      clearTimeout(t);
      graceTimers.delete(p.id);
    }
  }
};

const sendError = (socket, message) => socket.emit('error', { message });

/** First `maxPlayers` humans+AI (join order) are "active"; the rest spectate. */
const activeCount = (l) => Math.min(l.players.length, l.maxPlayers);

/**
 * Pick the human (non-AI) player who has been connected longest and promote
 * them to host. Always picks a real human — AI seats are never hosts.
 */
function transferHost(lobby, leavingName) {
  // Humans sorted by their original join timestamp (ascending).
  const humans = lobby.players
    .filter((p) => !p.isAI)
    .sort((a, b) => (lobby.joinedAt[a.id] ?? 0) - (lobby.joinedAt[b.id] ?? 0));
  if (humans.length === 0) return;
  const next = humans[0];
  lobby.hostId = next.id;
  lobby.hostName = next.name;
  // Mark the new host's ready state so a game-in-progress isn't stuck on a
  // "waiting for host ready" that no longer exists.
  if (!lobby.inGame) next.ready = true;
  console.log(
    `[banquet] lobby ${lobby.id} host transferred from ${leavingName} → ${next.name}`
  );
  io.to(room(lobby.id)).emit('lobby:chat', {
    name: 'Herald',
    text: `${leavingName} left the game. ${next.name} is now the host.`,
    system: true,
  });
  broadcastLobby(lobby);
}

function finalizeRemoval(lobby, clientId) {
  graceTimers.delete(clientId);
  const leaver = lobby.players.find((p) => p.id === clientId);
  if (!leaver) return;
  lobby.players = lobby.players.filter((p) => p.id !== clientId);
  if (leaver.socketId) socketIndex.delete(leaver.socketId);

  // Host left or timed out → transfer, don't close the lobby.
  if (lobby.hostId === clientId) {
    if (lobby.players.some((p) => !p.isAI)) {
      transferHost(lobby, leaver.name);
    } else {
      console.log(`[banquet] lobby ${lobby.id} closed (no human players left)`);
      removeLobby(lobby, 'The host left the banquet.');
    }
    return;
  }
  if (lobby.players.length === 0) {
    lobbies.delete(lobby.id);
    broadcastStats();
    return;
  }
  io.to(room(lobby.id)).emit('lobby:chat', {
    name: 'Herald',
    text: `${leaver.name} leaves the table.`,
    system: true,
  });
  broadcastLobby(lobby);
}

io.on('connection', (socket) => {
  console.log(`[banquet] connect ${socket.id}`);
  broadcastStats();

  /* ----------------------------- listing ----------------------------- */
  socket.on('lobby:list', () => {
    socket.emit('lobby:list', {
      lobbies: [...lobbies.values()].filter((l) => !l.inGame).map(summary),
    });
  });

  socket.on('stats:get', () => {
    socket.emit('stats:update', {
      activeLobbies: lobbies.size,
      playersOnline: io.engine.clientsCount,
    });
  });

  /* ----------------------------- create ------------------------------ */
  socket.on('lobby:create', (opts = {}) => {
    const clientId = String(opts.clientId ?? '').trim();
    if (!clientId) return sendError(socket, 'Missing client identity — please reload.');
    if (lobbyOfClient(clientId)) return sendError(socket, 'You are already in a lobby.');
    if (lobbies.size >= MAX_LOBBIES)
      return sendError(socket, 'The banquet hall is full — try again later.');
    const password = String(opts.password ?? '').trim();
    const maxPlayers = Math.min(MAX_SEATS, Math.max(3, Number(opts.maxPlayers) || MAX_SEATS));
    const id = uniqueCode();
    const hostName = String(opts.hostName ?? 'Host').slice(0, 16) || 'Host';
    const lobby = {
      id,
      name: String(opts.lobbyName ?? `${hostName}'s banquet`).slice(0, 40),
      hostId: clientId,
      hostName,
      password: password || null,
      maxPlayers,
      inGame: false,
      joinedAt: { [clientId]: Date.now() },
      players: [
        { id: clientId, socketId: socket.id, name: hostName, isHost: true, ready: true, isAI: false, connected: true },
      ],
    };
    lobbies.set(id, lobby);
    socketIndex.set(socket.id, { lobbyId: id, clientId });
    socket.join(room(id));
    console.log(`[banquet] lobby ${id} created by ${hostName}`);
    broadcastLobby(lobby);
    broadcastStats();
  });

  /* ------------------------------ join ------------------------------- */
  socket.on('lobby:join', ({ lobbyId, password, name, clientId } = {}) => {
    const cid = String(clientId ?? '').trim();
    if (!cid) return sendError(socket, 'Missing client identity — please reload.');
    const lobby = lobbies.get(String(lobbyId ?? '').toUpperCase());
    if (!lobby) return sendError(socket, 'Lobby not found — it may have closed.');

    const existing = lobby.players.find((p) => p.id === cid);
    if (existing) {
      // Reconnect: same person, new socket. Skip the password check entirely
      // — proving the clientId (persisted in their own browser) is enough.
      const t = graceTimers.get(cid);
      if (t) {
        clearTimeout(t);
        graceTimers.delete(cid);
      }
      if (existing.socketId && existing.socketId !== socket.id) socketIndex.delete(existing.socketId);
      existing.socketId = socket.id;
      existing.connected = true;
      if (name) existing.name = String(name).slice(0, 16) || existing.name;
      socketIndex.set(socket.id, { lobbyId: lobby.id, clientId: cid });
      socket.join(room(lobby.id));
      console.log(`[banquet] ${existing.name} reconnected to ${lobby.id}`);
      io.to(room(lobby.id)).emit('lobby:chat', {
        name: 'Herald',
        text: `${existing.name} reconnects to the table.`,
        system: true,
      });
      broadcastLobby(lobby);
      if (lobby.inGame) {
        // Let the host know a game is underway and this client needs the
        // authoritative state resent (the host answers via game:message).
        io.to(room(lobby.id)).emit('lobby:playerReconnected', { clientId: cid });
      }
      return;
    }

    if (lobby.inGame) return sendError(socket, 'That banquet has already begun — you may still spectate.');
    if (lobby.players.length >= MAX_LOBBY_MEMBERS) return sendError(socket, 'That table is completely full.');
    if (lobby.password && lobby.password !== String(password ?? ''))
      return sendError(socket, 'Wrong password for that lobby.');

    const playerName = String(name ?? 'Guest').slice(0, 16) || 'Guest';
    lobby.players.push({
      id: cid,
      socketId: socket.id,
      name: playerName,
      isHost: false,
      ready: false,
      isAI: false,
      connected: true,
    });
    // Preserve the first-join timestamp for "longest connected" host transfer.
    lobby.joinedAt = lobby.joinedAt || {};
    if (!lobby.joinedAt[cid]) lobby.joinedAt[cid] = Date.now();
    socketIndex.set(socket.id, { lobbyId: lobby.id, clientId: cid });
    socket.join(room(lobby.id));
    const spectating = lobby.players.length > lobby.maxPlayers;
    console.log(`[banquet] ${playerName} joined ${lobby.id}${spectating ? ' (spectating)' : ''}`);
    broadcastLobby(lobby);
    io.to(room(lobby.id)).emit('lobby:chat', {
      name: 'Herald',
      text: spectating ? `${playerName} joins to watch as a spectator.` : `${playerName} takes a seat.`,
      system: true,
    });
    broadcastStats();
  });

  /* ------------------------------ ready ------------------------------ */
  socket.on('lobby:ready', ({ ready } = {}) => {
    const lobby = lobbyOfSocket(socket);
    if (!lobby) return;
    const p = lobby.players.find((x) => x.socketId === socket.id);
    if (!p || p.isHost || p.isAI) return;
    p.ready = !!ready;
    broadcastLobby(lobby);
  });

  /* ------------------------------- chat ------------------------------ */
  socket.on('lobby:chat', ({ text } = {}) => {
    const lobby = lobbyOfSocket(socket);
    if (!lobby) return;
    const p = lobby.players.find((x) => x.socketId === socket.id);
    const clean = String(text ?? '').slice(0, 200);
    if (!clean) return;
    io.to(room(lobby.id)).emit('lobby:chat', { name: p?.name ?? 'Guest', text: clean });
  });

  /* ---------------------------- AI seats ----------------------------- */
  socket.on('lobby:addai', ({ name } = {}) => {
    const lobby = lobbyOfSocket(socket);
    if (!lobby || lobby.hostId !== socketIndex.get(socket.id)?.clientId) return;
    if (lobby.players.length >= lobby.maxPlayers)
      return sendError(socket, 'That table is full.');
    const aiName = String(name ?? 'Courtier').slice(0, 16);
    lobby.players.push({
      id: `ai-${Math.random().toString(36).slice(2, 8)}`,
      socketId: null,
      name: aiName,
      isHost: false,
      ready: true,
      isAI: true,
      connected: true,
    });
    broadcastLobby(lobby);
  });

  socket.on('lobby:removeai', ({ id } = {}) => {
    const lobby = lobbyOfSocket(socket);
    if (!lobby || lobby.hostId !== socketIndex.get(socket.id)?.clientId) return;
    lobby.players = lobby.players.filter((p) => !(p.isAI && p.id === id));
    broadcastLobby(lobby);
  });

  /* ------------------------------ start ------------------------------ */
  socket.on('lobby:start', () => {
    const lobby = lobbyOfSocket(socket);
    if (!lobby || lobby.hostId !== socketIndex.get(socket.id)?.clientId) return;
    const active = lobby.players.slice(0, activeCount(lobby));
    const humans = active.filter((p) => !p.isAI);
    if (active.length < 3) return sendError(socket, 'At least 3 players are needed.');
    if (humans.some((p) => !p.ready)) return sendError(socket, 'Waiting for every guest to ready up.');
    lobby.inGame = true;
    console.log(`[banquet] lobby ${lobby.id} starts with ${active.length} seats (+${lobby.players.length - active.length} spectating)`);
    io.to(room(lobby.id)).emit('lobby:started', { lobbyId: lobby.id });
    broadcastLobby(lobby);
    broadcastStats();
  });

  /* -------------------- reopen lobby between games -------------------- */
  socket.on('lobby:reopen', () => {
    const lobby = lobbyOfSocket(socket);
    if (!lobby || lobby.hostId !== socketIndex.get(socket.id)?.clientId) return;
    lobby.inGame = false;
    for (const p of lobby.players) {
      if (!p.isAI) p.ready = p.isHost ? true : false;
    }
    console.log(`[banquet] lobby ${lobby.id} reopened for new guests`);
    io.to(room(lobby.id)).emit('lobby:chat', {
      name: 'Herald',
      text: 'The table is open again — new guests may join, ready up for the next game.',
      system: true,
    });
    broadcastLobby(lobby);
    broadcastStats();
  });

  /* --------------------------- game relay ---------------------------- */
  socket.on('game:message', ({ to, type, payload } = {}) => {
    const lobby = lobbyOfSocket(socket);
    if (!lobby) return;
    const fromClientId = socketIndex.get(socket.id)?.clientId ?? socket.id;
    // `from` is always the sender's stable clientId — never the raw socket
    // id — so recipients can match it against `GameState.players[].id`
    // even across the sender's own reconnects.
    const packet = { from: fromClientId, type: String(type ?? ''), payload };

    if (to === 'host') {
      const hostPlayer = lobby.players.find((p) => p.id === lobby.hostId);
      const hostSocket = socketForPlayer(hostPlayer);
      if (hostSocket) io.to(hostSocket.id).emit('game:message', packet);
    } else if (to === '*' || to == null) {
      socket.to(room(lobby.id)).emit('game:message', packet);
    } else {
      const target = lobby.players.find((p) => p.id === String(to));
      const targetSocket = socketForPlayer(target);
      if (targetSocket) io.to(targetSocket.id).emit('game:message', packet);
    }
  });

  /* ------------------------------ leave ------------------------------ */
  socket.on('lobby:leave', () => {
    const lobby = lobbyOfSocket(socket);
    if (!lobby) return;
    const clientId = socketIndex.get(socket.id)?.clientId;
    socketIndex.delete(socket.id);
    socket.leave(room(lobby.id));
    if (clientId) finalizeRemoval(lobby, clientId);
  });

  socket.on('disconnect', () => {
    console.log(`[banquet] disconnect ${socket.id}`);
    const idx = socketIndex.get(socket.id);
    socketIndex.delete(socket.id);
    broadcastStats();
    if (!idx) return;
    const lobby = lobbies.get(idx.lobbyId);
    if (!lobby) return;
    const player = lobby.players.find((p) => p.id === idx.clientId);
    if (!player) return;

    // A raw disconnect (page refresh, brief network drop) does NOT remove the
    // seat immediately — give them a grace period to reconnect with the same
    // clientId. An explicit `lobby:leave` (handled above) bypasses this.
    player.connected = false;
    broadcastLobby(lobby);
    const timer = setTimeout(() => finalizeRemoval(lobby, idx.clientId), RECONNECT_GRACE_MS);
    graceTimers.set(idx.clientId, timer);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[banquet] relay server listening on :${PORT}`);
});
