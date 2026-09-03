/**
 * Card artwork registry
 * =====================
 *
 * Resolves a full-bleed PNG for every card slot (ranks 1–13 and the card back)
 * so the deck's look can be replaced without touching component code.
 *
 * There are two independent sources, checked in this order:
 *
 *  1. RUNTIME  —  `public/cards/manifest.json` (+ the PNGs beside it)
 *     Swappable on a deployed server with NO rebuild. Optional: if the
 *     manifest is absent the single failed request is ignored forever.
 *
 *  2. BUNDLED  —  `src/assets/cards/**\/*.png`
 *     Auto-discovered at build time via `import.meta.glob`, so dropping a new
 *     PNG into the folder is enough — no import statements to edit. These are
 *     inlined by `vite-plugin-singlefile`, keeping the offline build intact.
 *
 * If neither source has art for a slot, `Card.tsx` falls back to the existing
 * procedural renderer, so the game always works.
 *
 * FILE NAMING (either source)
 * ---------------------------
 *   1-dalmuti.png  2-archbishop.png  …  12-peasant.png
 *   13-jester.png  (or jester.png / joker.png / wild.png)
 *   back.png       (or card-back.png)
 *
 * Only the leading number matters for ranks; the rest of the name is free text,
 * so `7-seamstress-v2.png` also resolves to rank 7.
 *
 * THEMES
 * ------
 * A sub-folder becomes a theme:
 *   src/assets/cards/1-dalmuti.png          -> theme "default"
 *   src/assets/cards/neon/1-dalmuti.png     -> theme "neon"
 *
 * Select one with `VITE_CARD_THEME=neon` at build time, or at runtime with
 * `localStorage.setItem('dalmuti.cardTheme', 'neon')`. Missing cards in a theme
 * fall back to the default theme, then to the procedural renderer — so a theme
 * may override just a few cards.
 */

/** 1–13, or the shared card back. */
export type CardSlot = number | 'back';

type SlotMap = Partial<Record<string, string>>;

export const DEFAULT_THEME = 'default';
const ASSET_ROOT = '../assets/cards/';
const RUNTIME_DIR = 'cards';
const RUNTIME_MANIFEST = `${import.meta.env.BASE_URL ?? '/'}${RUNTIME_DIR}/manifest.json`.replace(
  /\/{2,}/g,
  '/'
);

/* ------------------------------------------------------------------ */
/*  1. Bundled assets (build-time discovery)                           */
/* ------------------------------------------------------------------ */

