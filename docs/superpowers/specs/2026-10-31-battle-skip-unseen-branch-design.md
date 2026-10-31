# Battle skip: take the outcome whose aftermath is unseen — design

Date: 2026-10-31

## Problem
`plugin/RPGViewerBridge.js` skips battles (`maybeSkipBattle` → `skipBattle`) and always ends them as a **win** (`BM.endBattle(0)`). The user avoids repeated battles, but when an event's Battle Processing (code 301) has "If Lose" (603) or "If Escape" (602) branches with dialogue/scenes the user has never seen, the skip should go that way instead, so the new story content plays.

## What we already have
- `seenMessages` (from control.json, built by the viewer in `src/core/live/assist.ts`): seen keys `locKey(src) + "#" + cmdIndex` for map event pages, common events and troop pages.
- The interpreter executes 301 → `BattleManager.setup(troopId, canEscape, canLose)` → `SceneManager.push(Scene_Battle)`; `maybeSkipBattle` runs at that push. Win/escape/lose branches are commands 601/602/603 right after the 301 at the same indent, closed by 604; `BattleManager._canLose` / `_canEscape` are set.

## Design (bridge only)
1. **Remember the battle's event context.** Hook `Game_Interpreter.prototype.command301` to remember `{ interp: this, list: this._list, index: this._index, src: srcOf(this) }` while it runs (cleared after). Random/symbol encounters have no context → current behaviour (win).
2. **Find outcome branches.** From the 301 index, scan following commands at the 301's indent: 601 = win, 602 = escape, 603 = lose, until 604 or a command at that indent that is not one of them. Each branch = commands between its marker and the next marker/604 at that indent.
3. **Is a branch unseen?** A branch is "new" if it contains, directly or through Common Event (117, follow up to the existing `STORY_SCAN_DEPTH`, no repeats), a Show Text (101), Show Scrolling Text (105) or Show Choices (102) whose seen key (`locKey(src) + "#" + index`, with the common event's own src for nested lists — use the same key format the message hooks use) is not in `seenMessages`. A branch with no such command is "nothing to see". If `seenMessages` is empty/not loaded yet, treat as unknown → keep current behaviour (win).
4. **Pick the outcome.**
   - win branch new → win (current behaviour).
   - else lose branch new and `_canLose` → lose.
   - else escape branch new and `_canEscape` → escape.
   - else (everything seen or nothing to see) → win.
5. **Skip as lose / escape.** Generalise `skipBattle(result)`: result 0 keeps everything as today. For 1 (escape) / 2 (lose): no enemy deaths, no rewards, no defeated-enemy record, party untouched; call `BM.endBattle(result)` with the same callback wrapping (`cb(result)` if not called), so the interpreter enters the right branch. Never pick lose when `_canLose` is false (that would be a game over).
6. **Tell the user.** In-game toast via existing `showMessage`: "전투 건너뜀(이김)…" as today; "전투 건너뜀(짐) — 처음 보는 패배 장면" / "전투 건너뜀(도망) — 처음 보는 도망 장면". When win was taken but the lose/escape branch is also new, append " · 패배 장면은 아직 안 봄" (or 도망) so the user knows another route exists.
7. Keep the story-troop rule (`storyBattle`) and the unknown-enemy rule unchanged.
8. Record: the battle end record emitted for skipped battles must carry the real result (win/escape/lose) like a normal battle end, so the viewer timeline shows it correctly.
9. Bump the plugin version the way the file does for other changes, with a short version note.

## Tests
- The bridge has no unit test harness for plugin internals; if a pure helper (branch finding / key building) can be kept free of game globals, add a vitest test that loads it the way other bridge tests do (check `tests/` and existing `*.test.ts` touching the plugin). Otherwise rely on lint/build plus careful reading.
