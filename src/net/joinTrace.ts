/**
 * Join-attempt trace + root-cause diagnosis. DIAGNOSTICS ONLY.
 *
 * Records one ordered event list per connection attempt (host or guest),
 * prints every event with a +ms timestamp as it happens, and on completion
 * prints a boxed final diagnosis:
 *
 *   A. Host ID not found
 *   B. Signaling server unreachable
 *   C. WebRTC ICE failed
 *   D. Firewall/NAT blocked connection
 *
 * Inspect at any time from the console:  __dalmutiDiagnose()
 */

export type TraceRole = 'HOST' | 'GUEST';

export type TraceEventName =
  | 'peer-created'
  | 'peer-opened'
  | 'peer-id'
  | 'peer-registered'
  | 'incoming-connection'
  | 'datachannel-opened'
  | 'target-host-id'
  | 'connect-called'
  | 'peer-unavailable'
  | 'network-error'
  | 'disconnected-error'
  | 'server-error'
  | 'socket-error'
  | 'ice-connection-state'
  | 'connection-state'
  | 'signaling-state'
  | 'timeout'
  | 'error-other';

export interface TraceEvent {
  ms: number;
  role: TraceRole;
  event: TraceEventName;
  detail?: string;
}

export interface CandidateCounts {
  host: number;
  srflx: number;
  prflx: number;
  relay: number;
}

export type DiagnosisCode = 'OK' | 'A' | 'B' | 'C' | 'D' | 'UNKNOWN';

export const DIAGNOSIS_LABELS: Record<DiagnosisCode, string> = {
  OK: 'Connected successfully',
  A: 'Host ID not found',
  B: 'Signaling server unreachable',
  C: 'WebRTC ICE failed',
  D: 'Firewall/NAT blocked connection',
  UNKNOWN: 'Undetermined',
};

export interface Diagnosis {
  code: DiagnosisCode;
  label: string;
  stoppedAt: string;
  evidence: string[];
}

interface Attempt {
  no: number;
  role: TraceRole;
  startedAt: number;
  startedWall: string;
  events: TraceEvent[];
  peerOpened: boolean;
  channelOpened: boolean;
  candidates: CandidateCounts;
  iceStates: string[];
  connStates: string[];
  sigStates: string[];
  errorTypes: string[];
  timeoutStage: 'open' | 'connect' | null;
  finished: boolean;
}

let attempt: Attempt | null = null;
let attemptNo = 0;
let lastDiagnosis: Diagnosis | null = null;

const STYLE = 'color:#38bdf8;font-weight:bold';
const GOLD = 'color:#f5b041;font-weight:bold';

function wallClock(): string {
  return new Date().toISOString().slice(11, 23);
}

function eventLine(e: TraceEvent): string {
  return `+${String(e.ms).padStart(6)}ms  ${e.role.padEnd(5)}  ${e.event}${
    e.detail ? '  → ' + e.detail : ''
  }`;
}

/* ------------------------------ recording ------------------------------ */

export function traceStart(role: TraceRole, note?: string): void {
  attemptNo += 1;
  attempt = {
    no: attemptNo,
    role,
    startedAt: performance.now(),
    startedWall: wallClock(),
    events: [],
    peerOpened: false,
    channelOpened: false,
    candidates: { host: 0, srflx: 0, prflx: 0, relay: 0 },
    iceStates: [],
    connStates: [],
    sigStates: [],
    errorTypes: [],
    timeoutStage: null,
    finished: false,
  };
  console.log(
    `%c[TRACE] ===== attempt #${attemptNo} (${role}) started ${attempt.startedWall}${
      note ? ' — ' + note : ''
    } =====`,
    STYLE
  );
}

export function traceIsActive(): boolean {
  return !!attempt && !attempt.finished;
}

export function traceEvent(event: TraceEventName, detail?: string): void {
  if (!attempt || attempt.finished) return;
  const e: TraceEvent = {
    ms: Math.round(performance.now() - attempt.startedAt),
    role: attempt.role,
    event,
    detail,
  };
  attempt.events.push(e);
  console.log(`%c[TRACE +${e.ms}ms]`, STYLE, `${e.role} ${event}${detail ? ' → ' + detail : ''}`);

  if (event === 'peer-opened') attempt.peerOpened = true;
  if (event === 'datachannel-opened') {
    attempt.channelOpened = true;
    // First open data channel ends the attempt with a success diagnosis.
    traceFinish();
  }
}

/** Map a PeerJS error type onto the requested event names and remember it. */
export function traceErrorType(type: string): void {
  if (!attempt) return;
  attempt.errorTypes.push(type || 'unknown');
  const mapped: Record<string, TraceEventName> = {
    'peer-unavailable': 'peer-unavailable',
    network: 'network-error',
    disconnected: 'disconnected-error',
    'server-error': 'server-error',
    'socket-error': 'socket-error',
    'socket-closed': 'socket-error',
  };
  traceEvent(mapped[type] ?? 'error-other', type || undefined);
}

