# Deployment Audit & Checklist — The Great Dalmuti

Audit of the current implementation. **No functionality was changed by this document.**

Architecture under audit:

| Layer | Tech | Location |
| --- | --- | --- |
| Frontend | React 19 + Vite 7 + Tailwind 4 | `src/`, built to `dist/index.html` |
| Transport 1 "Direct Connect" | PeerJS (WebRTC, host-authoritative) | `src/hooks/useMultiplayer.ts`, `src/net/webrtcConfig.ts` |
| Transport 2 "Banquet Browser" | Socket.IO relay (lobby server, host-authoritative game) | `src/net/useSocketLobby.ts` + `server/banquet-server.mjs` |
| Build | `vite-plugin-singlefile` → one self-contained `dist/index.html` (~2.6 MB, JS/CSS/images inlined) | `vite.config.ts` |

---

## 1. Dependencies — verified

Present and correct:

- `react`, `react-dom` 19.2.6 — UI
- `peerjs` ^1.5.5 — Transport 1
- `socket.io-client` ^4.8.3 — Transport 2 client
- `socket.io` ^4.8.3 — **used only by `server/banquet-server.mjs`**, but listed under `dependencies` (required so a platform installing prod deps can run the relay; keep it there)
- `lucide-react`, `clsx`, `tailwind-merge` — UI utilities
- dev: `vite`, `@vitejs/plugin-react`, `tailwindcss` + `@tailwindcss/vite`, `typescript`, `vite-plugin-singlefile`, `@types/*`

Gaps (checklist):

- [ ] No `engines` field / `.nvmrc`. Pin Node ≥ 20 (Socket.IO 4 + Vite 7 require it).
- [ ] No `concurrently` (optional) for a one-command local stack.
- [ ] `lucide-react` is on a loose caret; pin exact versions before tagging a release for reproducible builds.

## 2. package.json scripts — verified, incomplete

Current: `dev`, `build`, `preview` only.

- [ ] **`build` does not type-check.** It is plain `vite build` (esbuild strips types). A type error can ship silently. Add `"typecheck": "tsc --noEmit"` and run it in CI (or chain: `"build": "tsc --noEmit && vite build"`).
- [ ] Add `"server": "node server/banquet-server.mjs"` so the relay start command is discoverable.
- [ ] Optional `"dev:all": "concurrently -n relay,web \"node server/banquet-server.mjs\" \"vite\""`.
- [ ] No `lint` / `test` scripts — there is no test suite at all (see §10).

## 3. Local development

```bash
npm install
cp .env.example .env            # then uncomment VITE_BANQUET_URL=http://localhost:3001

# terminal 1 — Banquet relay (optional; Direct Connect works without it)
node server/banquet-server.mjs  # listens on :3001 (or $PORT)

# terminal 2 — web app
npm run dev                     # http://localhost:5173
```

- Direct Connect needs **no server**: signaling uses the public PeerJS cloud (`0.peerjs.com:443`), overridable via `VITE_PEER_*`.
- WebRTC traversal uses public STUN + the shared Open Relay TURN; corporate networks need your own TURN (§5, §8).
- `npm run preview` serves the production single-file build locally.

## 4. Production deployment readiness

Working today:

- `npm run build` → `dist/index.html`, fully self-contained: hostable on **any** static file server, CDN bucket, or platform static site. No server-side rendering, no runtime config reads.
- Relay is a single stateless-code/stateful-memory Node process with a JSON health endpoint at `GET /` (returns `{ ok, service, lobbies }`) — suitable as a platform health-check path.
- All client config is compile-time (`VITE_*`), so a build is immutable per environment.

Not ready / risks:

- [ ] **One 2.6 MB HTML per release.** `vite-plugin-singlefile` inlines everything: no hashed asset URLs, no partial caching, every release is a full re-download. Acceptable for a game this size; if it grows, drop singlefile for a normal `dist/` (this changes how the artifact is served — deliberate decision, not done here).
- [ ] Because config is baked at build time, **each environment (staging/prod) needs its own build** with its own `VITE_BANQUET_URL`.
- [ ] Relay holds all lobby state **in one process's memory** → run exactly **1 instance**; no horizontal scaling without work (§9).
- [ ] No CSP/security headers configured anywhere (static host must add them, §8).
- [ ] No README, LICENSE, CI workflow, Dockerfile, or infra-as-code in repo.
- [ ] No graceful shutdown (`SIGTERM`) in the relay: on redeploy, sockets drop abruptly and clients see "lost connection". Platform rolling deploys will interrupt live banquets.
- [ ] No reconnect/rejoin protocol: a guest page refresh loses their seat in both transports (§10).

