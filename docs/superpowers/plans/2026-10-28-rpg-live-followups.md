# RPG Viewer 2.1단계 (실사용 보완) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 폴더 접근 미지원 안내, 위치 확인 완화와 원인 보기, "지금 이후" 카드, 맵별 상호작용 가능·안 본 것 표시를 추가한다.

**Architecture:** 순수 로직은 `src/core/live/`(coverage 수정, `interactable.ts`, `remaining.ts`, `mismatch.ts`), 플러그인 1.0.2, UI는 `src/ui/live/*`와 StartScreen/AppSidebar.

**Tech Stack:** 기존과 동일.

**Spec:** `docs/superpowers/specs/2026-10-28-rpg-live-followups-design.md`

## Global Constraints
- 2단계 Global Constraints 전부 유지(shadcn만, core 순수성, 예외 금지, 한국어 문구, 플러그인 ES5·try/catch, 커밋 트레일러 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
- 화면 문구(정확히): `이 브라우저는 폴더 접근을 지원하지 않아 읽기 전용으로 열려요.`, `기록 플러그인을 쓰려면 크롬·엣지를 쓰거나 Brave는 brave://flags/#file-system-access-api 를 켜 주세요.`(Brave일 때) / `기록 플러그인을 쓰려면 크롬이나 엣지를 써 주세요.`(그 외), `실행 중 변경됨`, `위치 불확실`, `지금 이후`, `탐색기에서 보기`, `플러그인을 업데이트하면 이후 대사를 볼 수 있어요`, `새 대화`, `선택지 {N}`, `안 본 것만`, `새 {N}`.
- 실제 사용자 게임 폴더·기록 파일은 읽지 않는다.

## Review Focus
1. 번역 모드: 본문만 다른 기록은 진행도에 포함되고(`changed`), 얼굴·코드·선택지 개수가 다르면 제외(`uncertain`). (Task 1)
2. 현재 페이지 계산이 RPG Maker 규칙(마지막 페이지부터)과 같아야 한다 — 스냅샷이 있는 현재 맵과 결과가 다르면 안 된다. (Task 2)
3. 남은 대본: 선택지 분기 안에서 실행 중이면 그 분기의 나머지 → 선택지 다음 노드로 이어진다(다른 분기는 제외). (Task 2)
4. 공통 이벤트 호출 중에는 `running`이 공통 이벤트를 가리켜야 한다. (Task 3)

## 실행 웨이브
- **Wave A (병렬):** Task 1, Task 2, Task 3
- **Wave B (병렬, A 병합 후):** Task 4, Task 5, Task 6

---

### Task 1: 위치 확인 완화 + 불일치 설명 + 계약 변경

**Files:** Modify `src/core/live/types.ts`, `src/core/live/coverage.ts`, `src/core/live/history.ts`; Create `src/core/live/mismatch.ts`; Tests `coverage.test.ts`, `history.test.ts`, `mismatch.test.ts`

**Interfaces — Produces:**
- types.ts: `LiveSnapshot`에 `runningCmd?: number | null;` 추가. `Coverage`에 `changedSeqs: Set<number>;` 추가. `HistoryItem`의 record 변형을 `{ kind: "record"; record: LogRecord; uncertain: boolean; changed: boolean }`로.
- coverage.ts: 구조 일치 규칙(스펙 B). 구조 일치 + 본문(메시지 첫 줄 / 스크롤 첫 줄 / 선택지 텍스트 배열) 불일치 → 진행도 포함 + `changedSeqs`. 구조 불일치·위치 없음 → `uncertainSeqs`(진행도 제외).
- history.ts: `foldTimeline` opts에 `changedSeqs?: Set<number>`, record 항목에 `changed`.
- mismatch.ts: `explainRecord(r: LogRecord, data: GameData): { reason: "noSource" | "noPage" | "codeMismatch" | "faceMismatch" | "optionCount" | "textChanged"; recorded: string; expected: string } | null` (일치하면 null). `reasonLabel(reason): string` → `출처를 알 수 없음` / `페이지를 찾을 수 없음` / `명령 종류가 다름` / `얼굴 그래픽이 다름` / `선택지 개수가 다름` / `실행 중 본문이 바뀜`. recorded/expected는 원문 그대로(메시지는 전체 줄 `\n` 연결, 선택지는 ` / ` 연결).
- LiveProvider는 Task 4~6과 겹치지 않게 **이 Task에서** `foldTimeline`에 `changedSeqs`를 넘기도록 `src/app/LiveProvider.tsx`에 `changedSeqs`를 컨텍스트로 추가한다(값 = coverage.changedSeqs).

- [ ] Step 1 실패 테스트: (a) 픽스처 기록 seq 10의 text를 "Thanks!"로 바꾸면 `seen`에 `map:2:1:0#12`가 남고 `changedSeqs`에 10, `uncertainSeqs`에 없음. (b) seq 3의 face를 "Other"로 바꾸면 uncertain. (c) seq 7 choices options를 ["Yes","No"]로 바꾸면 changed, ["a"]로 바꾸면 uncertain(optionCount). (d) `explainRecord`가 각 경우 reason과 문장을 돌려줌. (e) foldTimeline record 항목 `changed` 플래그.
- [ ] Step 2 FAIL → Step 3 구현 → Step 4 `npx vitest run`, `npx tsc -b --noEmit` → Step 5 커밋 `feat(core): structural record matching, mismatch explanations`

### Task 2: 현재 페이지·맵별 새것·남은 대본 (core)

**Files:** Create `src/core/live/interactable.ts`, `src/core/live/remaining.ts` + tests

**Interfaces — Produces:**
- `activePageIndex(ev: MapEvent, mapId: number, data: GameData, live: LiveSnapshot | null): number` — live null → -1. 마지막 페이지부터 `describePageConditions(pg.conditions, pg.trigger, data)` 중 `test.kind !== "trigger"`인 것을 `evaluate(test, live, {mapId, eventId: ev.id})`로 판정해 모두 `met`인 첫 페이지. `unknown`은 미충족. 없으면 -1.
- `export interface Interactable { eventId: number; page: number; title: string; location: Location; mark: "talk" | "auto" | "none"; unseen: number; unpicked: number; isNew: boolean }`
- `mapInteractables(data, index, coverage, live, mapId): Interactable[]` — live.mapId === mapId면 `live.events`의 page, 아니면 `activePageIndex`. page -1 이벤트는 제외. mark 규칙은 기존 `nowEvents`와 같음(trigger 0~2 + 대사 → talk, 3·4 → auto, 그 외 none). `unseen` = 그 페이지에서 선택지 분기 밖 message/scroll 중 `seen`에 없는 수. `unpicked` = 그 페이지 모든 choices의 안 고른 항목 수(취소 분기 포함, picked -2 매핑). `isNew` = mark !== "none" && (unseen > 0 || unpicked > 0). title은 PageEntry.title.
- `mapNewCounts(data, index, coverage, live): Map<number, number>` — 로드된 모든 맵에 대해 isNew 이벤트 수(0이면 넣지 않음). live null → 빈 Map.
- remaining.ts: `remainingNodes(nodes: ScriptNode[], cmd: number): ScriptNode[]` — cmd를 가진 노드 중 `cmd <= 주어진 cmd`인 문서 순서상 마지막 노드를 현재 위치로 보고, 그 노드부터 현재 블록 끝까지 + 바깥 블록들의 그 다음 노드들을 평탄하게 이어 붙인다. 선택지 분기 안이면 그 분기 나머지 다음에 선택지 노드 **다음** 형제로 이어진다(다른 분기 제외). 조건 분기도 같은 방식. 반복은 반복 블록 나머지 후 반복 노드 다음으로. 해당 노드가 없으면 전체 nodes 반환. 예외 금지.

- [ ] Step 1 실패 테스트 (sample-mz + fixtureLive): `activePageIndex(EV1)` = 1(숲 개방 ON), 스위치 OFF인 live면 0; `mapInteractables(...,2)` → EV1 page1 talk, EV3 page0 talk, 픽스처 전체 기록 기준 EV1 p1은 본 대사라 isNew false, EV3도 false; 기록 일부(seq ≤ 11)만이면 EV3 isNew true(unseen 1); `mapNewCounts`가 맵 3(문, 대사 없음)을 세지 않음. `remainingNodes(ev1p0, 12)` → 첫 노드가 cmd 12 메시지, 그 다음 kind들이 `["message","stateChange","conditional","scroll","commonEvent","other","transfer"]`; cmd 0 → 원본 nodes와 같음; cmd 99 → 마지막 cmd 노드(27 scroll)부터.
- [ ] Step 2 FAIL → Step 3 구현 → Step 4 test/tsc → Step 5 커밋 `feat(core): active pages, new interactables per map, remaining script`

### Task 3: 플러그인 1.0.2 — runningCmd, 가장 안쪽 인터프리터

**Files:** Modify `plugin/RPGViewerBridge.js`, `tests/plugin/harness.ts`, `tests/plugin/bridge.test.ts`

- 스냅샷: `$gameMap._interpreter`에서 `_childInterpreter`가 실행 중이면 계속 따라 내려가 가장 안쪽 인터프리터의 `_rpgvSrc`를 `running`, `_index`를 `runningCmd`로. 실행 중 아니면 둘 다 null. 전투 중이면 `$gameTroop._interpreter` 기준(같은 규칙).
- VERSION `"1.0.2"`. 다른 동작 변경 없음.
- [ ] 테스트: 맵 이벤트 실행 중 → running=맵 src, runningCmd=_index; 117로 공통 이벤트 자식 실행 중 → running=common src, runningCmd=자식 _index; 비실행 → null/null; VERSION 1회.
- [ ] test/lint → 커밋 `feat(plugin): runningCmd and innermost interpreter source (1.0.2)`

### Task 4: 폴더 접근 안내 + 불일치 Popover

**Files:** Create `src/ui/fsAccess.ts`(+test); Modify `src/ui/StartScreen.tsx`, `src/ui/live/InstallDialog.tsx`, `src/ui/live/TimelineItem.tsx`; shadcn `popover` 추가 가능

- `fsAccessSupport(w: { showDirectoryPicker?: unknown; navigator?: { brave?: unknown } }): { supported: boolean; message: string | null }` — supported면 message null, 아니면 Global Constraints의 두 문장을 공백으로 이은 것(Brave 여부로 둘째 문장 선택). 테스트 3가지.
- StartScreen: 미지원이면 "게임 폴더 열기" 위에 `Alert`로 message. InstallDialog의 미지원 안내를 같은 message로.
- TimelineItem: `uncertain` 또는 `changed` 항목의 Badge(`위치 불확실` outline / `실행 중 변경됨` secondary)를 Popover 트리거로; 내용은 `reasonLabel` + `기록` / `데이터` 두 블록(whitespace-pre-line). `changed`인 항목은 링크 유지.
- [ ] test/build/lint → 커밋 `feat(ui): folder-access notice and record mismatch popover`

### Task 5: 지금 그룹 새것 표시 + 맵 트리 새 N

**Files:** Modify `src/ui/live/NowGroup.tsx`, `src/ui/AppSidebar.tsx`, `src/ui/live/annotations.ts`(필요 시 nowEvents를 mapInteractables로 대체)

- NowGroup: `mapInteractables(data, index, coverage, live, live.mapId)` 사용. 각 항목 오른쪽에 `새 대화`(unseen>0) / `선택지 {N}`(unpicked>0) Badge(secondary, text-xs). 헤더에 `안 본 것만` Switch(기본 꺼짐) — 켜면 isNew만.
- AppSidebar 맵 행: `liveHintsEnabled && connection==="connected"`일 때 `mapNewCounts`의 값이 있으면 이름 옆 `새 {N}` Badge(outline, text-xs). 계산은 useMemo([data,index,coverage,live]).
- [ ] annotations 관련 테스트 갱신, test/build/lint → 커밋 `feat(ui): new interactables in now group and map tree`

### Task 6: "지금 이후" 카드

**Files:** Create `src/ui/live/NowNextCard.tsx`; Modify `src/ui/live/HistoryView.tsx`(카드 배치만)

- live?.running과 페이지(PageEntry) 찾기 → `runningCmd`가 number면 `remainingNodes(entry.nodes, runningCmd)`를 기존 `ScriptView`로 렌더(ScriptLocation = entry.location이 제공되도록 — 기존 ScriptView 사용법을 따른다). 카드 제목 `지금 이후`, 부제 entry.path, 버튼 `탐색기에서 보기`(openPage + highlightNode(locationKey, findNodePathByCmd(entry.nodes, 현재 노드 cmd))). runningCmd가 undefined(구 플러그인)면 `플러그인을 업데이트하면 이후 대사를 볼 수 있어요`. running이 null이면 카드 숨김. 남은 노드가 길면 max-h + ScrollArea.
- HistoryView: 맨 위에 NowNextCard, 그 아래 기존 ChoiceNowCard.
- [ ] build/lint → 커밋 `feat(ui): now-next card`
