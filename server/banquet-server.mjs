/**
 * The Great Dalmuti — Banquet Browser relay server (Transport #2).
 *
 * Run with:   node server/banquet-server.mjs        (needs `socket.io` installed)
 * Then point the client at it:  VITE_BANQUET_URL=http://localhost:3001 npm run dev
 *
 * A deliberately dumb relay: it owns lobby membership, passwords, ready
 * flags, listing and chat. All game rules stay in the browser; game traffic
 * is forwarded verbatim via `game:message`.
 */
import { createServer } from 'node:http';
import { Server } from 'socket.io';

const PORT = Number(process.env.PORT ?? 3001);
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_LOBBIES = 200;
const MAX_SEATS = 8;

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, service: 'dalmuti-banquet', lobbies: lobbies.size }));
});

const io = new Server(httpServer, {
  cors: { origin: true },
  pingTimeout: 25000,
});

/** @type {Map<string, object>} */
const lobbies = new Map();

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

const summary = (l) => ({
  id: l.id,
  name: l.name,
  hostId: l.hostId,
  hostName: l.hostName,
  passworded: !!l.password,
  maxPlayers: l.maxPlayers,
  inGame: l.inGame,
  players: l.players.map((p) => ({ ...p })),
});

const lobbyOf = (socket) => {
  for (const l of lobbies.values()) {
    if (l.players.some((p) => p.id === socket.id)) return l;
  }
  return null;
};

const broadcastLobby = (l) => {
  io.to(`lobby:${l.id}`).emit('lobby:update', summary(l));
};

const removeLobby = (l, reason) => {
  lobbies.delete(l.id);
  io.to(`lobby:${l.id}`).emit('lobby:closed', { reason });
  for (const p of l.players) {
    const s = io.sockets.sockets.get(p.id);
    s?.leave(`lobby:${l.id}`);
  }
};

const sendError = (socket, message) => socket.emit('error', { message });