## 5. Environment variables — verified against code

Client (build-time, must be prefixed `VITE_`; all optional):

| Variable | Read by | Purpose | Default |
| --- | --- | --- | --- |
| `VITE_BANQUET_URL` | `src/net/useSocketLobby.ts` | Banquet relay origin | `window.location.origin` (fails unless relay is co-hosted) |
| `VITE_TURN_URLS`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL` | `src/net/webrtcConfig.ts` | Dedicated TURN (comma-separated URLs; include a `:443`/`turns:` variant) | shared Open Relay |
| `VITE_PEER_HOST/PORT/PATH/SECURE/KEY` | `src/net/webrtcConfig.ts` | Self-hosted PeerJS signaling | public PeerJS cloud |

Server (runtime):

| Variable | Read by | Purpose | Default |
| --- | --- | --- | --- |
| `PORT` | `server/banquet-server.mjs` | HTTP/WS listen port | `3001` |

`.env.example` documents all of the above and matches the code. Checklist:

- [ ] TURN credentials are **client-visible by design** (they ship in the JS bundle). Use a time-limited/credential-hashed TURN setup or accept that users can extract them; never put secrets you care about in `VITE_*`.
- [ ] Relay has no other config surface (no CORS allow-list env, no rate-limit env) — see §8.

## 6. Render deployment

**Service A — relay (Web Service):**

1. New → Web Service → this repo. Root directory: `/`.
2. Runtime: Node. Build command: `npm install` (or leave blank; repo already has deps committed to lockfile). Start command: `node server/banquet-server.mjs`.
3. Instance count: **1** (in-memory lobby map). Plan: any; `PORT` is injected by Render automatically.
4. Health check path: `/`.
5. Note the URL, e.g. `https://dalmuti-relay.onrender.com`.

**Service B — frontend (Static Site):**

1. New → Static Site → same repo. Build command `npm run build`, publish directory `dist`.
2. Environment variable **at build time**: `VITE_BANQUET_URL=https://dalmuti-relay.onrender.com` (plus `VITE_TURN_*` if you run TURN).
3. Deploy. Direct Connect works immediately; Banquet Browser connects to Service A over WSS.

- [ ] Optional consolidation (serve `dist/` from the relay process so one service hosts both) requires adding static file serving to the server — out of scope of this audit, flagged only.
- [ ] Free-tier web services sleep after idle; the relay will drop live lobbies on sleep. Use a paid instance type for the relay.

## 7. Vercel deployment

**Frontend — supported:**

1. Import repo → framework preset **Vite** (auto-detected). Build `npm run build`, output `dist`.
2. Set env vars **before building**: `VITE_BANQUET_URL=https://<your-relay>` (Vercel envs are per-environment; mark Production).
3. Deploy. The single-file `dist/index.html` serves from the edge with no further config.

**Relay — NOT supported on Vercel:** Serverless Functions cannot hold a persistent WebSocket or in-process state. The Banquet relay must live on a persistent host (Render Web Service, Railway, Fly.io, a VPS). Point `VITE_BANQUET_URL` at it. If you deploy frontend-only to Vercel, ship with Banquet Browser visibly degraded (it already shows "server unreachable") or hide the mode.

- [ ] Optional `vercel.json` (`{ "framework": "vite", "buildCommand": "npm run build", "outputDirectory": "dist" }`) — not present in repo; Vercel auto-detects, so it is cosmetic.

## 8. Security concerns

Real, ranked:

