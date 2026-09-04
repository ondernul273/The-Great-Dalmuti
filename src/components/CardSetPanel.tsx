import { useSyncExternalStore } from 'react';
import {
  cardArtUrlFor,
  cardArtVersion,
  listCardSets,
  subscribeToCardArt,
  DEFAULT_THEME,
  type CardSlot,
} from './cardAssets';
import { CARD_INFO } from '../game/cards';
import type { Rank } from '../game/types';
import { cn } from '../utils/cn';
import { Layers, Check, X, CircleAlert } from 'lucide-react';

const PREVIEW_SLOTS: CardSlot[] = [1, 6, 12, 13, 'back'];

/** Tiny face used in set previews; falls back to a parchment chip when the set
 *  ships no PNG for that slot (exactly what the table would render). */
function PreviewChip({ set, slot }: { set: string; slot: CardSlot }) {
  const url = cardArtUrlFor(set, slot);
  if (url) {
    return (
      <img
        src={url}
        alt=""
        draggable={false}
        className="h-[4.6rem] w-[3.3rem] rounded-[4px] border border-stone-500/70 object-cover shadow"
      />
    );
  }
  const rank = slot === 'back' ? null : (slot as Rank);
  return (
    <div
      className="flex h-[4.6rem] w-[3.3rem] flex-col items-center justify-between rounded-[4px] border border-stone-500/70 px-1 py-1 shadow"
      style={{ background: 'linear-gradient(160deg,#f7eed8 0%,#f1e5c6 55%,#e7d7ae 100%)' }}
    >
      {rank === null ? (
        <span className="font-heading font-black text-purple-800 text-[0.55rem] leading-tight text-center">
          THE GREAT DALMUTI
        </span>
      ) : (
        <>
          <span className="self-start font-black text-stone-800 text-xs leading-none">{rank}</span>
          <span className="font-serif italic font-bold text-[0.5rem] text-center leading-tight text-[#7b2d26]">
            {CARD_INFO[rank].name}
          </span>
          <span className="self-end font-black text-stone-800 text-xs leading-none rotate-180">{rank}</span>
        </>
      )}
    </div>
  );
}

/**
 * Card set picker. "Default" (the built-in renderer + bundled artwork) is always
 * listed first; every discovered custom set follows. The choice is synced to
 * the whole table by the caller.
 */
export function CardSetPanel({
  current,
  onSelect,
  onClose,
}: {
  current: string;
  onSelect: (set: string) => void;
  onClose: () => void;
}) {
  // Live list: re-reads when a runtime pack arrives or the registry changes.
  useSyncExternalStore(subscribeToCardArt, cardArtVersion, cardArtVersion);
  const sets = listCardSets();

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm fade-in" onClick={onClose} />
      <div
        className="relative w-full max-w-lg max-h-[86vh] overflow-y-auto rounded-2xl shadow-2xl slide-up"
        style={{
          background: 'linear-gradient(160deg, rgba(253,248,236,0.98) 0%, rgba(236,210,150,0.97) 100%)',
          border: '3px solid #d4af37',
          boxShadow: '0 0 0 6px rgba(90,48,24,0.55), 0 24px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div className="sticky top-0 z-10 bg-gradient-to-r from-purple-900 to-purple-800 px-5 py-3 flex items-center justify-between border-b-4 border-amber-500/60 rounded-t-xl">
          <h2 className="font-heading font-black text-amber-300 italic flex items-center gap-2" style={{ fontSize: 'var(--font-lg)' }}>
            <Layers size="1em" /> Card Set
          </h2>
          <button onClick={onClose} className="text-amber-200 hover:text-white" aria-label="Close card set picker">
            <X size="1.4rem" />
          </button>
        </div>

        <div className="p-4 space-y-2.5">
          {sets.map((set) => {
            const active = set.id === current;
            const incomplete = set.id !== DEFAULT_THEME && set.coverage < 14;
            return (
              <button
                key={set.id}
                onClick={() => onSelect(set.id)}
                className={cn(
                  'w-full text-left p-3 rounded-xl border-2 transition-all flex items-center gap-3',
                  active
                    ? 'bg-amber-400/25 border-amber-500 shadow-[0_0_0_3px_rgba(212,175,55,0.25)]'
                    : 'bg-white/60 border-amber-300/70 hover:border-amber-500 hover:bg-white/85'
                )}
              >
                <span
                  className={cn(
                    'shrink-0 grid place-items-center h-6 w-6 rounded-full border-2',
                    active ? 'border-amber-600 bg-amber-500 text-purple-950' : 'border-stone-400 bg-white text-transparent'
                  )}
                  aria-hidden
                >
                  <Check size="0.9rem" />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="font-heading font-black text-purple-900" style={{ fontSize: 'var(--font-base)' }}>
                      {set.label}
                    </span>
                    {set.id === DEFAULT_THEME && (
                      <span className="px-1.5 py-0.5 rounded-full bg-purple-900/10 border border-purple-900/25 text-purple-900 font-serif" style={{ fontSize: 'var(--font-tiny)' }}>
                        built-in artwork
                      </span>
                    )}
                    {incomplete && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-600/15 border border-amber-700/40 text-amber-900 font-serif" style={{ fontSize: 'var(--font-tiny)' }}>
                        <CircleAlert size="1em" /> {set.coverage}/14 cards — gaps fall back
                      </span>
                    )}
                  </span>
                  <span className="block font-serif italic text-amber-800/85 mt-0.5" style={{ fontSize: 'var(--font-tiny)' }}>
                    {set.id === DEFAULT_THEME
                      ? 'The original hand-drawn court, rendered by the game itself.'
                      : `Installed set “${set.id}” — drop PNGs in its folder to extend it.`}
                  </span>
                </span>

                <span className="flex gap-1 shrink-0">
                  {PREVIEW_SLOTS.map((slot) => (
                    <PreviewChip key={String(slot)} set={set.id} slot={slot} />
                  ))}
                </span>
              </button>
            );
          })}

          <p className="font-serif italic text-amber-800/85 pt-1" style={{ fontSize: 'var(--font-tiny)' }}>
            Your choice is remembered on this device and synced to everyone at the table when a
            game starts or while one is running.
          </p>
        </div>
      </div>
    </div>
  );
}
