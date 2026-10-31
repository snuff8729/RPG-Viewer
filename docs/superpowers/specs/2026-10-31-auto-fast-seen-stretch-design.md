# Auto speed for a seen stretch of an event (also in battle) — design

Date: 2026-10-31

## Problem (from a masked game report)
A defeat scene runs as a long common event **inside battle** (called from the troop interpreter). From the third defeat on, the same branch repeats every time: ~13 s of Show Picture / Wait / Play SE / nested common events (picture animations, no text) followed by one message the user has already seen. "본 이벤트 자동 배속" (autoFast) never speeds it up:
1. `autoActive()` in `plugin/RPGViewerBridge.js` returns false whenever `inBattleNow()`.
2. Even outside battle it only fires when the innermost running page/common event is in `seenPages` (built in `src/core/live/assist.ts` `seenSets`): a page must be *entirely* seen, and pages with no dialogue are never included. A big event with many count-dependent branches is never "entirely seen", and the animation common events it calls have no dialogue at all.
`skipSeen` only fast-forwards messages, so the picture/wait stretch plays at normal speed.

## Design (bridge; viewer unchanged unless needed)
1. **Seen stretch rule.** autoFast is also active when the *next dialogue the running event will reach* is already seen:
   - Start at the innermost running interpreter (`innermost(...)`, battle-aware) and scan its `_list` forward from the current command index for the next Show Text (101) or Show Scrolling Text (105). Use the seen key `locKey(src) + "#" + index` (same as the message hooks).
   - If the list ends without text, continue in the parent interpreter (the one that called the child via 117 / setupChild) from its current index, and so on up the chain.
   - Found and in `seenMessages` → active. Found and not seen → not active. A Show Choices (102) reached before any text → not active (choices are not in seenMessages). Nothing found in the whole chain → fall back to the existing `seenPages` rule.
   - Linear scan (ignore branch structure) is acceptable; cap the scan (e.g. 2000 commands total) and cache the result per (interpreter list, index) so `computeSpeed` stays cheap per frame.
2. **Battle.** Allow autoFast in battle only while an event is running in the troop interpreter (the battle's event chain is busy: `$gameTroop._interpreter.isRunning()`), never for plain battle actions/animations. Keep the existing `seenPages` rule working as before outside battle.
3. Keep `skipSeen` behaviour unchanged. Keep `seenSets` unchanged unless a viewer change is truly required.
4. Bump the plugin version (current 1.27.0 → 1.28.0) with a one-line note in the header, update version expectations in tests.

## Tests (fake engine in `tests/plugin/*`, synthetic data only)
- Map event: animation stretch (231/230/117 to a text-less common event) before a seen 101 → active; before an unseen 101 → inactive; reaching 102 first → inactive.
- Child common event with no text → looks into the parent's following commands.
- In battle with the troop interpreter running a common event whose next text is seen → active; in battle with no event running → inactive.
- Existing seenPages behaviour still works.
