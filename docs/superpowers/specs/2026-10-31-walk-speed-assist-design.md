# Game assist: character walk speed — design

Date: 2026-10-31

## Goal
Add a walk-speed setting to the game assist, so the player (and followers) move faster on the map without changing the overall game speed (`speed` ×1/2/4/8, which speeds up everything).

## Design
- **Setting** `walkSpeed`: 1 | 1.5 | 2 | 3 (multiplier, default 1). Lives with the other assist settings in `src/core/live/assist.ts` (type, `DEFAULT_ASSIST`, validator like `isSpeed`, normaliser, control.json fields) and is sent to the game through control.json like `speed`/`autoSpeed`.
- **Bridge** (`plugin/RPGViewerBridge.js`): apply by hooking `Game_CharacterBase.prototype.distancePerFrame` (or `Game_Player`/`Game_Follower` overrides if the engine defines them) so that for the player and its followers only the per-frame distance is multiplied by `walkSpeed`. Never change the saved `moveSpeed` (no save-file pollution, event-set speeds stay), never affect other events, vehicles keep their own speed but are also multiplied when the player drives one. Clamp so one frame never moves more than 1 tile. Only active on the map scene. Bump the plugin version with a short note; old viewers sending no `walkSpeed` → 1.
- **Hotkey / favourites:** add an assist action `walkSpeed` ("이동 속도 바꾸기", short "이동 속도") that cycles 1 → 1.5 → 2 → 3 → 1, with a default hotkey only if a free key exists in the existing default tables (otherwise null), shown in the in-game toast like the speed hotkey ("이동 속도 ×2").
- **Viewer UI:** in the assist controls (`src/ui/live/AssistControls.tsx`) next to the existing speed control, the same kind of shadcn control the speed uses (e.g. `ToggleGroup`) with labels ×1 ×1.5 ×2 ×3; available as a favourite in the assist favourites bar like other actions (`assistItems.ts`).
- **Tests:** validator/normaliser defaults, cycle order, control.json round trip, favourite item list.