export function traceIceState(kind: 'ice' | 'conn' | 'sig', value: string): void {
  if (!attempt || attempt.finished) return;
  if (kind === 'ice') {
    attempt.iceStates.push(value);
    traceEvent('ice-connection-state', value);
  } else if (kind === 'conn') {
    attempt.connStates.push(value);
    traceEvent('connection-state', value);
  } else {
    attempt.sigStates.push(value);
    traceEvent('signaling-state', value);
  }
}

export function traceCandidate(kind: keyof CandidateCounts): void {
  if (!attempt || attempt.finished) return;
  attempt.candidates[kind] += 1;
}

export function traceTimeout(stage: 'open' | 'connect'): void {
  if (!attempt || attempt.finished) return;
  attempt.timeoutStage = stage;
  traceEvent('timeout', `${stage} stage`);
}

/* ------------------------------ diagnosis ------------------------------ */

export function diagnose(): Diagnosis {
  const a = attempt;
  if (!a) {
    return {
      code: 'UNKNOWN',
      label: DIAGNOSIS_LABELS.UNKNOWN,
      stoppedAt: 'n/a',
      evidence: ['no attempt recorded'],
    };
  }

  const last = a.events[a.events.length - 1];
  const stoppedAt = last
    ? `${last.event}${last.detail ? ' (' + last.detail + ')' : ''} at +${last.ms}ms`
    : 'no events recorded';

  const evidence: string[] = [
    `peerOpened=${a.peerOpened}`,
    `dataChannelOpened=${a.channelOpened}`,
    `candidates host=${a.candidates.host} srflx=${a.candidates.srflx} prflx=${a.candidates.prflx} relay=${a.candidates.relay}`,
    `iceConnectionState=${a.iceStates[a.iceStates.length - 1] ?? 'never observed'}`,
    `connectionState=${a.connStates[a.connStates.length - 1] ?? 'never observed'}`,
    `signalingState=${a.sigStates[a.sigStates.length - 1] ?? 'never observed'}`,
  ];
  if (a.errorTypes.length) evidence.push(`peer errors: ${a.errorTypes.join(', ')}`);
  if (a.timeoutStage) evidence.push(`timeout during: ${a.timeoutStage}`);

  let code: DiagnosisCode;
  if (a.channelOpened) {
    code = 'OK';
  } else if (a.errorTypes.includes('peer-unavailable')) {
    // The signaling server answered "no such peer" → the host ID does not exist.
    code = 'A';
  } else if (!a.peerOpened) {
    // We never even registered with the signaling server.
    code = 'B';
  } else if (
    a.errorTypes.some((t) => ['network', 'server-error', 'socket-error', 'socket-closed'].includes(t))
  ) {
    // Registered, then the signaling socket died.
    code = 'B';
  } else if (a.candidates.srflx === 0 && a.candidates.relay === 0) {
    // Only host candidates: outbound UDP/STUN and TURN are both unreachable.
    code = 'D';
  } else if (a.candidates.relay === 0) {
    // Some public candidates but no relay: NAT prevented a direct path and no
    // TURN fallback existed.
    code = 'D';
  } else {
    // Relay candidates were gathered yet no data channel opened: ICE itself failed.
    code = 'C';
  }

  return { code, label: DIAGNOSIS_LABELS[code], stoppedAt, evidence };
}

/** Close the current attempt and print the full trace + final diagnosis. */
export function traceFinish(): Diagnosis {
  if (!attempt) return lastDiagnosis ?? diagnose();
  if (attempt.finished) return lastDiagnosis ?? diagnose();

  attempt.finished = true;
  const d = diagnose();
  lastDiagnosis = d;

  console.log(`%c================ JOIN DIAGNOSIS (attempt #${attempt.no}, ${attempt.role}) ================`, GOLD);
  console.log(`%cstarted ${attempt.startedWall}`, GOLD);
  attempt.events.forEach((e) => console.log('  ' + eventLine(e)));
  console.log(`%cStopped at: ${d.stoppedAt}`, GOLD);
  d.evidence.forEach((ev) => console.log('   · ' + ev));
  const color = d.code === 'OK' ? '#4ade80' : '#f87171';
  console.log(`%cDIAGNOSIS ${d.code}: ${d.label}`, `color:${color};font-weight:bold;font-size:14px`);
  console.log('%c=========================================================================', GOLD);

  return d;
}

export function getTraceEvents(): TraceEvent[] {
  return attempt ? [...attempt.events] : [];
}

/* Console helper — non-destructive peek at the current diagnosis. */
if (typeof window !== 'undefined') {
  (window as unknown as { __dalmutiDiagnose?: unknown }).__dalmutiDiagnose = () => ({
    diagnosis: diagnose(),
    events: getTraceEvents(),
  });
}
