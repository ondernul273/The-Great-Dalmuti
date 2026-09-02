import { useMemo } from 'react';
import type { CSSProperties } from 'react';

interface Burst {
  left: number;
  top: number;
  delay: number;
  color: string;
  particles: { dx: number; dy: number; d: number }[];
}

/**
 * Pure-CSS fireworks. `big` = full multicolour salvo (1st place),
 * small = a modest golden sparkle (2nd place).
 */
export function Fireworks({ big = true }: { big?: boolean }) {
  const bursts = useMemo<Burst[]>(() => {
    const count = big ? 6 : 3;
    const palette = big
      ? ['#ffd700', '#ff6b6b', '#7bd7ff', '#c084fc', '#86efac', '#fda4af']
      : ['#ffd700', '#fde68a', '#fbbf24'];
    const per = big ? 16 : 10;
    return Array.from({ length: count }, (_, b) => ({
      left: 12 + ((b * 37 + (big ? 5 : 20)) % 76),
      top: 10 + ((b * 23 + (big ? 8 : 18)) % 52),
      delay: (b * 0.42) % 1.8,
      color: palette[b % palette.length],
      particles: Array.from({ length: per }, (_, i) => {
        const ang = (i / per) * Math.PI * 2 + b * 0.35;
        const dist = (big ? 95 : 55) + (i % 4) * 16;
        return {
          dx: Math.cos(ang) * dist,
          dy: Math.sin(ang) * dist,
          d: (i % 5) * 0.02,
        };
      }),
    }));
  }, [big]);

  return (
    <div className="pointer-events-none fixed inset-0 z-[80] overflow-hidden" aria-hidden>
      {bursts.map((b, bi) => (
        <div key={bi} className="absolute" style={{ left: `${b.left}%`, top: `${b.top}%` }}>
          <span
            className="fw-flash"
            style={{ animationDelay: `${b.delay}s`, background: b.color }}
          />
          {b.particles.map((p, pi) => (
            <span
              key={pi}
              className="fw-particle"
              style={
                {
                  background: b.color,
                  boxShadow: `0 0 10px ${b.color}`,
                  animationDelay: `${b.delay + p.d}s`,
                  '--dx': `${p.dx}px`,
                  '--dy': `${p.dy}px`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      ))}
    </div>
  );
}
