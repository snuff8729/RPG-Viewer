# In-game text colour and size in play and reader views — design

Date: 2026-10-31

## Problem
Game messages use escape codes for colour and size, e.g. `\C[2]important\C[0]`, `\{big\}`, MZ `\FS[40]`. Today `formatText` (`src/core/text/escape.ts`) drops every unknown code, so the play timeline (`src/ui/live/TimelineItem.tsx`) and the reader (`src/ui/live/ReaderItemView.tsx` and friends) show plain text. The user wants them shown with the same colour and size as in the game.

## Design

### 1. Rich formatter (pure, tested)
- Add a function next to `formatText` (e.g. `formatRich(raw, data, opts)`) returning segments `{ text, color?: string, size?: number }[]` (size = relative scale, 1 = default). Reuse the same tokenizer and the same substitutions as `formatText` (`\N`, `\V`, `\P`, `\G`, `\\`), so plain text output is identical when styles are ignored. Keep `formatText` behaviour unchanged for every other caller (search, ToC, choice cards, etc.).
- Colour codes:
  - `\C[n]` (n integer) → colour index n of the game's text palette; `\C[0]` → reset to default (no colour).
  - `\C[#rrggbb]` / `\C[#rgb]` and common plugin forms like `\HC[rrggbb]` (YEP) → that hex colour.
  - Unknown / out-of-range → keep current colour.
- Size codes:
  - MV/MZ `\{` → +12 px, `\}` → −12 px, clamped like the engine (MV: bigger only if size <= 96, smaller only if size >= 24).
  - MZ `\FS[n]` → absolute size n.
  - Scale = currentPx / defaultPx (default font size: `System.json` → MZ `advanced.fontSize` if present, else 28 for MV, 26 for MZ). Clamp the displayed scale to a sane range (e.g. 0.6–2.5) so a line can never break the layout.
- Colour and size reset at the start of every message (as in the game). Line breaks are preserved.

### 2. Game text palette
- Real colours come from the window skin `img/system/Window.png` (decrypt like other images with the existing asset layer): colour n = pixel at x = 96 + (n % 8) * 12 + 6, y = 144 + floor(n / 8) * 12 + 6 (32 colours).
- Load it once per game, cache it. While loading or if it fails, use the default MV/MZ palette (hard-coded 32 colours) so colours still appear.
- The default text colour (index 0) is NOT applied — default-coloured text uses the app's normal foreground so it works in light and dark theme.

### 3. Display
- Play timeline message text and reader message text render segments as `<span style={{ color, fontSize: `${scale}em` }}>`. Speaker names: colours only (no size). Keep `whitespace-pre-line`.
- If an inline colour is unreadable against the theme background it is still shown as-is (fidelity to the game is the goal); no extra styling beyond inline color/font-size.
- Hidden-line placeholders, search, ToC, history text, copy/export keep using plain `formatText`.

## Out of scope
- Icons (`\I[n]`), text speed codes, outline/italic/bold plugin codes (just stripped as today).
