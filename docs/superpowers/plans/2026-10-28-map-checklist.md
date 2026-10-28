# RPG Viewer — "이 맵" 체크리스트 (설계 + 구현 계획)

> For agentic workers: implement task-by-task with TDD. Steps use `- [ ]`.

**Goal:** 지금 있는 맵에서 놓치는 것 없이 다 보기. (1) 지금 조건으로 상호작용 가능한 이벤트, (2) 반복하면 다른 내용이 나오는지, (3) 아직 잠긴 내용의 조건과 그 조건을 만드는 방법(경로)을 한 탭에서 보여준다.

**User need (verbatim):** "지금 맵에서 내가 인터랙션 가능한것들을 표시해주면 좋을거 같아. 현재 조건에 맞는것만 표시하고, 만약 같은걸 두 번 세번 반복했을 때 다른게 나올 수 있으면 그것도 알고싶어. 그리고 조건이 어떻게 해야 달성되는지도 알고싶어. 맵에서 놓치는거 없이 다 보고싶다는거야."

**Measured on the sample game (13,755 map pages, 1,060 common events):** 80% of dialogue pages are within 2 dependency steps; deepest is 14 but linear (one writer per step); writers per required atom median 1 / p90 3 / max 1,764; page conditions AND width ≤ 3; 12% of dialogue pages are untraceable because of plugin commands (20k), script conditions (3.9k), script variable sets (2.5k) and self switches with no writer (854). Graph build < 300 ms.

## Global Constraints
- Stack: Vite, React 19, TS 7 (erasableSyntaxOnly — no constructor parameter properties), Tailwind v4, shadcn/ui only (existing components in `src/components/ui`; may add official shadcn components via CLI), Vitest, oxlint. Path alias `@/*` → `src/*`.
- `src/core` stays pure (no react/window/document/indexedDB). Core functions never throw (wrap and return safe defaults).
- Korean UI text. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never read game folders under `C:/Users/User/Documents`. Use fixtures / synthetic data only.
- Raw command codes: 101 text, 102 choices (402 when, 403 cancel, 404 end), 111 conditional (411 else, 412 end), 112 loop, 117 common event, 121 switches `[start,end,value(0=ON)]`, 122 variables `[start,end,op(0 set,1 add,2 sub,3 mul,4 div,5 mod),operandType(0 const,1 var,2 random,3 gamedata,4 script),...]` (const: p[4]; random: p[4]..p[5]; var: p[4]), 123 self switch `[ch, value(0=ON)]`, 125 gold, 126/127/128 item/weapon/armor `[id, op(0 gain), operandType, operand]`, 129 party `[actorId, 0=add]`, 302/605 shop `[type(0 item,1 weapon,2 armor), id, ...]`, 355/655 script, 356 plugin command, 357 MZ plugin command. 111 params: `[0, switchId, 0=ON|1=OFF]`, `[1, varId, operandType(0 const,1 var), operand, op(0 ==,1 >=,2 <=,3 >,4 <,5 !=)]`, `[2, ch, 0=ON|1=OFF]`, `[4, actorId, ...]`, `[7, gold, op]`, `[8, itemId]`, `[9, weaponId, includeEquip]`, `[10, armorId, includeEquip]`, `[12, script]`.

## Design

### Tab
New top tab `이 맵` (route `#/here`, `Route { kind: "here" }`) between `읽기` and `기록`. When not connected: shadcn `Alert` "게임에 연결하면 지금 있는 맵을 보여줘요."