io.on('connection', (socket) => {
  console.log(`[banquet] connect ${socket.id}`);

  /* ----------------------------- listing ----------------------------- */
  socket.on('lobby:list', () => {
    socket.emit('lobby:list', {
      lobbies: [...lobbies.values()].filter((l) => !l.inGame).map(summary),
    });
  });

  /* ----------------------------- create ------------------------------ */
  socket.on('lobby:create', (opts = {}) => {
    if (lobbyOf(socket)) return sendError(socket, 'You are already in a lobby.');
    if (lobbies.size >= MAX_LOBBIES)
      return sendError(socket, 'The banquet hall is full — try again later.');
    const password = String(opts.password ?? '').trim();
    const maxPlayers = Math.min(MAX_SEATS, Math.max(3, Number(opts.maxPlayers) || MAX_SEATS));
    const id = uniqueCode();
    const lobby = {
      id,
      name: String(opts.lobbyName ?? `${opts.hostName || 'A'}'s banquet`).slice(0, 40),
      hostId: socket.id,
      hostName: String(opts.hostName ?? 'Host').slice(0, 16) || 'Host',
      password: password || null,
      maxPlayers,
      inGame: false,
      players: [
        { id: socket.id, name: String(opts.hostName ?? 'Host').slice(0, 16) || 'Host', isHost: true, ready: true, isAI: false },
      ],
    };
    lobbies.set(id, lobby);
    socket.join(`lobby:${id}`);
    console.log(`[banquet] lobby ${id} created by ${lobby.hostName}`);
    broadcastLobby(lobby);
  });

  /* ------------------------------ join ------------------------------- */
  socket.on('lobby:join', ({ lobbyId, password, name } = {}) => {
    const lobby = lobbies.get(String(lobbyId ?? '').toUpperCase());
    if (!lobby) return sendError(socket, 'Lobby not found — it may have closed.');
    if (lobby.inGame) return sendError(socket, 'That banquet has already begun.');
    if (lobby.players.some((p) => p.id === socket.id)) {
      socket.join(`lobby:${lobby.id}`);
      return broadcastLobby(lobby);
    }
    if (lobby.players.length >= lobby.maxPlayers)
      return sendError(socket, 'That table is full.');
    if (lobby.password && lobby.password !== String(password ?? ''))
      return sendError(socket, 'Wrong password for that lobby.');
    const playerName = String(name ?? 'Guest').slice(0, 16) || 'Guest';
    lobby.players.push({ id: socket.id, name: playerName, isHost: false, ready: false, isAI: false });
    socket.join(`lobby:${lobby.id}`);
    console.log(`[banquet] ${playerName} joined ${lobby.id}`);
    broadcastLobby(lobby);
    io.to(`lobby:${lobby.id}`).emit('lobby:chat', { name: 'Herald', text: `${playerName} takes a seat.`, system: true });
  });

  /* ------------------------------ ready ------------------------------ */
  socket.on('lobby:ready', ({ ready } = {}) => {
    const lobby = lobbyOf(socket);
    if (!lobby) return;
    const p = lobby.players.find((x) => x.id === socket.id);
    if (!p || p.isHost || p.isAI) return;
    p.ready = !!ready;
    broadcastLobby(lobby);
  });

  /* ------------------------------- chat ------------------------------ */
  socket.on('lobby:chat', ({ text } = {}) => {
    const lobby = lobbyOf(socket);
    if (!lobby) return;
    const p = lobby.players.find((x) => x.id === socket.id);
    const clean = String(text ?? '').slice(0, 200);
    if (!clean) return;
    io.to(`lobby:${lobby.id}`).emit('lobby:chat', { name: p?.name ?? 'Guest', text: clean });
  });

  /* ---------------------------- AI seats ----------------------------- */
  socket.on('lobby:addai', ({ name } = {}) => {
    const lobby = lobbyOf(socket);
    if (!lobby || lobby.hostId !== socket.id) return;
    if (lobby.players.length >= lobby.maxPlayers)
      return sendError(socket, 'That table is full.');
    const aiName = String(name ?? 'Courtier').slice(0, 16);
    lobby.players.push({ id: `ai-${Math.random().toString(36).slice(2, 8)}`, name: aiName, isHost: false, ready: true, isAI: true });
    broadcastLobby(lobby);
  });

  socket.on('lobby:removeai', ({ id } = {}) => {
    const lobby = lobbyOf(socket);
    if (!lobby || lobby.hostId !== socket.id) return;
    lobby.players = lobby.players.filter((p) => !(p.isAI && p.id === id));
    broadcastLobby(lobby);
  });

  /* ------------------------------ start ------------------------------ */
  socket.on('lobby:start', () => {
    const lobby = lobbyOf(socket);
    if (!lobby || lobby.hostId !== socket.id) return;
    const humans = lobby.players.filter((p) => !p.isAI);
    if (lobby.players.length < 3)
      return sendError(socket, 'At least 3 players are needed.');
    if (humans.some((p) => !p.ready))
      return sendError(socket, 'Waiting for every guest to ready up.');
    lobby.inGame = true;
    console.log(`[banquet] lobby ${lobby.id} starts with ${lobby.players.length} seats`);
    io.to(`lobby:${lobby.id}`).emit('lobby:started', { lobbyId: lobby.id });
    broadcastLobby(lobby);
  });

  /* --------------------------- game relay ---------------------------- */
  socket.on('game:message', ({ to, type, payload } = {}) => {
    const lobby = lobbyOf(socket);
    if (!lobby) return;
    const packet = { from: socket.id, type: String(type ?? ''), payload };
    if (to === 'host') {
      io.to(lobby.hostId).emit('game:message', packet);
    } else if (to === '*' || to == null) {
      socket.to(`lobby:${lobby.id}`).emit('game:message', packet);
    } else {
      io.to(String(to)).emit('game:message', packet);
    }
  });

  /* ------------------------------ leave ------------------------------ */
  socket.on('lobby:leave', () => {
    const lobby = lobbyOf(socket);
    if (!lobby) return;
    leaveLobby(socket, lobby);
  });

  socket.on('disconnect', () => {
    console.log(`[banquet] disconnect ${socket.id}`);
    const lobby = lobbyOf(socket);
    if (lobby) leaveLobby(socket, lobby, true);
  });
});

function leaveLobby(socket, lobby, silent = false) {
  const leaver = lobby.players.find((p) => p.id === socket.id);
  lobby.players = lobby.players.filter((p) => p.id !== socket.id);
  socket.leave(`lobby:${lobby.id}`);
  if (leaver) {
    io.to(`lobby:${lobby.id}`).emit('lobby:chat', {
      name: 'Herald',
      text: `${leaver.name} leaves the table.`,
      system: true,
    });
  }
  if (lobby.hostId === socket.id) {
    console.log(`[banquet] lobby ${lobby.id} closed (host left)`);
    removeLobby(lobby, 'The host left the banquet.');
    return;
  }
  if (lobby.players.length === 0) {
    lobbies.delete(lobby.id);
    return;
  }
  if (!silent) broadcastLobby(lobby);
  else broadcastLobby(lobby);
}

httpServer.listen(PORT, () => {
  console.log(`[banquet] relay server listening on :${PORT}`);
});