const BUNDLED_PNGS = import.meta.glob('../assets/cards/**/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

/** Map a bare filename onto a card slot, or null when it isn't card art. */
export function slotFromFilename(file: string): CardSlot | null {
  const base = file
    .replace(/\.[a-z0-9]+$/i, '')
    .trim()
    .toLowerCase();

  const leadingNumber = /^(\d{1,2})(?:\D|$)/.exec(base);
  if (leadingNumber) {
    const rank = Number(leadingNumber[1]);
    if (rank >= 1 && rank <= 13) return rank;
  }
  if (/(^|[-_ ])back([-_ ]|$)/.test(base)) return 'back';
  if (/(^|[-_ ])(jester|joker|wild)([-_ ]|$)/.test(base)) return 13;
  return null;
}

const bundledThemes: Record<string, SlotMap> = {};

for (const [path, url] of Object.entries(BUNDLED_PNGS)) {
  const relative = path.startsWith(ASSET_ROOT) ? path.slice(ASSET_ROOT.length) : path;
  const segments = relative.split('/');
  const file = segments.pop();
  if (!file) continue;
  const theme = segments.length > 0 ? segments.join('/') : DEFAULT_THEME;
  const slot = slotFromFilename(file);
  if (slot === null) continue;
  (bundledThemes[theme] ??= {})[String(slot)] = url;
}

/* ------------------------------------------------------------------ */
/*  2. Runtime assets (optional, no rebuild required)                  */
/* ------------------------------------------------------------------ */

interface RuntimeManifest {
  /** Optional label, purely informational. */
  theme?: string;
  /**
   * Either an explicit slot -> filename map:
   *   { "cards": { "1": "1-dalmuti.png", "back": "back.png" } }
   * or a plain list of filenames, parsed with the same naming rules:
   *   { "files": ["1-dalmuti.png", "back.png"] }
   */
  cards?: Record<string, string>;
  files?: string[];
}

let runtimeSlots: SlotMap = {};
const listeners = new Set<() => void>();
/** Bumped whenever the runtime manifest changes, to invalidate memoised reads. */
let registryVersion = 0;

function emit() {
  registryVersion += 1;
  for (const listener of listeners) listener();
}

function resolveRuntimeUrl(file: string): string {
  if (/^(https?:)?\/\//i.test(file) || file.startsWith('data:')) return file;
  const base = `${import.meta.env.BASE_URL ?? '/'}${RUNTIME_DIR}/`;
  return `${base}${file}`.replace(/([^:]\/)\/+/g, '$1');
}

let runtimeLoaded = false;

async function loadRuntimeManifest(): Promise<void> {
  if (runtimeLoaded) return;
  runtimeLoaded = true;
  try {
    const res = await fetch(RUNTIME_MANIFEST, { cache: 'no-cache' });
    if (!res.ok) return; // no runtime pack installed — perfectly normal
    const manifest = (await res.json()) as RuntimeManifest;
    const next: SlotMap = {};

    if (manifest.cards) {
      for (const [key, file] of Object.entries(manifest.cards)) {
        const slot =
          key.toLowerCase() === 'back'
            ? ('back' as CardSlot)
            : Number.isFinite(Number(key))
            ? Number(key)
            : slotFromFilename(key);
        if (slot === null || slot === undefined) continue;
        if (typeof slot === 'number' && (slot < 1 || slot > 13)) continue;
        next[String(slot)] = resolveRuntimeUrl(file);
      }
    }
    if (manifest.files) {
      for (const file of manifest.files) {
        const slot = slotFromFilename(file.split('/').pop() ?? file);
        if (slot === null) continue;
        next[String(slot)] = resolveRuntimeUrl(file);
      }
    }

    if (Object.keys(next).length > 0) {
      runtimeSlots = next;
      console.log(
        `[CARDS] runtime artwork loaded (${Object.keys(next).length} slots)` +
          (manifest.theme ? ` — theme "${manifest.theme}"` : '')
      );
      emit();
    }
  } catch {
    // Malformed or unreachable manifest: silently keep bundled/procedural art.
  }
}

// Kick off the probe once, in the browser only.
if (typeof window !== 'undefined') void loadRuntimeManifest();

/* ------------------------------------------------------------------ */
/*  Theme selection                                                    */
/* ------------------------------------------------------------------ */

function activeTheme(): string {
  try {
    const stored = localStorage.getItem('dalmuti.cardTheme');
    if (stored && stored.trim()) return stored.trim();
  } catch {
    /* storage unavailable */
  }
  const fromEnv = (import.meta.env as Record<string, string | undefined>).VITE_CARD_THEME;
  return fromEnv?.trim() || DEFAULT_THEME;
}

/** Slots that were broken at runtime (404 / decode error) and must not retry. */
const brokenUrls = new Set<string>();

/**
 * Resolve the artwork URL for a slot, or `null` to use the procedural renderer.
 * Priority: runtime manifest → active theme → default theme.
 */
export function cardArtUrl(slot: CardSlot): string | null {
  const key = String(slot);

  const candidates = [
    runtimeSlots[key],
    bundledThemes[activeTheme()]?.[key],
    bundledThemes[DEFAULT_THEME]?.[key],
  ];

  for (const url of candidates) {
    if (url && !brokenUrls.has(url)) return url;
  }
  return null;
}

/** Called by `Card` when an <img> fails, so we degrade instead of showing a gap. */
export function markArtBroken(url: string): void {
  if (brokenUrls.has(url)) return;
  brokenUrls.add(url);
  console.warn(`[CARDS] artwork failed to load, falling back to the built-in renderer: ${url}`);
  emit();
}

/* ------------------------------------------------------------------ */
/*  React glue                                                         */
/* ------------------------------------------------------------------ */

export function subscribeToCardArt(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function cardArtVersion(): number {
  return registryVersion;
}

/** Debug helper: which slots currently have artwork, and from where. */
export function describeCardArt(): Record<string, string> {
  const out: Record<string, string> = {};
  const slots: CardSlot[] = [...Array.from({ length: 13 }, (_, i) => i + 1), 'back'];
  for (const slot of slots) {
    const key = String(slot);
    if (runtimeSlots[key]) out[key] = 'runtime';
    else if (bundledThemes[activeTheme()]?.[key]) out[key] = `theme:${activeTheme()}`;
    else if (bundledThemes[DEFAULT_THEME]?.[key]) out[key] = 'bundled:default';
    else out[key] = 'procedural (no PNG)';
  }
  return out;
}

/** Theme names discovered in the bundle. */
export function availableThemes(): string[] {
  return Object.keys(bundledThemes);
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__dalmutiCardArt = describeCardArt;
}
