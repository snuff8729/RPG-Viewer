# RPG Viewer — 게임 보조(배속·본 것 넘기기·전투 조작) 설계 + 구현 계획

> For agentic workers: implement task-by-task with TDD. Steps use `- [ ]`.

**User need (verbatim):** "이 시스템에 치트도 넣어놓고 싶거든 https://github.com/paramonos/RPG-Maker-MV-MZ-Cheat-UI-Plugin 전투에서 씬이나 이벤트(같은 적에게 몇번 패배 이벤트마다 다른 장면이 나올 수 있음)를 모두 다 봤으면 빠르게 스킵할 수 있고, 그냥 노가다로 반복되는 이벤트도 알아서 배속을 올려서 처리한다던가 좀 이런 방향으로 사용할 수 있을거 같아서."

**Decision:** don't bundle the third-party cheat plugin (it overwrites `main.js`, needs ES6/new NW.js). Build the needed features into our own bridge plugin, driven by the viewer, because only the viewer knows what has been seen. Never auto-pick choices and never auto-force a battle outcome (a forced win/lose changes the story); outcome buttons are manual.

## Features
1. **배속** — game runs ×1/×2/×4/×8 (scene update repeated per frame).
2. **본 대사 자동 넘기기** — a message whose (location, cmd) is already seen shows instantly and advances by itself after a short pause (~6 frames at current speed). Unseen messages behave normally (wait for the player). Choices always wait.
3. **반복 이벤트 자동 배속** — while an event runs whose every message/choice option has been seen (viewer-computed set of fully-seen pages), speed is raised to the "자동 배속" value (default ×8) until that event ends; then back to the normal speed.
4. **본 전투 자동 배속** — in a battle whose troop's every page with messages/pictures has been seen (and the troop has been fought before, i.e. a `battle` record exists), battle runs at the "자동 배속" value.
5. **전투 조작 버튼** (manual, only while in battle): `이기기`, `지기`, `도망`. Plus in-game hotkeys: F6 cycles 배속 (×1→×2→×4→×8→×1), F7 toggles 본 대사 자동 넘기기. Hotkeys only while the game window is focused; don't clash with F5 (reload)/F8 (devtools)/F9.

## Contract: `rpg-viewer/control.json` (viewer → game)
```json
{ "v": 1, "t": 1730000000000,
  "speed": 1,                      // 1|2|4|8 base speed
  "skipSeen": true,                // feature 2
  "autoFast": true, "autoSpeed": 8,// features 3+4
  "seenMessages": ["map:3:5:0#12", "common:7#4", "troop:2:0#1"],   // seenKey format = locationKey + "#" + cmd
  "seenPages": ["map:3:5:0", "common:7"],   // locationKey of pages/common events fully seen (all messages seen, all choice options picked)
  "seenTroops": [2, 9],            // troop ids for feature 4
  "command": { "id": "c-1730000000000", "kind": "win" | "lose" | "escape" } | null }
```
- Viewer writes it (via `Folder.writeText`, folder already writable after install) on settings change immediately and on coverage change debounced 3 s. Size: plain JSON arrays (tens of thousands of short strings is fine).
- Plugin polls `fs.statSync(control.json).mtimeMs` at most once per second (in its existing tick), re-reads on change, validates every field, ignores bad JSON. A `command.id` is executed at most once (remember last id; also ignore commands older than 10 s via `t`).
- Plugin reports back in `live.json`: `assist: { speed: number, effectiveSpeed: number, skipSeen: boolean, troopId: number | null, lastCommand: string | null }` (optional field; old viewers ignore).
- Hotkey changes made in game are reported in `live.json.assist`; the viewer adopts them (shows them) and persists them so the next control write keeps them.

## Tasks (parallel: Task A plugin, Task B viewer)

