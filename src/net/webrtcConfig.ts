import type { PeerOptions } from 'peerjs';
import { traceCandidate, traceIceState } from './joinTrace';

/* ------------------------------------------------------------------ */
/*  ICE configuration                                                  */
/*  STUN  = discovers your public IP  (works on most home networks)    */
/*  TURN  = relays all media/data     (needed on corporate networks)   */
/* ------------------------------------------------------------------ */

const env = import.meta.env as unknown as Record<string, string | undefined>;

/**
 * Optional self-hosted TURN via env vars, e.g. in `.env`:
 *   VITE_TURN_URLS=turn:turn.example.com:3478,turns:turn.example.com:5349
 *   VITE_TURN_USERNAME=dalmuti
 *   VITE_TURN_CREDENTIAL=super-secret
 * A dedicated TURN server is strongly recommended for reliable corporate play.
 */
function customTurn(): RTCIceServer[] {
  const urls = env.VITE_TURN_URLS?.split(',').map((u) => u.trim()).filter(Boolean);
  if (!urls || urls.length === 0) return [];
  return [
    {
      urls,
      username: env.VITE_TURN_USERNAME ?? '',
      credential: env.VITE_TURN_CREDENTIAL ?? '',
    },
  ];
}

/** Multiple public STUN servers — redundancy if one is blocked or down. */
export const STUN_SERVERS: RTCIceServer[] = [
  {
    urls: [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
      'stun:stun2.l.google.com:19302',
      'stun:stun3.l.google.com:19302',
      'stun:stun4.l.google.com:19302',
    ],
  },
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.nextcloud.com:443' },
  { urls: 'stun:stun.relay.metered.ca:80' },
];

/**
 * Free shared TURN (Open Relay Project). Crucially includes TCP/TLS on port 443,
 * which is the only path that usually survives a corporate firewall that blocks UDP.
 * Shared credentials = rate-limited and best-effort; see recommendation in the README notes.
 */
