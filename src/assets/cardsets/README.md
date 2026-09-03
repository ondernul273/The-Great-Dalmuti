# Card sets — drop-in deck library

Every sub-folder here becomes a selectable card set in the lobby dropdown.
No code changes required when adding a new set.

## Folder structure

```
src/assets/cardsets/
  classic/        ← built-in default
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
    13-jester.png          (or jester.png / joker.png / wild.png)
    back.png               (or card-back.png)
  christmas/        ← example user-set
    1-dalmuti.png
    ...
    back.png
  fantasy/
    1-dalmuti.png
    ...
    back.png
  coworkers/
    1-dalmuti.png
    ...
    back.png
  remastered/
    1-dalmuti.png
    ...
    back.png
```

## File naming

Only the leading number (1–13) or the word `back` matters:

- `1-dalmuti.png` → Dalmuti rank card
- `7-seamstress-v2.png` → rank 7 (any suffix after the dash is ignored)
- `13-jester.png`, `jester.png`, `joker.png`, or `wild.png` → the Jester
- `back.png` or `card-back.png` → the card back

## How it works

1. **Build time** — Vite runs `import.meta.glob('../assets/cardsets/**/*.png')`, which
   collects every PNG under this folder. Each PNG is inlined as a base64 data URL by
   `vite-plugin-singlefile`.
2. **Parse** — `cardAssets.ts` groups the files by sub-folder name and maps each file
   to a card slot (1–13 or "back").
3. **Host selects** — the host's lobby UI shows a "Card Set" dropdown listing every
   discovered set. Guests cannot change it.
4. **Broadcast** — the chosen set name is stored in `GameState.cardSet` and travels
   with the state broadcast. Every client's `useEffect` calls `setCurrentCardSet()` so
   all players render the same art.
5. **Fallbacks** — if a set is missing a slot, the "classic" set is tried; if that is
   also missing, the code-drawn procedural renderer takes over. So a partial deck
   always works.

## Adding a new set

1. Create a new folder: `src/assets/cardsets/space/`
2. Drop your PNGs in there.
3. Run `npm run dev` or `npm run build`.
4. The new set appears automatically in the lobby dropdown.

That's it — no imports, no code edits.

## Recommended dimensions

- 500 × 700 px (aspect ratio 5 : 7)
- PNG-24, ideally ≤ 120 KB per card (the singlefile build inlines everything)
- Leave a small safe margin: card corners are rounded and the bottom edge is partly
  covered by the hand.

## Current status

This folder ships with an empty `classic` set, so the game falls through to the
procedural renderer until you drop PNGs in. The "Classic" entry always appears in
the dropdown. Drop real PNGs into `classic/` to replace the procedural face, or
add a sibling folder to add a second selectable set.
