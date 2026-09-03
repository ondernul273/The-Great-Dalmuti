/**
 * Card artwork registry
 * =====================
 *
 * Resolves a full-bleed PNG for every card slot (ranks 1–13 and the card back)
 * so the deck's look can be replaced without touching component code.
 *
 * SOURCES (checked in order):
 *
 *  1. CURRENT CARD SET — a named deck chosen by the lobby host.
 *  2. DEFAULT SET  —   "classic", always bundled, used as the final PNG fallback
 *                      before the procedural renderer.
 *  3. RUNTIME SET  —   `public/cards/manifest.json` alongside PNGs (no rebuild).
 *  4. PROCEDURAL  —    the code-drawn face, always available.
 *
 * ADDING A NEW DECK — zero code changes:
 *
 *   src/assets/cardsets/
 *     christmas/
 *       1-dalmuti.png
 *       2-archbishop.png
 *       ...
 *       13-jester.png
 *       back.png
 *
 * Vite auto-discovers the new folder at build time and the new deck shows up
 * in `availableCardSets()`. Missing slots fall back to "classic" then to the
 * procedural renderer — so a partial deck still works.
 *
 * The selected deck is stored in GameState.cardSet, so it travels with the
 * host's state broadcast. Every client renders from the same registry, keyed
 * by the set name.
 *
 * FILE NAMING — same as before:
 *   1-dalmuti.png  2-archbishop.png  …  12-peasant.png
 *   13-jester.png  (or jester.png / joker.png / wild.png)
 *   back.png       (or card-back.png)
 *
 * Only the leading number matters for ranks; `7-seamstress-v2.png` → rank 7.
 */

import { useSyncExternalStore } from 'react';

/** 1–13, or the shared card back. */
export type CardSlot = number | 'back';

type SlotMap = Partial<Record<string, string | undefined>>;

const ASSETS_ROOT = '../assets/cardsets/';
const RUNTIME_DIR = 'cards';
const RUNTIME_MANIFEST = `${import.meta.env.BASE_URL ?? '/'}${RUNTIME_DIR}/manifest.json`.replace(
  /\/{2,}/g,
  '/'
);

/* ------------------------------------------------------------------ */
/*  1. Bundled card sets (build-time discovery via Vite)               */
/* ------------------------------------------------------------------ */

/**
 * Every PNG under src/assets/cardsets/{set}/** is auto-discovered.
 * `import.meta.glob` returns `{ [path: string]: string }` where each value is
 * a Vite-resolved URL (inlined as a base64 data URL by vite-plugin-singlefile).
 */
const BUNDLED_PNGS = import.meta.glob('../assets/cardsets/**/*.png', {
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

/**
 * Parsed into `{ setName: { "1": url, "2": url, ..., "13": url, "back": url } }`.
 * Any set missing slots is still registered — gaps fall through at read time.
 */
const bundledSets: Record<string, SlotMap> = {};

for (const [path, url] of Object.entries(BUNDLED_PNGS)) {
  const relative = path.startsWith(ASSETS_ROOT) ? path.slice(ASSETS_ROOT.length) : path;
  const segments = relative.split('/');
  const file = segments.pop();
  if (!file) continue;
  const setName = segments[0];
  if (!setName) continue; // file at root of cardsets/ — ignore
  const slot = slotFromFilename(file);
  if (slot === null) continue;
  (bundledSets[setName] ??= {})[String(slot)] = url;
}

/** The canonical default deck. If a set named "classic" exists it is used;
 *  otherwise the first discovered set is picked at bundle time. */
export const DEFAULT_CARD_SET =
  'classic' in bundledSets ? 'classic' : Object.keys(bundledSets)[0] ?? 'classic';

/* ------------------------------------------------------------------ */
/*  2. Runtime assets (no rebuild — for deployed servers)              */
/* ------------------------------------------------------------------ */

interface RuntimeManifest {
  theme?: string;
  cards?: Record<string, string>;
  files?: string[];
}

let runtimeSlots: SlotMap = {};
let registryVersion = 0;
const listeners = new Set<() => void>();

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
    if (!res.ok) return;
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
    // Malformed or unreachable manifest — silently keep bundled/procedural art.
  }
}