Layout (top → bottom):
1. Header: map name, `내 위치 (x, y)`, Badge `할 것 {N}개 남음` (N = events in sections 1–3 below with something left).
2. Position grid (inside a `Card`): an SVG of the map's width×height (aspect-correct, max height ~240px, scales to width). Faint grid lines only if both dims ≤ 60. Event dots at the event's data `(x,y)`, colour by section (use CSS vars: `--primary` for "지금 할 수 있음 + 새것", `--chart-2`/amber-like token if present else `--primary` with 60% opacity for "반복하면 달라짐", `--muted-foreground` for 잠김, `--border` for 다 봄). Player = ring marker at live (x,y). Hover title = event name; click → scroll that event's card into view and briefly highlight it (ring class for 1.5s).
3. Sections (each a heading + count; cards inside):
   - `지금 할 수 있어요` — events whose active page (live) exists, trigger is action/touch (0–2), and has unseen dialogue or unpicked choices.
   - `반복하면 달라져요` — events whose active page is interactable and `repeat` analysis says the next interaction differs (and not already listed above; if both apply, list in section 1 with the repeat Badge).
   - `아직 잠겨 있어요` — events having at least one non-active page with dialogue that has unseen lines/unpicked choices (pages above or below the active page whose conditions are not met now). Collapsed card body by default.
   - `다 봤어요` — everything else with dialogue on the map; whole section collapsed (Collapsible, `다 봤어요 ({N})`).
   - Autorun/parallel (trigger 3/4) pages: shown with `자동` Badge in the matching section (they run by themselves; useful to know).
   - Events with no pages having dialogue/choices/pictures/transfer: omitted.
4. Event card (shadcn `Card`): title (`entry.title` of active page or event name), `(x, y)`, Badges: `새 대화 {n}`, `선택지 {n}`, `반복하면 달라짐`, `자동`, `잠긴 내용 {k}`. Body:
   - Repeat explanation lines (text from core, e.g. `말을 걸면 셀프 스위치 A가 켜져 다음엔 2페이지가 나와요`, `3번째부터 다른 대사가 나와요 (변수 [호감도]를 셈)`, `무작위로 다른 대사가 나와요`, `고르는 선택지에 따라 다음 내용이 달라져요`).
   - Locked pages (Collapsible `잠긴 내용 보기`): per page: `p{n}` + unseen counts + condition list with ✓ (met) / ✗ (unmet) using `describePageConditions` text. For each unmet condition a `조건 만드는 법` block from the path explainer (below).
   - Button `탐색기에서 보기` → `openPage(location)`.

### How-to path (조건 만드는 법)
From the precomputed dependency graph (built once per `GameData`, WeakMap cache):
- Show a numbered chain of steps. Each step: where (`맵 이름 › 이벤트 이름 › p{n}` or `공통 이벤트 {이름}` or `전투 {이름}`), what it does (`스위치 [이름] 켜기`, `변수 [이름] {+=,=} {값}`, `아이템 [이름] 얻기`, `상점에서 [이름] 사기`), qualifiers: `선택지 "{라벨}" 골랐을 때` if inside a choice branch, `지금 할 수 있음` Badge if the writer's context is available now and its enclosing conditions are met, `반복 필요` if the variable requirement needs more than one add.
- Auto-follow while the chain is linear: if the unmet atom has exactly one writer, or exactly one writer that is available now, take it and continue with that writer's own unmet requirements (depth limit 20, cycle guard).
- At a fork (several writers, none uniquely available) stop and list up to 5 candidates sorted: available now first, then lowest depth level (precomputed); `외 {n}곳` for the rest. Each candidate is a button that expands the chain from that candidate (UI state, recursion via the same core function).
- When no writer exists or only opaque ones: final line `여기서부터는 데이터로 알 수 없어요 ({reason})` where reason ∈ `플러그인 명령`, `스크립트`, `바꾸는 곳 없음`. Never invent a path.
- Common events: a writer inside a common event is "available now" if the common event is autorun/parallel with its switch ON, or (trigger 0) any caller page is available now; the step shows `공통 이벤트 {이름} (호출: {첫 호출 위치} 외 {n}곳)`.

