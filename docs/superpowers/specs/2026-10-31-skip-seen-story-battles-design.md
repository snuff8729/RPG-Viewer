# Skip story battles whose story is already seen — design

Date: 2026-10-31

## Problem (from a masked game report)
A recurring troop (one enemy, won several times) is never skipped by "전투 건너뛰기". `skipBlock()` → `storyBattle(troopId)` in `plugin/RPGViewerBridge.js` marks a troop as story when any troop page (or a Common Event it calls, recursively) contains any of `STORY_BATTLE_CODES` (101–105 text/choices/input, 333 enemy state, 336 transform, 340 abort, 353 game over, 354 return to title). This troop has:
- page with condition "actor 1 HP ≤ 0%" → defeat scene (text + nested common events with long count-dependent branches; the branch for the current defeat count is fully seen);
- page with a switch condition → message + Abort Battle (340);
- turn-end pages calling common events that may transform the enemy (336);
- a battle-start page calling a common event.
The user has won this battle and seen every defeat scene that can currently play, yet the battle is fought every time.

## Design (bridge only)
Replace the "any story code anywhere" rule with "unseen story that can currently play, or a never-beaten troop":
1. **Seen-aware text.** Show Text (101) / Show Scrolling Text (105) blocks the skip only if its seen key (`locKey(src) + "#" + index`; troop pages use `{ source: "troop", troopId, page }`, common events `{ source: "common", commonEventId }` — exactly the keys the message hooks produce) is NOT in `seenMessages`.
2. **Reachability with current state.** While scanning a list, evaluate Conditional Branch (111) for switch (type 0), variable (type 1, constant or variable operand, all comparison ops) and self switch (type 2, only for map-event sources; troop/common → unknown) using current `$gameSwitches` / `$gameVariables` / `$gameSelfSwitches`; follow only the taken branch (the 111 body, or its 411 Else body, up to the matching 412 at that indent). Any other condition type → scan both branches. Commands are not executed; variable changes inside the event are ignored (accepted approximation, note it in a comment). Common Event calls (117) are followed up to `STORY_SCAN_DEPTH`, no repeats.
3. **Choices / input** (102–104) do not block on their own (no seen keys exist for them); text around them decides.
4. **Battle-changing commands** (333, 336, 340, 353, 354) block only when the troop has never been beaten: i.e. not every enemy id of the troop is in the defeated list (`loadDefeated()`). Once all its enemies were beaten before, skipping as a win is fine.
5. **seenMessages not loaded yet** (empty) → keep the old rule (any story code blocks).
6. Toast when still blocked: "처음 보는 대화가 있어 그대로 싸워요" (unseen text) / keep "대화가 있는 전투라 그대로 싸워요" for the never-beaten + battle-changing case.
7. Interplay with the outcome-branch choice (`battleSkipOutcome`, lose → escape → win among unseen aftermath branches) stays unchanged.
8. Bump the plugin version by one minor (another change may also bump it; the merge will renumber), with a one-line header note; update version expectations in tests.

## Tests (fake engine in `tests/plugin/*`, synthetic data only)
- Troop with a defeat page (actor HP 0%) whose text is all seen → skipped (win). Same with one unseen reachable text → fought.
- Count-dependent branch: unseen text only in a branch whose variable condition is false now → skipped; flip the variable → fought.
- Text inside a called common event, seen / unseen.
- Troop page with 340 / 336: beaten troop → skipped; never-beaten troop → fought.
- seenMessages empty → old behaviour.
