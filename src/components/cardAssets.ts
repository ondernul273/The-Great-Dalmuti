/**
 * Card artwork registry
 * =====================
 *
 * Resolves a full-bleed PNG for every card slot (ranks 1–13 and the card back)
 * so the deck's look can be replaced without touching component code.
 *
 * Card SETS
 * ---------
 *  • "Default" is always available and always means the built-in procedural
 *    renderer + the bundled sprite artwork. It needs no files at all.
 *  • Every sub-folder of `src/assets/cards/` is a bundled custom set,
 *    auto-discovered at build time via `import.meta.glob` (dropping a folder in
 *    is enough — nothing to import; singlefile inlines it).
 *  • `public/cards/manifest.json` (+ PNGs beside it) is an optional RUNTIME
 *    set, swappable on a deployed server with no rebuild. If the manifest is
 *    absent the single failed request is ignored forever.
 *  • Loose PNGs in the folder ROOT are ignored on purpose, so the Default set
 *    can never be silently replaced.
 *
 * A set only needs the cards it changes: any slot a custom set doesn't ship
 * falls back to the Default renderer for that card, so partial sets are safe.
 *
 * FILE NAMING (custom sets & runtime packs)
 * -----------------------------------------
 *   1-dalmuti.png  2-archbishop.png  …  12-peasant.png
 *   13-jester.png  (or jester.png / joker.png / wild.png)
 *   back.png       (or card-back.png)
 *
 * Only the leading number matters for ranks; the rest of the name is free text,
 * so `7-seamstress-v2.png` also resolves to rank 7.
 *
 * SELECTION & SYNC
 * ----------------
 * The in-game "Card Set" picker lists Default first, then every discovered set.
 * The choice is persisted locally, stamped into GameState (`cardSet`) by the
 * host, and therefore reaches every player at the table. `VITE_CARD_THEME` or
 * `localStorage['dalmuti.cardTheme']` preselect a set before anyone picks.
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
  // Loose PNGs in the folder root are ignored on purpose: the "Default" set is
  // always the built-in renderer + bundled sprite artwork. Custom sets live in
  // sub-folders, one folder per set.
  if (segments.length === 0) continue;
  const theme = segments.join('/');
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
/** Display label of the installed runtime pack, or null when none is installed. */
let runtimeSetName: string | null = null;
export const RUNTIME_SET_ID = 'runtime';
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
      runtimeSetName = manifest.theme?.trim() || 'Installed Pack';
      console.log(
        `[CARDS] runtime artwork loaded (${Object.keys(next).length} slots)` +
          (manifest.theme ? ` — set "${runtimeSetName}"` : '')
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

export interface CardSetInfo {
  id: string;
  label: string;
  /** how many of the 14 slots (13 ranks + back) this set provides */
  coverage: number;
}

function prettify(id: string): string {
  return id
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Session-wide override, set by the table (synced) or the local picker. */
let themeOverride: string | null = null;

function storedSet(): string | null {
  try {
    const stored = localStorage.getItem('dalmuti.cardTheme');
    if (stored && stored.trim()) return stored.trim();
  } catch {
    /* storage unavailable */
  }
  const fromEnv = (import.meta.env as Record<string, string | undefined>).VITE_CARD_THEME;
  return fromEnv?.trim() || null;
}

/** The card set currently in use. Always resolvable — unknown ids fall back to Default. */
export function getActiveSet(): string {
  const wanted = themeOverride ?? storedSet();
  if (!wanted) return DEFAULT_THEME;
  if (wanted === DEFAULT_THEME || wanted === RUNTIME_SET_ID) return wanted;
  return bundledThemes[wanted] ? wanted : DEFAULT_THEME;
}

/** Apply a set for this session (does not touch storage — the caller decides). */
export function setThemeOverride(id: string | null): void {
  const next = id && id.trim() ? id.trim() : null;
  if (next === themeOverride) return;
  themeOverride = next;
  console.log(`[CARDS] card set → ${getActiveSet()}`);
  emit();
}

/** Persist the local preference (used when this client originates the choice). */
export function rememberSet(id: string): void {
  try {
    localStorage.setItem('dalmuti.cardTheme', id);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Every selectable set: Default first, then bundled folders, then an
 * installed runtime pack. Default is always present, even with zero custom
 * sets installed.
 */
export function listCardSets(): CardSetInfo[] {
  const coverage = (slots: SlotMap | null) => {
    if (!slots) return 0;
    let n = 0;
    for (let r = 1; r <= 13; r++) if (slots[String(r)]) n++;
    if (slots.back) n++;
    return n;
  };
  const sets: CardSetInfo[] = [
    { id: DEFAULT_THEME, label: 'Default', coverage: 0 },
    ...Object.keys(bundledThemes)
      .sort()
      .map((id) => ({ id, label: prettify(id), coverage: coverage(bundledThemes[id]) })),
  ];
  if (runtimeSetName) {
    sets.push({ id: RUNTIME_SET_ID, label: runtimeSetName, coverage: coverage(runtimeSlots) });
  }
  return sets;
}

/** Artwork for one slot of one specific set — used by the picker's previews. */
export function cardArtUrlFor(set: string, slot: CardSlot): string | null {
  const key = String(slot);
  let url: string | undefined;
  if (set === RUNTIME_SET_ID) url = runtimeSlots[key];
  else if (set !== DEFAULT_THEME) url = bundledThemes[set]?.[key];
  return url && !brokenUrls.has(url) ? url : null;
}

/** Slots that were broken at runtime (404 / decode error) and must not retry. */
const brokenUrls = new Set<string>();

/**
 * Resolve the artwork URL for a slot of the ACTIVE set, or `null` to use the
 * procedural renderer (Default set, or any slot a custom set doesn't ship).
 */
export function cardArtUrl(slot: CardSlot): string | null {
  return cardArtUrlFor(getActiveSet(), slot);
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
  const active = getActiveSet();
  const slots: CardSlot[] = [...Array.from({ length: 13 }, (_, i) => i + 1), 'back'];
  for (const slot of slots) {
    const key = String(slot);
    if (active === RUNTIME_SET_ID && runtimeSlots[key]) out[key] = `set:${RUNTIME_SET_ID}`;
    else if (active !== DEFAULT_THEME && bundledThemes[active]?.[key]) out[key] = `set:${active}`;
    else out[key] = 'procedural (Default renderer)';
  }
  return out;
}

/** Set ids discovered in the bundle (excluding Default). */
export function availableThemes(): string[] {
  return Object.keys(bundledThemes);
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__dalmutiCardArt = describeCardArt;
}