if (typeof window !== 'undefined') void loadRuntimeManifest();

/* ------------------------------------------------------------------ */
/*  3. Active set selection                                            */
/* ------------------------------------------------------------------ */

let currentSetName = DEFAULT_CARD_SET;

/** Slots that failed to load and must not be retried. */
const brokenUrls = new Set<string>();

function lookupSlot(setName: string, slot: CardSlot): string | null {
  // 1. Selected set
  const selected = bundledSets[setName]?.[String(slot)];
  if (selected && !brokenUrls.has(selected)) return selected;

  // 2. Default ("classic") set — but skip if the caller explicitly picked it
  if (setName !== DEFAULT_CARD_SET) {
    const def = bundledSets[DEFAULT_CARD_SET]?.[String(slot)];
    if (def && !brokenUrls.has(def)) return def;
  }

  // 3. Runtime override (highest priority — replaces every bundled set)
  const rt = runtimeSlots[String(slot)];
  if (rt && !brokenUrls.has(rt)) return rt;

  return null;
}

/** Resolve the artwork URL for a slot, or `null` to use the procedural renderer. */
export function cardArtUrl(slot: CardSlot): string | null {
  return lookupSlot(currentSetName, slot);
}

/** Called by <Card> when an <img> fails, so we degrade instead of showing a gap. */
export function markArtBroken(url: string): void {
  if (brokenUrls.has(url)) return;
  brokenUrls.add(url);
  console.warn(`[CARDS] artwork failed to load, falling back to the built-in renderer: ${url}`);
  emit();
}

/* ------------------------------------------------------------------ */
/*  4. Public API — names, selection, subscription                     */
/* ------------------------------------------------------------------ */

export function availableCardSets(): string[] {
  const runtimeTheme = runtimeSlots && Object.keys(runtimeSlots).length > 0 ? '__runtime__' : null;
  const bundled = Object.keys(bundledSets).filter(Boolean);
  // Always expose DEFAULT_CARD_SET so the dropdown is never empty — even a
  // partial build with no PNGs still shows "Classic" and renders procedurally.
  if (!bundled.includes(DEFAULT_CARD_SET)) bundled.unshift(DEFAULT_CARD_SET);
  return bundled.concat(runtimeTheme ? [runtimeTheme] : []);
}

export function getCurrentCardSet(): string {
  return currentSetName;
}

export function setCurrentCardSet(name: string): boolean {
  if (name === currentSetName) return true;
  if (!bundledSets[name] && name !== '__runtime__') return false;
  currentSetName = name;
  emit();
  return true;
}

/** Human-readable label for a set name (used in dropdowns, logs). */
export function cardSetLabel(name: string): string {
  if (name === '__runtime__') return 'Runtime';
  if (name === 'classic') return 'Classic';
  return name
    .replace(/(^|[-_])([a-z])/g, (_1, _2, c) => c.toUpperCase())
    .replace(/[-_]/g, ' ');
}

export function subscribeToCardArt(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function cardArtVersion(): number {
  return registryVersion;
}

/**
 * React hook that re-renders when the registry invalidates (broken-art,
 * runtime manifest load). Combined with cardArtUrl(), gives <Card> live art.
 */
export function useCardArt(slot: CardSlot): string | null {
  useSyncExternalStore(subscribeToCardArt, cardArtVersion, cardArtVersion);
  return cardArtUrl(slot);
}

/* ------------------------------------------------------------------ */
/*  Debug / diagnostics                                                */
/* ------------------------------------------------------------------ */

export function describeCardArt(): Record<string, string> {
  const out: Record<string, string> = {};
  const slots: CardSlot[] = [...Array.from({ length: 13 }, (_, i) => i + 1), 'back'];
  for (const slot of slots) {
    const key = String(slot);
    if (runtimeSlots[key]) out[key] = 'runtime';
    else if (bundledSets[currentSetName]?.[key]) out[key] = `set:${currentSetName}`;
    else if (bundledSets[DEFAULT_CARD_SET]?.[key]) out[key] = `set:${DEFAULT_CARD_SET}`;
    else out[key] = 'procedural (no PNG)';
  }
  return out;
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__dalmutiCardArt = describeCardArt;
}