### Task A: plugin 1.1.0 (`plugin/RPGViewerBridge.js`, `tests/plugin/bridge.test.ts`)
- ES5, IIFE, all hooks try/catch, never break the game; works on MV (NW.js old) and MZ.
- Speed: wrap `SceneManager.updateScene` (exists in MV and MZ) to call the original `effectiveSpeed` times per frame (cap 8; guard against re-entrancy). `effectiveSpeed` = autoFast condition ? max(speed, autoSpeed) : speed.
- Seen-skip: in `Window_Message` (MV/MZ share names): when a message starts (`startMessage`) look up the running interpreter's src + current cmd (the plugin already tracks src/cmd for message records) → if key ∈ seenMessages and skipSeen: set `_showFast = true`, `_lineShowFast = true`, and auto-advance: after ~6 frames, when `pause` is true, trigger the same as input (`this.pause = false; this._pauseSkip`… use `terminateMessage`/`updateInput` path cleanly — implement by overriding `isTriggered` to return true once the auto timer expires while pause). Never when `$gameMessage.isChoice()` / number input / item choice is pending.
- Auto fast for events: when the *innermost* running interpreter's page key (same as `live.running` location key) ∈ seenPages → autoFast true. In battle (`$gameParty.inBattle()`), autoFast true when `$gameTroop._troopId` ∈ seenTroops.
- Battle commands (only if `$gameParty.inBattle()` and `BattleManager` phase is not already ending): win → kill all alive enemies (`addNewState(deathStateId)`, `refresh`) then let the normal end check run (`BattleManager.checkBattleEnd()`); lose → `BattleManager.processDefeat()`; escape → `BattleManager.processEscape()` only if `BattleManager.canEscape()`, else `processAbort()`. Battle event "can lose" branches then run normally.
- Hotkeys F6/F7 via `Input.keyMapper` additions (`117: 'rpgvSpeed'`, `118: 'rpgvSkip'`) checked in the existing per-frame hook with `Input.isTriggered`.
- `live.json.assist` as in the contract; urgent live write on assist change.
- VERSION `"1.1.0"`. Tests with the fake engine: control parsing/validation & mtime polling, speed wrapper call count, seen-skip only for seen keys and never on choice, autoFast for seenPages/seenTroops, command once-only and staleness, hotkeys update assist.
- Commit `feat(plugin): game assist — speed, seen skip, auto fast, battle commands (1.1.0)`.

### Task B: viewer (`src/core/live/assist.ts` + test, `src/ui/live/AssistPanel.tsx`, `src/app/LiveProvider.tsx`, `src/core/live/types.ts`)
- core `assist.ts` (pure):
  ```ts
  export interface AssistSettings { speed: 1|2|4|8; skipSeen: boolean; autoFast: boolean; autoSpeed: 2|4|8 }
  export function seenSets(coverage: Coverage, index: GameIndex, records: LogRecord[]): { seenMessages: string[]; seenPages: string[]; seenTroops: number[] };
  export function controlJson(s: AssistSettings, sets: ReturnType<typeof seenSets>, command: { id: string; kind: "win"|"lose"|"escape" } | null, now: number): string;
  export const DEFAULT_ASSIST: AssistSettings; // {speed:1, skipSeen:true, autoFast:true, autoSpeed:8}
  ```
  - seenPages: every index page (map/common/troop) that has at least one message/choices node and all its messages/scrolls seen and every choice option picked (incl. cancel branch when present) — reuse the counting logic from `interactable.ts` (`countNew` → unseen 0 && unpicked 0, counting inside choice branches too for this purpose: add an option rather than duplicating).
  - seenTroops: troop ids where a `battle` record exists for that troop (check the LogRecord shape for battle) and every troop page with dialogue is in seenPages (troops with no dialogue pages qualify once fought).
- `LiveSnapshot.assist?` optional type per contract.
- LiveProvider: holds settings (localStorage `rpgv.assist.{gameKey}`, try/catch), exposes `useAssist(): { settings, setSettings, sendCommand(kind), supported: boolean }`; writes control.json on change (immediate) and on coverage change (debounced 3 s), only when connected and the plugin version ≥ 1.1.0 (`supported`). Adopt `live.assist.speed/skipSeen` when they differ from what we last wrote (hotkey changes in game).
- `AssistPanel`: shadcn `Popover` opened from a header Button `게임 보조` (next to the connection badge). Inside: `배속` ToggleGroup (×1 ×2 ×4 ×8), Switch `본 대사 자동 넘기기`, Switch `본 이벤트·전투 자동 배속` + ToggleGroup for its speed (×2 ×4 ×8), and when `live.inBattle`: Buttons `이기기` `지기` `도망` (지기 with a one-line muted note `패배 장면이 있는 전투면 그 장면이 나와요`). Muted footer: `게임 창 단축키: F6 배속, F7 본 대사 넘기기`. If not supported: muted text `플러그인을 1.1.0으로 업데이트하면 쓸 수 있어요` and controls disabled.
- Tests for assist.ts; build/test/lint; commit `feat(ui): game assist panel and control file`.
