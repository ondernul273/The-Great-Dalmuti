import type { Card as CardType } from '../game/types';
import { CARD_INFO } from '../game/cards';
import { cn } from '../utils/cn';
import {
  markArtBroken,
  useCardArt,
} from './cardAssets';
import facesSheet from '../assets/cards/faces.jpg';
import extrasSheet from '../assets/cards/extras.jpg';

export interface CardProps {
  card?: CardType;
  faceDown?: boolean;
  selected?: boolean;
  dimmed?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

interface Art {
  image: string;
  posX: string;
  posY: string;
  sizeX: string;
  sizeY: string;
}

/* ------------------------------------------------------------------ */
/*  Procedural fallback art (sprite sheets) — used when no PNG exists  */
/* ------------------------------------------------------------------ */

export const CARD_BACK_ART: Art = {
  image: extrasSheet,
  posX: '100%',
  posY: '50%',
  sizeX: '200%',
  sizeY: '100%',
};

const JESTER_ART: Art = {
  image: extrasSheet,
  posX: '0%',
  posY: '50%',
  sizeX: '200%',
  sizeY: '100%',
};

function artFor(rank: number): Art {
  if (rank === 13) return JESTER_ART;
  const idx = rank - 1; // 0..11
  const col = idx % 4;
  const row = Math.floor(idx / 4);
  return {
    image: facesSheet,
    posX: `${(col * 100) / 3}%`,
    posY: `${row * 50}%`,
    sizeX: '400%',
    sizeY: '300%',
  };
}

const SIZE_VARS = {
  xs: { w: 'var(--card-w-xs)', h: 'var(--card-h-xs)', corner: 'var(--font-tiny)', title: 'var(--font-tiny)', plate: 'var(--font-tiny)' },
  sm: { w: 'var(--card-w-sm)', h: 'var(--card-h-sm)', corner: 'var(--font-xs)', title: 'var(--font-tiny)', plate: 'var(--font-tiny)' },
  lg: { w: 'var(--card-w-lg)', h: 'var(--card-h-lg)', corner: 'var(--font-sm)', title: 'var(--font-xs)', plate: 'var(--font-xs)' },
  md: { w: 'var(--card-w)', h: 'var(--card-h)', corner: 'var(--font-xs)', title: 'var(--font-tiny)', plate: 'var(--font-tiny)' },
} as const;

/* ------------------------------------------------------------------ */
/*  Card back                                                          */
/* ------------------------------------------------------------------ */

export function CardBackFace({
  size = 'md',
  className,
}: {
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const s = SIZE_VARS[size];
  const png = useCardArt('back');

  return (
    <div
      className={cn('rounded-md border border-stone-400/70 shadow-md overflow-hidden shrink-0', className)}
      style={{
        width: s.w,
        height: s.h,
        ...(png
          ? {}
          : {
              backgroundImage: `url(${CARD_BACK_ART.image})`,
              backgroundSize: `${CARD_BACK_ART.sizeX} ${CARD_BACK_ART.sizeY}`,
              backgroundPosition: `${CARD_BACK_ART.posX} ${CARD_BACK_ART.posY}`,
              backgroundRepeat: 'no-repeat',
            }),
      }}
    >
      {png && (
        <img
          src={png}
          alt=""
          draggable={false}
          onError={() => markArtBroken(png)}
          className="w-full h-full object-cover select-none pointer-events-none"
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Card face                                                          */
/* ------------------------------------------------------------------ */

export function Card({ card, faceDown, selected, dimmed, size = 'md', onClick, className, style }: CardProps) {
  const s = SIZE_VARS[size];
  // Hooks must run unconditionally, so resolve art before any early return.
  const png = useCardArt(card ? card.rank : 'back');

  if (faceDown || !card) {
    return <CardBackFace size={size} className={className} />;
  }

  const info = CARD_INFO[card.rank];
  const isJester = card.rank === 13;
  const label = isJester ? 'Jester' : info.name;
  const cornerLabel = isJester ? 'J' : String(card.rank);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={`${label} (${isJester ? 'Wild' : card.rank})`}
      className={cn(
        'relative rounded-md border shadow-md transition-all duration-150 select-none overflow-hidden border-stone-400/80',
        // Selected cards lift straight up and glow, but deliberately keep their
        // original stacking order (no z-index) so they never slide in front of a
        // neighbouring card and steal its click area.
        selected && '-translate-y-7 ring-[3px] ring-amber-300 shadow-[0_0_20px_4px_rgba(252,211,77,0.55)]',
        dimmed && 'opacity-45 saturate-50',
        onClick && !selected && 'hover:-translate-y-1.5 hover:shadow-xl cursor-pointer',
        !onClick && 'cursor-default',
        className
      )}
      style={{
        width: s.w,
        height: s.h,
        ...(png
          ? { padding: 0, background: '#1c1206' }
          : {
              background: 'linear-gradient(160deg,#f7eed8 0%,#f1e5c6 55%,#e7d7ae 100%)',
              padding: '4px',
              display: 'flex',
              flexDirection: 'column',
            }),
        ...style,
      }}
    >
      {png ? (
        <img
          src={png}
          alt={label}
          draggable={false}
          onError={() => markArtBroken(png)}
          className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none"
        />
      ) : (
        <ProceduralCardFace
          rank={card.rank}
          label={label}
          cornerLabel={cornerLabel}
          corner={s.corner}
          title={s.title}
          plate={s.plate}
        />
      )}
    </button>
  );
}

/**
 * The original code-drawn card face. Kept as the guaranteed fallback so the
 * game stays fully playable with zero PNGs installed.
 */
function ProceduralCardFace({
  rank,
  label,
  cornerLabel,
  corner,
  title,
  plate,
}: {
  rank: number;
  label: string;
  cornerLabel: string;
  corner: string;
  title: string;
  plate: string;
}) {
  const art = artFor(rank);
  return (
    <>
      {/* fine inner frame, like the printed card stock */}
      <div className="pointer-events-none absolute inset-[2px] rounded-[4px] border border-[#a5885a]/70" />

      {/* Top row: rank • italic title • rank */}
      <div className="flex items-center gap-[2px] leading-none shrink-0 px-[1px]">
        <span className="font-black shrink-0" style={{ fontSize: corner, color: '#40290f' }}>
          {cornerLabel}
        </span>
        <span
          className="flex-1 text-center font-serif italic font-bold truncate"
          style={{ fontSize: title, color: '#7b2d26' }}
        >
          {label}
        </span>
        <span className="font-black shrink-0" style={{ fontSize: corner, color: '#40290f' }}>
          {cornerLabel}
        </span>
      </div>

      {/* Illustration — dominates the card, thin dark frame */}
      <div
        className="relative w-full flex-1 my-[3px] rounded-[2px] overflow-hidden"
        style={{
          border: '1px solid #6b5636',
          backgroundImage: `url(${art.image})`,
          backgroundSize: `${art.sizeX} ${art.sizeY}`,
          backgroundPosition: `${art.posX} ${art.posY}`,
          backgroundRepeat: 'no-repeat',
          boxShadow: 'inset 0 0 0 1px rgba(255,250,230,0.35), inset 0 0 14px rgba(60,35,10,0.25)',
        }}
      />

      {/* Bottom row: rank • small-caps name plate • rank */}
      <div className="flex items-center gap-[2px] leading-none shrink-0 px-[1px]">
        <span className="font-black shrink-0" style={{ fontSize: corner, color: '#40290f' }}>
          {cornerLabel}
        </span>
        <span
          className="flex-1 text-center font-serif font-bold truncate"
          style={{
            fontSize: plate,
            color: '#4a3418',
            letterSpacing: '0.09em',
            background: 'rgba(120,90,40,0.12)',
            borderTop: '1px solid rgba(120,90,40,0.5)',
            borderBottom: '1px solid rgba(120,90,40,0.5)',
            padding: '1px 0',
          }}
        >
          {label.toUpperCase()}
        </span>
        <span className="font-black shrink-0" style={{ fontSize: corner, color: '#40290f' }}>
          {cornerLabel}
        </span>
      </div>
    </>
  );
}