export const PUBLIC_TURN_SERVERS: RTCIceServer[] = [
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    // TCP on 443 — looks like ordinary HTTPS traffic to a firewall
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    // TLS on 443 — best chance through deep-packet-inspection proxies
    urls: 'turns:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:relay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:relay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

export const ICE_SERVERS: RTCIceServer[] = [
  ...STUN_SERVERS,
  ...customTurn(),
  ...PUBLIC_TURN_SERVERS,
];

export const HAS_CUSTOM_TURN = customTurn().length > 0;

/** The exact RTCConfiguration handed to every RTCPeerConnection PeerJS creates. */
export function rtcConfiguration(forceRelay = false): RTCConfiguration {
  return {
    iceServers: ICE_SERVERS,
    // Pre-gather candidates so the offer already contains srflx/relay entries.
    iceCandidatePoolSize: 10,
    // 'relay' = TURN only. Used for the automatic retry when a direct path fails.
    iceTransportPolicy: forceRelay ? 'relay' : 'all',
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
  };
}

/**
 * The exact PeerJS options used by this app.
 * Signaling runs over HTTPS/WSS on 443 so it passes most corporate proxies.
 */
export function peerOptions(forceRelay = false): PeerOptions {
  return {
    host: env.VITE_PEER_HOST ?? '0.peerjs.com',
    port: Number(env.VITE_PEER_PORT ?? 443),
    path: env.VITE_PEER_PATH ?? '/',
    secure: (env.VITE_PEER_SECURE ?? 'true') !== 'false',
    key: env.VITE_PEER_KEY ?? 'peerjs',
    debug: 2,
    config: rtcConfiguration(forceRelay),
  };
}

/* ------------------------------------------------------------------ */
/*  Diagnostics                                                        */
/* ------------------------------------------------------------------ */

export type CandidateKind = 'host' | 'srflx' | 'prflx' | 'relay';

export interface IceDiagnostics {
  gatheringState: RTCIceGatheringState | 'unknown';
  iceState: RTCIceConnectionState | 'unknown';
  connectionState: RTCPeerConnectionState | 'unknown';
  signalingState: RTCSignalingState | 'unknown';
  candidates: Record<CandidateKind, number>;
  /** A server-reflexive candidate proves outbound STUN/UDP works. */
  stunReachable: boolean;
  /** A relay candidate proves a TURN server was allocated. */
  turnReachable: boolean;
  /** Path actually chosen once connected, e.g. "relay ↔ srflx". */
  selectedPair?: string;
  usingRelay: boolean;
  forcedRelay: boolean;
  blocked: boolean;
  summary: string;
}

export function emptyDiagnostics(): IceDiagnostics {
  return {
    gatheringState: 'unknown',
    iceState: 'unknown',
    connectionState: 'unknown',
    signalingState: 'unknown',
    candidates: { host: 0, srflx: 0, prflx: 0, relay: 0 },
    stunReachable: false,
    turnReachable: false,
    usingRelay: false,
    forcedRelay: false,
    blocked: false,
    summary: 'No connection attempted yet.',
  };
}

export const BLOCKED_MESSAGE =
  'Your network may be blocking peer-to-peer connections. ' +
  'Corporate firewalls and VPNs often block the UDP traffic WebRTC needs. ' +
  'Try a phone hotspot, disable the VPN, or ask IT to allow UDP 3478 and TCP/UDP 49152-65535.';

/** Human-readable explanation of what the gathered candidates imply. */
export function summarise(d: IceDiagnostics): string {
  if (d.iceState === 'connected' || d.iceState === 'completed') {
    return d.usingRelay
      ? 'Connected through a TURN relay (direct peer-to-peer was blocked).'
      : 'Connected directly, peer-to-peer.';
  }
  if (!d.stunReachable && !d.turnReachable) {
    return 'No STUN or TURN candidates were gathered — outbound UDP appears to be blocked entirely.';
  }
  if (d.stunReachable && !d.turnReachable) {
    return 'STUN works but no TURN relay could be allocated. A symmetric NAT will need TURN.';
  }
  if (!d.stunReachable && d.turnReachable) {
    return 'UDP/STUN is blocked, but a TURN relay is available — the connection must be relayed.';
  }
  if (d.iceState === 'failed') {
    return 'ICE negotiation failed: no working network path between the two players.';
  }
  return 'Gathering network candidates…';
}

/**
 * Attach live ICE diagnostics to a PeerJS DataConnection. PeerJS creates the
 * RTCPeerConnection asynchronously, so we poll briefly until it exists.
 */
export function attachIceDiagnostics(
  getPeerConnection: () => RTCPeerConnection | undefined | null,
  label: string,
  forcedRelay: boolean,
  onUpdate: (d: IceDiagnostics) => void
): () => void {
  const diag = emptyDiagnostics();
  diag.forcedRelay = forcedRelay;
  let stopped = false;
  let pc: RTCPeerConnection | null = null;
  let statsTimer = 0;

  const push = () => {
    diag.summary = summarise(diag);
    onUpdate({ ...diag, candidates: { ...diag.candidates } });
  };

  const iceLog = (...a: unknown[]) =>
    console.log(`%c[ICE:${label}]`, 'color:#38bdf8;font-weight:bold', ...a);

  const onIceCandidate = (ev: RTCPeerConnectionIceEvent) => {
    if (!ev.candidate) {
      iceLog('candidate gathering complete');
      return;
    }
    const kind = (ev.candidate.type ?? 'host') as CandidateKind;
    diag.candidates[kind] = (diag.candidates[kind] ?? 0) + 1;
    if (kind === 'srflx') diag.stunReachable = true;
    if (kind === 'relay') diag.turnReachable = true;
    traceCandidate(kind);
    iceLog(
      `candidate ${kind} · ${ev.candidate.protocol ?? '?'} · ${ev.candidate.address ?? 'n/a'}:${
        ev.candidate.port ?? '?'
      }`
    );
    push();
  };

  const onIceStateChange = () => {
    if (!pc) return;
    diag.iceState = pc.iceConnectionState;
    traceIceState('ice', pc.iceConnectionState);
    iceLog('iceConnectionState →', pc.iceConnectionState);
    if (pc.iceConnectionState === 'failed') {
      diag.blocked = true;
      console.error(`%c[ICE:${label}] ICE FAILED — ${BLOCKED_MESSAGE}`, 'color:#f87171');
    }
    if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
      void readSelectedPair();
    }
    push();
  };

  const onConnStateChange = () => {
    if (!pc) return;
    diag.connectionState = pc.connectionState;
    traceIceState('conn', pc.connectionState);
    iceLog('connectionState →', pc.connectionState);
    if (pc.connectionState === 'failed') diag.blocked = true;
    push();
  };

  const onGatheringChange = () => {
    if (!pc) return;
    diag.gatheringState = pc.iceGatheringState;
    iceLog('iceGatheringState →', pc.iceGatheringState);
    if (pc.iceGatheringState === 'complete' && !diag.stunReachable && !diag.turnReachable) {
      diag.blocked = true;
      console.warn(
        `%c[ICE:${label}] Only host candidates gathered — NAT/firewall is blocking STUN and TURN.`,
        'color:#fb923c'
      );
    }
    push();
  };

  const onSignalingChange = () => {
    if (!pc) return;
    diag.signalingState = pc.signalingState;
    traceIceState('sig', pc.signalingState);
    push();
  };

  /** Read which candidate pair actually won, so we know if we're relayed. */
  const readSelectedPair = async () => {
    if (!pc) return;
    try {
      const stats = await pc.getStats();
      let pairId: string | undefined;
      stats.forEach((r: Record<string, unknown>) => {
        if (r.type === 'transport' && typeof r.selectedCandidatePairId === 'string') {
          pairId = r.selectedCandidatePairId;
        }
      });
      let local: Record<string, unknown> | undefined;
      let remote: Record<string, unknown> | undefined;
      stats.forEach((r: Record<string, unknown>) => {
        const isSelected =
          r.type === 'candidate-pair' &&
          (r.id === pairId || (r.selected === true && r.state === 'succeeded'));
        if (isSelected) {
          stats.forEach((c: Record<string, unknown>) => {
            if (c.id === r.localCandidateId) local = c;
            if (c.id === r.remoteCandidateId) remote = c;
          });
        }
      });
      if (local || remote) {
        const lt = String(local?.candidateType ?? '?');
        const rt = String(remote?.candidateType ?? '?');
        diag.selectedPair = `${lt} ↔ ${rt}`;
        diag.usingRelay = lt === 'relay' || rt === 'relay';
        iceLog('selected candidate pair:', diag.selectedPair, diag.usingRelay ? '(RELAYED)' : '(DIRECT)');
        push();
      }
    } catch (e) {
      console.warn(`[ICE:${label}] getStats failed`, e);
    }
  };

  // Poll for the RTCPeerConnection PeerJS creates under the hood.
  const started = Date.now();
  const poll = window.setInterval(() => {
    if (stopped) return;
    const found = getPeerConnection();
    if (found) {
      window.clearInterval(poll);
      pc = found;
      iceLog('RTCPeerConnection acquired — attaching diagnostics');
      diag.gatheringState = pc.iceGatheringState;
      diag.iceState = pc.iceConnectionState;
      diag.connectionState = pc.connectionState;
      diag.signalingState = pc.signalingState;
      pc.addEventListener('icecandidate', onIceCandidate);
      pc.addEventListener('iceconnectionstatechange', onIceStateChange);
      pc.addEventListener('connectionstatechange', onConnStateChange);
      pc.addEventListener('icegatheringstatechange', onGatheringChange);
      pc.addEventListener('signalingstatechange', onSignalingChange);
      statsTimer = window.setInterval(() => void readSelectedPair(), 3000);
      push();
    } else if (Date.now() - started > 8000) {
      window.clearInterval(poll);
      console.warn(`[ICE:${label}] never saw an RTCPeerConnection`);
    }
  }, 100);

  return () => {
    stopped = true;
    window.clearInterval(poll);
    window.clearInterval(statsTimer);
    if (pc) {
      pc.removeEventListener('icecandidate', onIceCandidate);
      pc.removeEventListener('iceconnectionstatechange', onIceStateChange);
      pc.removeEventListener('connectionstatechange', onConnStateChange);
      pc.removeEventListener('icegatheringstatechange', onGatheringChange);
      pc.removeEventListener('signalingstatechange', onSignalingChange);
    }
  };
}