### Repeat analysis
For the event's active page, simulate interacting repeatedly against a copy of the live state (pure):
- Interpreter over raw `list`: evaluate 111 with current simulated state (unknown → stop simulation as "unknown"), apply 121, 122 (const set/add/sub/mul/div/mod; var operand; random → mark random), 123 (self switch of this event), 126–129 gains, 117 calls into common events (recursively, depth ≤ 5, same rules), skip 102 choices: any writes inside choice branches → mark `choiceDependent` (do not apply them); 355/356/357 that may change state → mark opaque (simulation continues but result flagged "추정").
- Run up to 5 interactions. After each, recompute the active page (RPG Maker rule, `activePageIndex`) for this event with the simulated state, and record the sequence of (page, set of message cmd indexes shown). Report:
  - `nextPage`: page changes after interaction k → text `{k}번 하면 다음엔 {p}페이지가 나와요` (k=1 → `말을 걸면 … 다음엔`).
  - `counter`: same page but a different set of messages appears at interaction k → `{k}번째부터 다른 대사가 나와요` (mention the variable/switch name that changed if single).
  - `random`: a 111 on a variable set by random within the page/called common events, or script with `Math.random` → `무작위로 다른 대사가 나와요`.
  - `choiceDependent` → `고르는 선택지에 따라 다음 내용이 달라져요`.
  - None of the above → not repeat-different.
- Cache by (data, page object, conditionsKey(live)).

## Tasks & waves
- **Wave A (parallel):** Task 1, Task 2
- **Wave B:** Task 3 (needs 1, 2)
- **Wave C:** Task 4 (needs 3)

### Task 1: map size + dependency graph (core)
Files: modify `src/core/types.ts` (`MapData` gains `width: number; height: number`), `src/core/loader/loadGame.ts` (+test update); create `src/core/deps/graph.ts`, `src/core/deps/graph.test.ts`.
```ts
export type Atom =
  | { kind: "switch"; id: number } | { kind: "variable"; id: number }
  | { kind: "selfSwitch"; mapId: number; eventId: number; ch: string }
  | { kind: "item" | "weapon" | "armor"; id: number } | { kind: "actor"; id: number };
export type Req = { atom: Atom; test: ConditionTest };            // what must hold
export type CtxId = string;                                        // "M{map}:{event}:{page}" | "C{id}" | "T{troop}:{page}"
export interface WriteOp { atom: Atom; op: "on" | "set" | "add" | "sub" | "other" | "gain" | "shop" | "script"; value?: number }
export interface Writer { ctx: CtxId; cmd: number; write: WriteOp; reqs: Req[]; choice?: { cmd: number; branch: number; label: string } }
export interface CtxInfo { id: CtxId; location: Location; reqs: Req[]; trigger: number; callers: CtxId[]; opaque: { plugin: number; script: number } }
export interface DepGraph { ctxs: Map<CtxId, CtxInfo>; writersOf(a: Atom): Writer[]; level(a: Atom): number /* Infinity = untraceable */; ctxLevel(id: CtxId): number }
export function atomKey(a: Atom): string;
export function buildDepGraph(data: GameData): DepGraph;   // WeakMap-cached per data; never throws
```
- Writer `reqs` = context page reqs + enclosing *then*-branch conditional reqs (else-branches add none). Self switch writes in common events are skipped (unknown event). Script writes recognised by regex `$gameSwitches.setValue(N`, `$gameVariables.setValue(N` → op `script`. Template map (data.templateMapId) excluded.
- `level` via fixpoint like the measurement script: ctx level = max(req levels), common event trigger-0 = min caller level; atom level = 1 + min over writers of max(ctx level, req levels). Initial-true tests (OFF switch, var tests true at 0) need nothing.
- Tests: synthetic GameData covering: linear chain S1→S2→page; writer inside then-branch inherits req; inside choice branch records label; common event via 117 callers; self switch writer; script writer; no-writer → Infinity; cycle terminates; loader width/height.
- Commit `feat(core): map size and dependency graph`.

