import { useState } from 'react';
import { loadStats, resetStats, winRate, type PlayerStats } from '../game/stats';
import { cn } from '../utils/cn';
import { Trophy, Crown, Users, Flame, Percent, Gamepad2, RotateCcw, X } from 'lucide-react';

function StatRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex items-center gap-3 p-2.5 rounded-lg bg-white/60 border border-amber-300">
      <span className="text-purple-800 shrink-0">{icon}</span>
      <span className="font-serif text-amber-900 flex-1" style={{ fontSize: 'var(--font-sm)' }}>
        {label}
      </span>
      <span className="font-heading font-black text-purple-900" style={{ fontSize: 'var(--font-base)' }}>
        {value}
      </span>
    </div>
  );
}

/** Local-only player profile stats — no accounts, tracked per browser. */
export function StatsPanel({ onClose }: { onClose: () => void }) {
  const [stats, setStats] = useState<PlayerStats>(() => loadStats());
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm fade-in" onClick={onClose} />
      <div
        className="relative w-full max-w-md max-h-[86vh] overflow-y-auto rounded-2xl shadow-2xl slide-up"
        style={{
          background: 'linear-gradient(160deg, rgba(253,248,236,0.98) 0%, rgba(236,210,150,0.97) 100%)',
          border: '3px solid #d4af37',
          boxShadow: '0 0 0 6px rgba(90,48,24,0.55), 0 24px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div className="sticky top-0 bg-gradient-to-r from-purple-900 to-purple-800 px-5 py-3 flex items-center justify-between border-b-4 border-amber-500/60 rounded-t-xl">
          <h2 className="font-heading font-black text-amber-300 italic flex items-center gap-2" style={{ fontSize: 'var(--font-lg)' }}>
            <Trophy size="1em" /> Your Profile
          </h2>
          <button onClick={onClose} className="text-amber-200 hover:text-white" aria-label="Close stats">
            <X size="1.4rem" />
          </button>
        </div>

        <div className="p-5 space-y-2">
          <StatRow icon={<Gamepad2 size="1.2em" />} label="Games Played" value={stats.gamesPlayed} />
          <StatRow icon={<Trophy size="1.2em" />} label="Games Won" value={stats.gamesWon} />
          <StatRow icon={<Crown size="1.2em" />} label="Greater Dalmuti Finishes" value={stats.dalmutiFinishes} />
          <StatRow icon={<Users size="1.2em" />} label="Greater Peon Finishes" value={stats.peasantFinishes} />
          <StatRow
            icon={<Percent size="1.2em" />}
            label="Win Rate"
            value={stats.gamesPlayed > 0 ? `${Math.round(winRate(stats) * 100)}%` : '—'}
          />
          <StatRow icon={<Flame size="1.2em" />} label="Longest Win Streak" value={stats.longestStreak} />

          <p className="font-serif italic text-amber-800/80 pt-2" style={{ fontSize: 'var(--font-tiny)' }}>
            Tracked locally in this browser only — no account needed. One "game" is one completed hand.
          </p>

          {confirmReset ? (
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setConfirmReset(false)}
                className="flex-1 py-2 bg-stone-200 hover:bg-stone-300 text-stone-800 rounded-lg font-serif font-bold"
                style={{ fontSize: 'var(--font-sm)' }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setStats(resetStats());
                  setConfirmReset(false);
                }}
                className="flex-1 py-2 bg-red-800 hover:bg-red-700 text-red-50 rounded-lg font-serif font-bold"
                style={{ fontSize: 'var(--font-sm)' }}
              >
                Reset Stats
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmReset(true)}
              className={cn(
                'w-full mt-2 py-2 flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-red-400/60',
                'bg-red-50/60 hover:bg-red-100 text-red-800 font-serif font-bold'
              )}
              style={{ fontSize: 'var(--font-sm)' }}
            >
              <RotateCcw size="1em" /> Reset Stats
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
