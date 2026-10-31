# Reader memory and hide-assets lag — design

Date: 2026-10-31

## Problem (user report)
- In the reader, loading further down ("다음 대사 더 보기" / follow) keeps growing memory.
- Toggling asset hiding (hide pictures / images) lags; the user suspects too much is kept in the scroll.

## Causes found
1. **Unbounded render window.** `src/ui/live/readerWindow.ts` `extendDown` / `extendUp` / `grownRange` only grow `[start, end)` (PAGE = 300 in `ReaderView.tsx`); only follow mode trims (`trimToTail`). After several "more" loads, thousands of items are mounted, each possibly with face images and screen canvases. Any reader-wide state change (hide assets, hide rules, theme) re-renders/re-draws all of them → lag.
2. **Unbounded decoded image cache.** `AssetStore.image()` (`src/core/assets/assets.ts`) caches every `ImageBitmap` forever (`images` Map); pictures are often full-screen (1280×720 ≈ 3.7 MB decoded each). `usePictureImages` (`src/ui/addons/pictureImages.ts`) and screen canvases keep using them. Blob cache (`cache`) is also unbounded but compressed (smaller).
3. Every mounted screen canvas keeps its own backing store even far off-screen.

## Design
1. **Bounded window, both directions.**
   - Keep at most `MAX_WINDOW` items mounted (e.g. 3 × PAGE; tune PAGE down if it helps, e.g. 150). When extending down past the cap, drop items from the top; when extending up, drop from the bottom. Preserve the visual scroll position with the existing anchor mechanism (`applyRange(..., { kind: "anchor" | "key" ... })`): anchor on an item that stays mounted.
   - Load automatically when the user scrolls near either edge of the window (IntersectionObserver sentinel), keeping the "이전/다음 대사 더 보기" buttons as fallback.
   - Bookmarks, ToC jumps, read-position tracking, read marking, hide rules and the voice auto-play (`data-reader-line`, `useReaderAutoVoice`) must keep working when items leave/enter the window. Pure range functions get unit tests (cap, trim direction, follow mode unchanged).
2. **Bounded decoded images.** Give `AssetStore` a budget for decoded `ImageBitmap`s (e.g. ~256 MB by width×height×4) with LRU eviction of bitmaps that are not currently in use: add acquire/release (ref counting) used by `usePictureImages` / face/picture hooks; evict + `close()` only unreferenced bitmaps; re-decode from the blob cache on next use. Also cap the blob cache (LRU by bytes, e.g. 128 MB). Unit tests for the LRU/refcount logic.
3. **Off-screen canvases.** Screen/picture canvases in reader items draw only when near the viewport (IntersectionObserver with a margin of about one screen) and release their backing store (`width = height = 0`) and their image references when far off-screen; keep the element's layout size so scroll height does not jump.
4. **Hide-assets toggle.** With 1–3 in place, the toggle only affects mounted items; additionally make sure toggling does not rebuild the whole item list (memoised item views stay memoised; the toggle only changes what the image components render).

## Out of scope
- Play timeline view (unless it shares the same components and benefits automatically).