### Task 2: repeat analysis (core)
Files: create `src/core/live/repeat.ts` + test.
```ts
export interface RepeatInfo { kind: "nextPage" | "counter" | "random" | "choiceDependent"; text: string; after: number /* interaction count, 0 for random/choice */; estimated: boolean }
export function repeatInfo(ev: MapEvent, mapId: number, data: GameData, live: LiveSnapshot): RepeatInfo[]; // [] = same every time; never throws
```
- Simulation per Design › Repeat analysis. Use `activePageIndex` from `interactable.ts` (export it if not already) and `evaluate`/`describeBranchCondition` for 111. Variable/switch names from `data.system`.
- Tests (synthetic): self switch A set → nextPage after 1; counter var +1 with `>= 3` branch → counter after 3 (i.e. 3번째부터); random set + branch → random; write inside choice → choiceDependent; plain page → []; plugin command flags estimated; never throws on garbage.
- Commit `feat(core): repeat analysis for map events`.

### Task 3: map checklist + how-to path (core)
Files: create `src/core/live/mapChecklist.ts`, `src/core/deps/howTo.ts` + tests.
```ts
export type Section = "now" | "repeat" | "locked" | "done";
export interface LockedPage { page: number; location: Location; unseen: number; unpicked: number; conditions: { text: string; met: boolean; req?: Req }[] }
export interface ChecklistEvent { eventId: number; name: string; title: string; x: number; y: number; section: Section; activePage: number; location: Location | null; auto: boolean; unseen: number; unpicked: number; repeat: RepeatInfo[]; locked: LockedPage[] }
export interface MapChecklist { mapId: number; mapName: string; width: number; height: number; player: { x: number; y: number }; events: ChecklistEvent[]; remaining: number }
export function mapChecklist(data: GameData, index: GameIndex, coverage: Coverage, live: LiveSnapshot): MapChecklist | null;

export interface HowToStep { writer: Writer; where: string; action: string; choiceLabel?: string; availableNow: boolean; repeatNeeded: boolean; location: Location }
export type HowToEnd = { kind: "done" } | { kind: "fork"; candidates: HowToStep[]; more: number } | { kind: "opaque"; reason: "plugin" | "script" | "noWriter" } | { kind: "depthLimit" } | { kind: "cycle" };
export interface HowTo { steps: HowToStep[]; end: HowToEnd }
export function howTo(req: Req, data: GameData, live: LiveSnapshot, opts?: { from?: Writer }): HowTo; // never throws
```
- Section rules exactly as Design › Tab. Unseen/unpicked counting reuses the logic in `interactable.ts` (export `countNew` or a wrapper; don't duplicate). Conditions met via `evaluate`. `remaining` = events in now + repeat + locked.
- `howTo` per Design › How-to path; chain steps listed from the step closest to the player (first thing to do) — i.e. reverse the discovered chain so step 1 is what to do first.
- Tests: synthetic map with events in each section; locked page with linear chain across another map; fork with 3 writers where one is available now (auto-picks it) vs none available (fork with sorted candidates); opaque plugin/noWriter end; cycle; current-map live page used.
- Commit `feat(core): map checklist and how-to paths`.

### Task 4: "이 맵" tab (UI)
Files: modify `src/app/route.ts` (+test), `src/ui/live/LiveTabs.tsx`, the router/App switch rendering tabs; create `src/ui/live/HereView.tsx`, `src/ui/live/MapGrid.tsx`, `src/ui/live/HowToView.tsx`.
- Data via `useGame()`, `useLive()`, `useConditionsLive(live)` (recompute only when condition-relevant fields change; player position updates the grid marker only).
- Everything per Design › Tab and How-to path. shadcn components only (Card, Badge, Button, Collapsible, Alert, Separator, Tooltip). `HowToView` renders steps as an ordered list; fork candidates as outline Buttons that expand a nested `HowToView` from that writer.
- Tab label `이 맵` with count `이 맵 ({remaining})` when connected.
- build/test/lint → commit `feat(ui): 이 맵 tab with checklist, grid and how-to`.
