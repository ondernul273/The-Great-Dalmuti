import type { IceDiagnostics, NetworkTestResult } from '../net/webrtcConfig';
import { cn } from '../utils/cn';

function Dot({ ok, warnOnly }: { ok: boolean; warnOnly?: boolean }) {
  return (
    <span
      className={cn(
        'inline-block w-2.5 h-2.5 rounded-full shrink-0',
        ok ? 'bg-emerald-500' : warnOnly ? 'bg-amber-500' : 'bg-red-500'
      )}
    />
  );
}

/** Pre-flight "can this network do WebRTC?" widget. */
export function NetworkTestBox({
  result,
  testing,
  hasDedicatedTurn,
  onRun,
}: {
  result: NetworkTestResult | null;
  testing: boolean;
  hasDedicatedTurn: boolean;
  onRun: () => void;
}) {
  return (
    <div className="rounded-lg border-2 border-amber-700/30 bg-white/55 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-serif font-bold text-amber-900" style={{ fontSize: 'var(--font-sm)' }}>
          Network check
        </span>
        <button
          onClick={onRun}
          disabled={testing}
          className="px-3 py-1 rounded-md bg-purple-800 hover:bg-purple-700 disabled:opacity-50 text-amber-100 font-serif font-bold"
          style={{ fontSize: 'var(--font-xs)' }}
        >
          {testing ? 'Testing…' : 'Test my network'}
        </button>
      </div>

      {result && (
        <div className="mt-2 space-y-1">
          <div className="flex items-center gap-2 font-serif text-amber-900" style={{ fontSize: 'var(--font-xs)' }}>
            <Dot ok={result.stun} />
            STUN (direct peer-to-peer): {result.stun ? 'reachable' : 'blocked'}
          </div>
          <div className="flex items-center gap-2 font-serif text-amber-900" style={{ fontSize: 'var(--font-xs)' }}>
            <Dot ok={result.turn} warnOnly />
            TURN (relay fallback): {result.turn ? 'reachable' : 'unavailable'}
          </div>
          <p
            className={cn(
              'font-serif italic mt-1',
              result.verdict === 'blocked' ? 'text-red-700' : 'text-amber-800'
            )}
            style={{ fontSize: 'var(--font-xs)' }}
          >
            {result.message}
          </p>
          {!hasDedicatedTurn && result.verdict !== 'good' && (
            <p className="font-serif italic text-amber-700/80" style={{ fontSize: 'var(--font-tiny)' }}>
              This build uses a free shared TURN relay. A dedicated TURN server is recommended for
              reliable play on corporate networks.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Live ICE state during/after a connection attempt. */
export function IceDiagnosticsBox({ d }: { d: IceDiagnostics }) {
  const rows: [string, string][] = [
    ['ICE state', d.iceState],
    ['Connection', d.connectionState],
    ['Gathering', d.gatheringState],
    [
      'Candidates',
      `host ${d.candidates.host} · srflx ${d.candidates.srflx} · relay ${d.candidates.relay}`,
    ],
  ];
  if (d.selectedPair) rows.push(['Path', `${d.selectedPair}${d.usingRelay ? ' (relayed)' : ' (direct)'}`]);
  if (d.forcedRelay) rows.push(['Mode', 'TURN relay only']);

  return (
    <div className="rounded-lg border border-amber-700/25 bg-black/5 p-2.5 mt-2">
      <p className="font-serif font-bold text-amber-900 mb-1" style={{ fontSize: 'var(--font-xs)' }}>
        Connection diagnostics
      </p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <span className="font-serif text-amber-800/80" style={{ fontSize: 'var(--font-tiny)' }}>
              {k}
            </span>
            <span className="font-mono text-amber-900" style={{ fontSize: 'var(--font-tiny)' }}>
              {v}
            </span>
          </div>
        ))}
      </div>
      <p className="font-serif italic text-amber-800 mt-1.5" style={{ fontSize: 'var(--font-tiny)' }}>
        {d.summary}
      </p>
    </div>
  );
}
