# Card artwork — drop-in guide

Replace the deck's look by adding PNGs here. **No code changes are required.**
If a card has no PNG, the game automatically draws it with the built-in
renderer, so a partial set is always safe.

## 1. Default deck

Drop files directly in this folder:

```
src/assets/cards/
  1-dalmuti.png
  2-archbishop.png
  3-earl-marshal.png
  4-baroness.png
  5-abbess.png
  6-knight.png
  7-seamstress.png
  8-mason.png
  9-cook.png
  10-shepherdess.png
  11-stonecutter.png
  12-peasant.png
  13-jester.png
  back.png
```

Then rebuild (`npm run build`). Vite discovers the files automatically via
`import.meta.glob`, so there is nothing to import or register.

### Naming rules

| File | Resolves to |
| --- | --- |
| `7-seamstress.png`, `7.png`, `07-anything.png` | rank 7 |
| `13-jester.png`, `jester.png`, `joker.png`, `wild.png` | Jester (13) |
| `back.png`, `card-back.png` | card back |

Only the **leading number** matters for ranks — everything after it is free
text, so `7-seamstress-v2.png` still resolves to rank 7. Files that match no
rule (e.g. `faces.jpg`) are ignored.

## 2. Themes

A sub-folder is a theme:

```
src/assets/cards/
  1-dalmuti.png          <- theme "default"
  neon/
    1-dalmuti.png        <- theme "neon"
    back.png
```

Pick one at build time:

```bash
VITE_CARD_THEME=neon npm run build
```

…or at runtime in the browser console:

```js
localStorage.setItem('dalmuti.cardTheme', 'neon');
location.reload();
```

A theme only needs the cards it changes. Missing cards fall back to the default
theme, then to the built-in renderer.

## 3. Swapping art with no rebuild (runtime pack)

For changing artwork on an already-deployed server, put the PNGs in
`public/cards/` next to a `manifest.json`:

```
public/cards/
  manifest.json
  1-dalmuti.png
  back.png
```

```json
{
  "theme": "winter-court",
  "files": ["1-dalmuti.png", "back.png"]
}
```

Runtime art overrides bundled art. If `manifest.json` is absent the app makes
one harmless failed request and keeps using the bundled deck.

> Note: files in `public/` are **not** inlined by `vite-plugin-singlefile`, so
> this mode needs the `cards/` folder to be served alongside `index.html`.
> The bundled option (1 & 2) keeps the single-file build fully self-contained.

## 4. Recommended image dimensions

| Property | Recommendation |
| --- | --- |
| Aspect ratio | **5 : 7** (0.714) — matches the layout exactly |
| Size | **500 × 700 px** |
| High-DPI option | 750 × 1050 px |
| Format | PNG-24, or PNG-8 when the art allows |
| Safe margin | keep detail ≥ 4 % from the edge (corners are rounded/clipped) |
| Budget | ≤ 120 KB per card |

The largest on-screen card is ~252 × 353 CSS px, so 500 × 700 covers 2× retina.
Art is drawn with `object-fit: cover`, so any 5:7 image fills the card without
distortion; other ratios are centre-cropped.

**Why the size budget matters:** bundled PNGs are base64-inlined into
`dist/index.html` (+33 % overhead). Fourteen 120 KB cards add roughly 2.2 MB to
the download. If you need larger art, use the runtime pack in section 3.

## 5. Verifying

In the browser console:

```js
__dalmutiCardArt()
// { "1": "bundled:default", "2": "procedural (no PNG)", …, "back": "runtime" }
```

Broken or missing files are logged as `[CARDS] artwork failed to load…` and the
affected card silently reverts to the built-in renderer.
