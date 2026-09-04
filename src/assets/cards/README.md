# Card artwork — drop-in guide

The deck's look can be replaced **without touching any code**, and the choice is
synced to everyone at the table via the in-game **Card Set** picker.

## The sets you can choose from

| Set | Where it comes from | Notes |
| --- | --- | --- |
| **Default** | Built into the game | Always available. Uses the built-in renderer + bundled sprite artwork. Needs no files. |
| Bundled custom sets | Sub-folders of this directory | One folder per set, e.g. `neon/`, `christmas/`. Discovered at build time. |
| Runtime pack | `public/cards/manifest.json` | Optional. Swappable on a deployed server with **no rebuild**. |

Loose PNGs placed directly in this folder root are **ignored on purpose** so the
Default set can never be silently replaced.

## Adding a bundled custom set

Create a sub-folder and drop PNGs in it — nothing else to do:

```
src/assets/cards/
  neon/
    1-dalmuti.png
    2-archbishop.png
    …
    13-jester.png
    back.png
```

Then rebuild (`npm run build`). The set appears in the picker automatically.

### File naming

| File | Resolves to |
| --- | --- |
| `7-seamstress.png`, `7.png`, `07-anything.png` | rank 7 |
| `13-jester.png`, `jester.png`, `joker.png`, `wild.png` | Jester (13) |
| `back.png`, `card-back.png` | card back |

Only the **leading number** matters; the rest of the name is free text.

### Incomplete sets are fine

A set only needs the cards it changes. Any missing slot falls back to the
Default renderer for that card, and the picker shows a `n/14 cards — gaps fall
back` badge so players know what to expect.

## Runtime pack (no rebuild)

Put PNGs in `public/cards/` next to a `manifest.json`:

```json
{
  "theme": "winter-court",
  "files": ["1-dalmuti.png", "back.png"]
}
```

or an explicit map: `{ "cards": { "1": "1-dalmuti.png", "back": "back.png" } }`.
If the manifest is missing, the app simply keeps using bundled art.

> `public/` files are **not** inlined by `vite-plugin-singlefile`, so this mode
> needs the `cards/` folder served alongside `index.html`. Bundled sets keep the
> single-file build fully self-contained.

## Recommended image dimensions

| Property | Recommendation |
| --- | --- |
| Aspect ratio | **5 : 7** (0.714) — matches the card box exactly |
| Size | **500 × 700 px** (750 × 1050 for high-DPI) |
| Format | PNG-24, or PNG-8 when the art allows |
| Safe margin | keep detail ≥ 4 % from the edge (corners are rounded/clipped) |
| Budget | ≤ 120 KB per card |

The largest on-screen card is ~252 × 353 CSS px, so 500 × 700 covers 2× retina.
Art is drawn with `object-fit: cover`; other ratios are centre-cropped.
Bundled PNGs are base64-inlined (+33 %), so large sets bloat `index.html` —
prefer the runtime pack for heavy artwork.

## Selection, persistence & sync

* The picker (main menu → **Card Set**) lists **Default** first, then every
  discovered set, each with a live five-card preview.
* The choice is remembered per browser (`localStorage['dalmuti.cardTheme']`).
* While online, the choice is stamped into the game state by the host and
  broadcast, so **every player sees the same deck**.
* `VITE_CARD_THEME=<set-id>` preselects a set at build time.

## Verifying

In the browser console:

```js
__dalmutiCardArt()
// { "1": "set:neon", …, "back": "procedural (Default renderer)" }
```

Broken or missing files log `[CARDS] artwork failed to load…` and the affected
card silently reverts to the built-in renderer.
