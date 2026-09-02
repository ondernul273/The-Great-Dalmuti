import type { GameState } from '../game/types';
import { getRoleName, rolesForSeating } from '../game/logic';
import { RoleBadge } from './RoleBadge';
import { cn } from '../utils/cn';
import { Trophy, X } from 'lucide-react';

/**
 * The scoreboard. Shows exactly what the end-of-round screen shows:
 * every player's finishing place and points, hand by hand, plus totals.
 */
export function ScorePanel({
  state,
  myPlayerId,
  onClose,
}: {
  state: GameState;
  myPlayerId: string;
  onClose: () => void;
}) {
  const n = state.players.length;
  const last = state.handResults[state.handResults.length - 1];

  // Current seating roles for the "next hand" preview come from finish order of last hand
  const orderedNow = last
    ? last.standings.map((s) => state.players.find((p) => p.id === s.playerId)!)
    : state.players;
  const roles = rolesForSeating(n);

  const byTotal = [...state.players].sort(
    (a, b) => (state.totalScores[b.id] ?? 0) - (state.totalScores[a.id] ?? 0)
  );

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm fade-in" onClick={onClose} />
      <div className="relative bg-gradient-to-b from-amber-50 to-amber-100 rounded-2xl border-4 border-amber-900/40 shadow-2xl w-full max-w-2xl max-h-[86vh] overflow-y-auto slide-up">
        <div className="sticky top-0 bg-gradient-to-r from-purple-900 to-purple-800 px-5 py-3 flex items-center justify-between rounded-t-xl border-b-4 border-amber-500/60">
          <h2 className="font-heading font-black text-amber-300 italic flex items-center gap-2" style={{ fontSize: 'var(--font-lg)' }}>
            <Trophy size="1.1em" /> Scoreboard
          </h2>
          <button
            onClick={onClose}
            className="text-amber-200 hover:text-white transition-colors"
            aria-label="Close scoreboard"
          >
            <X size="1.4rem" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Totals table */}
          <section>
            <h3 className="font-serif font-bold text-purple-900 mb-2" style={{ fontSize: 'var(--font-base)' }}>
              Overall standings
            </h3>
            <div className="space-y-1">
              {byTotal.map((p, i) => {
                const isMe = p.id === myPlayerId;
                return (
                  <div
                    key={p.id}
                    className={cn(
                      'flex items-center gap-3 px-3 py-1.5 rounded-lg border',
                      isMe ? 'bg-purple-200 border-purple-500' : 'bg-white/60 border-amber-300'
                    )}
                  >
                    <span className="font-heading font-black text-amber-900 w-8" style={{ fontSize: 'var(--font-base)' }}>
                      {i + 1}.
                    </span>
                    <span style={{ fontSize: 'var(--font-base)' }}>
                      <RoleBadge role={p.role} />
                    </span>
                    <span
                      className={cn('font-serif flex-1 truncate', isMe ? 'text-purple-900 font-bold' : 'text-amber-900')}
                      style={{ fontSize: 'var(--font-sm)' }}
                    >
                      {p.name}
                      {isMe && ' (You)'}
                    </span>
                    <span className="font-serif italic text-amber-800 hidden sm:block" style={{ fontSize: 'var(--font-xs)' }}>
                      {p.role ? getRoleName(p.role) : ''}
                    </span>
                    <span className="font-heading font-black text-purple-800" style={{ fontSize: 'var(--font-base)' }}>
                      {state.totalScores[p.id] ?? 0}
                      <span className="text-amber-700/70 font-serif font-normal" style={{ fontSize: 'var(--font-xs)' }}> pts</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Most recent hand — identical layout to the end-of-round screen */}
          <section>
            <h3 className="font-serif font-bold text-purple-900 mb-2" style={{ fontSize: 'var(--font-base)' }}>
              {last ? `Hand ${last.hand} — final order` : 'No hand finished yet'}
            </h3>
            {last && (
              <div className="space-y-1">
                {last.standings.map((st, i) => {
                  const isMe = st.playerId === myPlayerId;
                  return (
                    <div
                      key={st.playerId}
                      className={cn(
                        'flex items-center gap-3 px-3 py-1.5 rounded-lg border',
                        isMe ? 'bg-purple-200 border-purple-500' : 'bg-white/60 border-amber-300'
                      )}
                    >
                      <span className="font-serif font-black text-amber-900 w-8" style={{ fontSize: 'var(--font-base)' }}>
                        #{st.place}
                      </span>
                      <span style={{ fontSize: 'var(--font-base)' }}>
                        <RoleBadge role={roles[i]} />
                      </span>
                      <span
                        className={cn('font-serif flex-1 truncate', isMe ? 'text-purple-900 font-bold' : 'text-amber-900')}
                        style={{ fontSize: 'var(--font-sm)' }}
                      >
                        {st.name}
                        {isMe && ' (You)'}
                      </span>
                      <span className="font-serif italic text-amber-800 hidden sm:block" style={{ fontSize: 'var(--font-xs)' }}>
                        {getRoleName(roles[i])}
                      </span>
                      <span className="font-heading font-black text-emerald-700" style={{ fontSize: 'var(--font-base)' }}>
                        +{st.points}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Per-hand history */}
          {state.handResults.length > 0 && (
            <section>
              <h3 className="font-serif font-bold text-purple-900 mb-2" style={{ fontSize: 'var(--font-base)' }}>
                Hand history
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full font-serif border-collapse">
                  <thead>
                    <tr className="border-b-2 border-amber-400 text-amber-900">
                      <th className="text-left py-1 pr-2" style={{ fontSize: 'var(--font-xs)' }}>Hand</th>
                      {orderedNow.map((p) => (
                        <th key={p.id} className="text-center py-1 px-1" style={{ fontSize: 'var(--font-xs)' }}>
                          {p.name.split(' ')[0]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {state.handResults.map((r) => (
                      <tr key={r.hand} className="border-b border-amber-200/70">
                        <td className="py-1 pr-2 font-bold text-purple-900" style={{ fontSize: 'var(--font-xs)' }}>
                          #{r.hand}
                        </td>
                        {orderedNow.map((p) => {
                          const st = r.standings.find((s) => s.playerId === p.id);
                          return (
                            <td
                              key={p.id}
                              className={cn(
                                'text-center py-1 px-1 font-bold',
                                p.id === myPlayerId ? 'text-purple-800' : 'text-amber-800'
                              )}
                              style={{ fontSize: 'var(--font-xs)' }}
                            >
                              {st ? `${st.place}° (+${st.points})` : '—'}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <p className="font-serif italic text-amber-800/90" style={{ fontSize: 'var(--font-xs)' }}>
            Scoring: with {n} players, 1st place earns {n - 1} points down to 0 for last place.
          </p>
        </div>
      </div>
    </div>
  );
}