/* ------------------------------------------------------------------ */
/*  Stand-alone pre-flight network test                                */
/* ------------------------------------------------------------------ */

export interface NetworkTestResult {
  running: boolean;
  stun: boolean;
  turn: boolean;
  udpBlocked: boolean;
  verdict: 'good' | 'relay-only' | 'blocked' | 'unknown';
  message: string;
  candidates: Record<CandidateKind, number>;
  durationMs: number;
}

/**
 * Gathers ICE candidates against our exact ICE server list without contacting
 * another player. Tells you up-front whether this network can do WebRTC.
 */
export async function runNetworkTest(timeoutMs = 8000): Promise<NetworkTestResult> {
  const started = Date.now();
  const candidates: Record<CandidateKind, number> = { host: 0, srflx: 0, prflx: 0, relay: 0 };
  const log = (...a: unknown[]) =>
    console.log('%c[NETTEST]', 'color:#a78bfa;font-weight:bold', ...a);

  log('starting — ICE servers:', ICE_SERVERS);

  let pc: RTCPeerConnection | null = null;
  try {
    pc = new RTCPeerConnection(rtcConfiguration(false));
    pc.createDataChannel('probe');

    await new Promise<void>((resolve) => {
      const done = () => resolve();
      const timer = window.setTimeout(done, timeoutMs);

      pc!.addEventListener('icecandidate', (ev) => {
        if (!ev.candidate) {
          window.clearTimeout(timer);
          done();
          return;
        }
        const kind = (ev.candidate.type ?? 'host') as CandidateKind;
        candidates[kind] = (candidates[kind] ?? 0) + 1;
        log(`candidate ${kind} (${ev.candidate.protocol ?? '?'})`);
        // Stop early once we know both STUN and TURN work.
        if (candidates.srflx > 0 && candidates.relay > 0) {
          window.clearTimeout(timer);
          done();
        }
      });

      pc!.createOffer()
        .then((offer) => pc!.setLocalDescription(offer))
        .catch((e) => {
          console.error('[NETTEST] createOffer failed', e);
          window.clearTimeout(timer);
          done();
        });
    });
  } catch (e) {
    console.error('[NETTEST] failed to create RTCPeerConnection', e);
  } finally {
    try {
      pc?.close();
    } catch {
      /* noop */
    }
  }

  const stun = candidates.srflx > 0;
  const turn = candidates.relay > 0;
  const durationMs = Date.now() - started;

  let verdict: NetworkTestResult['verdict'] = 'unknown';
  let message: string;
  if (stun && turn) {
    verdict = 'good';
    message = 'Your network supports peer-to-peer play (STUN and TURN both reachable).';
  } else if (turn && !stun) {
    verdict = 'relay-only';
    message =
      'Direct peer-to-peer looks blocked, but a TURN relay is reachable — games will work, routed through a relay.';
  } else if (stun && !turn) {
    verdict = 'good';
    message =
      'STUN works, so most connections will succeed. If a game still fails, the other player is likely behind a strict NAT that needs TURN.';
  } else {
    verdict = 'blocked';
    message = BLOCKED_MESSAGE;
  }

  const result: NetworkTestResult = {
    running: false,
    stun,
    turn,
    udpBlocked: !stun,
    verdict,
    message,
    candidates,
    durationMs,
  };
  log('result:', result);
  return result;
}