1. **Full game state is broadcast to every client.** `state` messages contain all hands. Any guest can read every opponent's cards from devtools. Same in both transports. Fix = per-player projected views (functionality change; not done here). **Blocker for competitive/public launch, acceptable for friends-only.**
2. **Relay trusts any socket in a lobby as a message source.** `game:message` is forwarded verbatim; a malicious guest can emit `type: "state"` to `*` and spoof the table for other guests (clients apply `state` without verifying `from === hostId`). Checklist: server-side restrict `state`/`lobby:*` emitters to the host socket, and/or clients validate `msg.from` against the known host id.
3. **No rate limiting or abuse control** on `lobby:create`, `lobby:chat`, `game:message`. `MAX_LOBBIES = 200` caps memory only. Add per-socket throttling before public launch.
4. **CORS `origin: true`** on the relay: any website can open sockets and farm lobbies. Allow-list your frontend origins in production.
5. **Lobby passwords** are plaintext-compared in memory and travel over the platform's TLS only. Fine for casual privacy; do not reuse real passwords; enforce HTTPS (all listed platforms terminate TLS; HSTS header recommended).
6. **Public PeerJS cloud + shared Open Relay TURN** are third-party, rate-limited, no SLA, and the TURN credentials are public by nature. Self-host `peerjs-server` (`VITE_PEER_*`) and a coturn with secret auth (`VITE_TURN_*`) for production reliability.
7. **TURN credentials in the bundle** (see §5) and TURN credentials in `localStorage` (user-supplied, plaintext) — document, don't store anything sensitive.
8. **No security headers** on the static build: add `Content-Security-Policy` (note: singlefile inlines JS/CSS, so CSP needs `'unsafe-inline'` for script/style or nonce support on the host), `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`.
9. Chat/lobby names are length-capped server-side and rendered as React text nodes — no XSS vector found. JSON payloads are parsed, not evaluated — no injection vector found.

## 9. Scalability concerns

- **Direct Connect (PeerJS):** peer-to-peer after signaling; cost per game ≈ host upload of one state JSON (tens of KB) per action × guests. Scales horizontally for free. Bottlenecks: public signaling cloud rate limits (self-host for prod) and host departure kills the game (no host migration).
- **Banquet relay:** single Node process, in-memory `Map`. Vertically fine for hundreds of concurrent lobbies (it only routes JSON). Horizontally blocked by: (a) in-memory lobby table, (b) Socket.IO room state per node. Scaling path (not implemented): `@socket.io/redis-adapter` + Redis-backed lobby registry + `sticky` load balancing; or shard by lobby id.
- **Static frontend:** single 2.6 MB document; CDN-cached but all-or-nothing (no hashed sub-assets). Bandwidth ≈ 2.6 MB × visits; gzip ≈ 1.7 MB.
- **State churn:** every action re-broadcasts the entire `GameState` (structuredClone + JSON). At ≤ 8 seats this is trivial; do not raise `MAX_SEATS` without moving to deltas.

## 10. Missing features required before deployment

Must-have (integrity/UX):

- [ ] Per-player state projection (hide opponents' hands) — §8.1.
- [ ] Host-origin validation for `state` messages — §8.2.
- [ ] Reconnect/rejoin: token = lobby id + seat id; server re-attaches socket on reconnect (currently refresh = lost seat, both transports).
- [ ] Relay rate limiting + per-IP lobby creation caps.
- [ ] `tsc --noEmit` in build/CI (type errors currently ship silently).
- [ ] Graceful shutdown (`SIGTERM` → close sockets with notice) for clean redeploy.

Should-have:

- [ ] README (setup, both transports, rules pointer), LICENSE, `.nvmrc`/`engines`.
- [ ] CI workflow: typecheck + build on PR.
- [ ] Uptime monitor for relay `/` health endpoint; structured logging (currently `console.log`).
- [ ] Self-hosted PeerJS signaling + dedicated TURN for production networks.
- [ ] Host migration or an explicit "host left — table closed" flow in Direct Connect (guests currently land on a generic connection error).
- [ ] Automated tests for the pure rules layer (`src/game/logic.ts` is side-effect free and unit-testable as-is).

Nice-to-have: Dockerfile for the relay, lobby TTL sweep for zombie `inGame` lobbies, metrics (lobbies/min, messages/s).

---

## Go-live checklist (condensed)

1. [ ] Pin Node ≥ 20 (`engines`, `.nvmrc`).
2. [ ] `typecheck` script + CI (typecheck, build).
3. [ ] Decide state-projection stance (friends-only launch vs. implement §8.1).
4. [ ] Validate `state` message origin (server and/or client).
5. [ ] Provision TURN (coturn, hashed credentials) → `VITE_TURN_*`; self-host PeerJS → `VITE_PEER_*`.
6. [ ] Deploy relay: Render Web Service, 1 instance, start `node server/banquet-server.mjs`, health `/`, paid tier (no sleep), CORS allow-list, rate limits, graceful shutdown.
7. [ ] Deploy frontend: Vercel or Render Static, `npm run build` → `dist`, build-time `VITE_BANQUET_URL` + TURN/Peer vars; add security headers.
8. [ ] Smoke test both transports from two networks (mobile hotspot + corporate) using the in-app Network diagnostics.
9. [ ] README + LICENSE committed.
10. [ ] Monitor: relay health ping, error budget for `lobby:closed` spikes.
