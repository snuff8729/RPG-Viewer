# RPG Viewer 2단계 (실시간 + 기록) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 게임 플러그인이 남기는 기록·상태 파일을 뷰어가 읽어, 실시간 상호작용 표시, 회차·갈래별 기록, 고른 선택지·본 대사 표시, 못 본 것 목록을 제공한다.

**Architecture:** `plugin/RPGViewerBridge.js`(엔진 훅 → `rpg-viewer/log.jsonl`, `live.json`)와 뷰어의 순수 로직 `src/core/live/*`(파싱·갈래·접기·진행도·판정·못 본 것·설치기·LogTail), React 상태 `src/app/LiveProvider.tsx`, 화면 `src/ui/live/*`로 나눈다. 데이터 계약은 `src/core/live/types.ts` 하나에 고정한다.

**Tech Stack:** 기존(Vite, React, TS, shadcn/ui, Vitest). 플러그인은 의존성 없는 ES2015 JS.

**Spec:** `docs/superpowers/specs/2026-10-28-rpg-live-history-design.md`

## Global Constraints

- 1단계 Global Constraints 전부 유지: shadcn 컴포넌트·공식 예제 디자인만, 커스텀 토큰 금지; `src/core/**`는 react/window/document/indexedDB 참조 금지; 로더·해석기·색인·기록 처리 로직은 예외를 던지지 않는다; 화면 문구 한국어.
- 화면 문구(정확히): `탐색기`, `기록`, `못 본 것`, `● 연결됨 · {run}회차 갈래 {n}`, `○ 게임 꺼짐 · 마지막 기록 {N}분 전`(1분 미만은 `방금`), `플러그인 미설치`, `지금`, `따라가기`, `아직 안 고름`, `{run}회차 갈래 {n}`, `↻ 같은 대화 다시 봄 ×{N}`, `⚙ 상태 변경 {N}개`, `갈래 {N}개 ⇄`, `지금 선택지`, `지금 이 맵`, `지금 갈 수 있는 것만`, `안 고른 선택지 항목`, `안 본 대사가 있는 페이지`, `위치 불확실`, `이 게임은 자동 설치를 지원하지 않아요`, `쓰기 권한이 필요해요`.
- 갈래 번호 `n`은 run 안에서 생성 순서(1부터). `unknownSave`로 시작한 run도 같은 규칙.
- 플러그인은 게임을 절대 멈추게 하면 안 된다: 모든 훅 본문 try/catch, 실패 시 원래 함수 동작 보장.
- 테스트: `npx vitest run`. 빌드: `npm run build`. 린트: `npm run lint` 오류 0.
- 커밋 메시지 끝: 빈 줄 + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **명령 번호 어긋남** — 게임이 업데이트되어 `cmd`가 다른 명령을 가리킬 때 진행도·이동 링크가 엉뚱한 곳을 가리키면 안 된다. (Task 5 테스트)
2. **긴 기록** — 수만 줄 기록에서 폴링 한 번이 전체를 다시 파싱하면 안 된다(증분). 갈래 모델 재계산은 O(n)이어야 한다. (Task 7 테스트: 두 번째 poll은 새 바이트만)
3. **UTF-8 경계** — 한글 대사의 멀티바이트 문자가 읽기 경계에서 잘려도 깨지면 안 된다. (Task 7 테스트)
4. **플러그인 설치가 다른 플러그인 설정을 망가뜨림** — `plugins.js`의 다른 항목과 파라미터가 바이트 단위로 보존되어야 한다(포맷만 RPG Maker 형식으로 재작성). (Task 6 테스트)
5. **로드 직후 기록 순서** — 로드 시 `branchStart`가 `load`보다 먼저, 새 갈래 번호로 기록되어야 한다; 세이브 스탬프 없는 로드는 새 run. (Task 3 테스트)

---

## File Structure

```
plugin/RPGViewerBridge.js            게임 플러그인 (단일 파일)
tests/plugin/harness.ts              가짜 엔진 전역 + 메모리 fs
tests/plugin/bridge.test.ts
tests/fixtures/logs/sample-mz.log.jsonl, sample-mz.live.json   공용 기록 픽스처
tests/helpers/fixtureLog.ts          픽스처 기록 로드 헬퍼
src/core/live/types.ts               데이터 계약 (기록, 스냅샷, 모델 타입)
src/core/live/log.ts                 줄 파싱
src/core/live/history.ts             갈래 트리, 타임라인, 접기, 갈래 라벨
src/core/live/coverage.ts            본 대사·고른 선택지·결과 요약
src/core/live/evaluate.ts            조건 판정
src/core/live/missing.ts             못 본 것
src/core/live/installer.ts           plugins.js 등록/해제
src/core/live/tail.ts                LogTail, readLive
src/core/fs/folder.ts, browserFolders.ts   WritableGameFolder (수정)
src/core/types.ts, interpret/, conditions/  cmd, ConditionTest (수정)
src/app/LiveProvider.tsx, route.ts(수정), GameProvider.tsx(수정), devLive.ts
src/ui/live/LiveTabs.tsx, ConnectionBadge.tsx, InstallDialog.tsx
src/ui/live/NowGroup.tsx             사이드바 "지금"
src/ui/live/HistoryView.tsx, ChoiceNowCard.tsx, TimelineItem.tsx
src/ui/live/MissingView.tsx
docs/live-checklist.md
```

## 실행 웨이브 (병렬)

- **Wave A (병렬):** Task 1, Task 2, Task 3
- **Wave B (병렬, A 후):** Task 4, Task 5, Task 6 — 그 뒤 Task 7 (Task 4의 `parseLogText` 사용)
- **Wave C:** Task 8
- **Wave D (병렬, C 후):** Task 9, Task 10, Task 11
- **Wave E:** Task 12

---

### Task 1: 데이터 계약 + 해석기·조건 확장 + 공용 기록 픽스처

**Files:**
- Create: `src/core/live/types.ts`, `tests/fixtures/logs/sample-mz.log.jsonl`, `tests/fixtures/logs/sample-mz.live.json`, `tests/helpers/fixtureLog.ts`
- Modify: `src/core/types.ts`, `src/core/interpret/interpret.ts`, `src/core/conditions/describe.ts`, 관련 테스트, `src/core/index/buildIndex.ts`(헬퍼 export만)
- Test: `src/core/interpret/interpret.test.ts`, `src/core/conditions/describe.test.ts`, `src/core/live/fixture.test.ts`

**Interfaces — Produces** (`src/core/live/types.ts`, 그대로 작성):

```ts
import type { GameData, Location, PageEntry } from "../types";

export interface RecordBase { v: 1; seq: number; t: number; run: number; branch: number }
export interface StateChange { kind: "switch" | "variable" | "selfSwitch"; id: number | string; value: number | boolean }
export type LogRecord = RecordBase & (
  | { type: "branchStart"; reason: "newGame" | "load" | "unknownSave"; parentBranch: number | null; fromSeq: number | null }
  | { type: "message"; src: Location | null; cmd: number; face: string; faceIndex: number; speaker: string; text: string }
  | { type: "scroll"; src: Location | null; cmd: number; text: string }
  | { type: "choices"; src: Location | null; cmd: number; options: string[] }
  | { type: "choice"; src: Location | null; cmd: number; picked: number }
  | { type: "picture"; src: Location | null; cmd: number; pictureId: number; name: string }
  | { type: "transfer"; mapId: number; x: number; y: number }
  | { type: "battle"; phase: "start" | "end"; troopId: number; result?: "win" | "escape" | "lose" }
  | { type: "state"; src: Location | null; cmd: number | null; changes: StateChange[] }
  | { type: "save"; slot: number }
  | { type: "load"; slot: number }
  | { type: "error"; message: string }
);
export type RecordOf<T extends LogRecord["type"]> = Extract<LogRecord, { type: T }>;

export interface LiveSnapshot {
  v: 1; t: number; pluginVersion: string;
  run: number | null; branch: number | null; seq: number;
  mapId: number; x: number; y: number;
  running: Location | null;
  events: { eventId: number; page: number }[];   // page 0부터, -1 = 없음
  switches: number[];                             // ON인 id
  variables: Record<string, number>;              // 0이 아닌 값
  selfSwitches: string[];                         // ON인 "mapId,eventId,A"
  items: Record<string, number>; weapons: Record<string, number>; armors: Record<string, number>;
  gold: number; party: number[];
  choice: { src: Location | null; cmd: number; options: string[] } | null;
  inBattle: boolean;
}

export interface BranchInfo {
  id: number; run: number; parent: number | null; fromSeq: number | null;
  reason: "newGame" | "load" | "unknownSave";
  startSeq: number; startT: number; lastSeq: number; lastT: number; children: number[];
}
export interface HistoryModel {
  branches: Map<number, BranchInfo>;
  runs: { run: number; branches: number[] }[];   // run 오름차순, branches 생성 순
  latestBranch: number | null;                   // 가장 최근 기록이 속한 갈래
}
export type HistoryItem =
  | { kind: "record"; record: LogRecord; uncertain: boolean }
  | { kind: "repeat"; record: RecordOf<"message">; count: number }
  | { kind: "stateGroup"; records: RecordOf<"state">[]; count: number }
  | { kind: "fork"; atSeq: number; branches: number[] };

export interface PickInfo { picked: number; run: number; branch: number; seq: number; aftermath: string[] }
export interface Coverage {
  seen: Set<string>;               // `${locationKey(src)}#${cmd}` (message, scroll)
  picks: Map<string, PickInfo[]>;  // `${locationKey(src)}#${cmd}` (choices 명령) → 선택들
  uncertainSeqs: Set<number>;      // 원문 불일치로 제외한 기록 seq
}

export type EvalStatus = "met" | "unmet" | "unknown";
export interface Requirement { text: string; status: EvalStatus }
export interface MissingItem {
  kind: "choice" | "page";
  entry: PageEntry; nodePath: number[];
  label: string;
  requirements: Requirement[];
  onCurrentMap: boolean; allMet: boolean;
}
export type { GameData };
```

`src/core/types.ts` 수정:
- `ScriptNode`의 `message`, `scroll`, `choices`, `picture`에 `cmd: number` 추가.
- `Condition`에 `test?: ConditionTest` 추가, 그리고:
```ts
export type CompareOp = "=" | ">=" | "<=" | ">" | "<" | "!=";
export type ConditionTest =
  | { kind: "switch"; id: number; on: boolean }
  | { kind: "variable"; id: number; op: CompareOp; value: number }
  | { kind: "variableVar"; id: number; op: CompareOp; otherId: number }
  | { kind: "selfSwitch"; letter: string; on: boolean }
  | { kind: "item" | "weapon" | "armor"; id: number }
  | { kind: "actorInParty"; id: number }
  | { kind: "gold"; op: ">=" | "<=" | "<"; value: number }
  | { kind: "trigger" }
  | { kind: "unknown" };
```
- `describe*`가 모든 Condition에 `test`를 채운다: 페이지 변수 조건은 `op ">="`, 트리거·범위·턴 류는 `{kind:"trigger"}`, 표현 못 하는 것(타이머, 적, 방향, 버튼, 스크립트, 탈것, 배우의 기타 subtype, 전투 조건, 알 수 없음)은 `{kind:"unknown"}`.
- `src/core/interpret/interpret.ts`: 위 4종 노드에 `cmd` = 해당 101/105/102/231 명령의 원본 인덱스(`list` 기준). 그리고 `findNodePathByCmd(nodes: ScriptNode[], cmd: number): number[] | null` export (types.ts의 nodePath 규칙, cmd가 있는 노드 중 일치하는 첫 노드).
- `src/core/index/buildIndex.ts`: 내부 `walk`, `subBlocks`를 `export`(동작 변경 없음) — Task 5가 사용.

**기록 픽스처** `tests/fixtures/logs/sample-mz.log.jsonl` (sample-mz 게임 기준. `t`는 `1000000 + seq*1000`, 단 seq 15~26은 `1015000 + (seq-15)*1000`(12초 안에 12번). `E1 = {"source":"map","mapId":2,"eventId":1,"page":0}`, `E1p1 = {...page:1}`, `E3 = {"source":"map","mapId":2,"eventId":3,"page":0}`, `C1 = {"source":"common","commonEventId":1}`. 모든 줄 `"v":1`. run/branch는 괄호):

| seq | run/branch | 기록 |
|---|---|---|
| 1 | 1/1 | branchStart newGame parent null from null |
| 2 | 1/1 | message E1 cmd0 face "People1" 3 speaker "촌장" text `왔구나, \N[1].\n숲이 이상하다는 소문은 들었겠지?` |
| 3 | 1/1 | message E1 cmd3 face "Actor1" 0 speaker "" text `네… 밤마다 이상한 소리가 난다고요.` |
| 4 | 1/1 | message E1 cmd5 face "" 0 speaker "" text `(창밖에서 바람 소리가 들린다.)` |
| 5 | 1/1 | picture E1 cmd7 pictureId 1 name "village_map" |
| 6 | 1/1 | message E1 cmd8 "People1" 3 "촌장" `도와주겠나? \C[2]보상\C[0]은 \V[1]만큼.` |
| 7 | 1/1 | choices E1 cmd10 options ["네, 도울게요","생각해볼게요"] |
| 8 | 1/1 | save slot 1 |
| 9 | 1/1 | choice E1 cmd10 picked 0 |
| 10 | 1/1 | message E1 cmd12 "People1" 3 "촌장" `고맙네!` |
| 11 | 1/1 | state E1 cmd14 changes [{switch,1,true}] |
| 12 | 1/1 | message E3 cmd0 "" 0 "" `낡은 책이 꽂혀 있다. 숲의 전설에 대한 책이다.` |
| 13 | 1/1 | (12와 같은 내용) |
| 14 | 1/1 | (12와 같은 내용) |
| 15–26 | 1/1 | state src null cmd null changes [{variable,5,k}] (k = seq-14, 1..12) |
| 27 | 1/1 | transfer mapId 3 x 5 y 12 |
| 28 | 1/2 | branchStart load parent 1 from 8 |
| 29 | 1/2 | load slot 1 |
| 30 | 1/2 | choice E1 cmd10 picked 1 |
| 31 | 1/2 | message C1 cmd0 "" 0 "" `밤이 깊었다.` |
| — | — | 깨진 줄: `{broken` |
| 32 | 2/3 | branchStart unknownSave parent null from null |
| 33 | 2/3 | load slot 2 |
| 34 | 2/3 | message E1p1 cmd0 "People1" 3 "촌장" `숲을 부탁하네.` |
| 35 | 2/3 | error message "test error" |

(텍스트의 `\N[1]` 등은 JSON 안에서 `\\N[1]`, 줄바꿈은 `\n`.)

`sample-mz.live.json`: `{v:1, t:1031000, pluginVersion:"1.0.0", run:1, branch:2, seq:31, mapId:2, x:12, y:8, running:null, events:[{eventId:1,page:1},{eventId:3,page:0}], switches:[1], variables:{"1":3}, selfSwitches:[], items:{"1":1}, weapons:{}, armors:{}, gold:100, party:[1], choice:null, inBattle:false}`

`tests/helpers/fixtureLog.ts`: `fixtureLogText(): string`(파일 원문), `fixtureLive(): LiveSnapshot`. 그리고 테스트 편의 `fixtureRecords(): LogRecord[]`는 각 줄 `JSON.parse`(깨진 줄 건너뜀) — Task 4의 파서에 의존하지 않는다.

- [ ] **Step 1: 실패 테스트**
```ts
// interpret.test.ts 추가/수정 (기존 toEqual 기대값에 cmd 반영)
it("records source command index", () => {
  expect(nodes.filter(n => "cmd" in n).map(n => [n.kind, (n as any).cmd]))
    .toEqual([["message",0],["message",3],["message",5],["picture",7],["message",8],["choices",10],["scroll",27]]);
  expect(((nodes[5] as any).branches[0].body[0]).cmd).toBe(12);
  expect(((nodes[6] as any).then[0]).cmd).toBe(20);
});
it("findNodePathByCmd", () => {
  expect(findNodePathByCmd(nodes, 12)).toEqual([5, 0, 0]);
  expect(findNodePathByCmd(nodes, 20)).toEqual([6, 0, 0]);
  expect(findNodePathByCmd(nodes, 99)).toBeNull();
});
// describe.test.ts 추가
it("attaches tests", () => {
  expect(describeBranchCondition([1,1,0,5,1], data).test).toEqual({ kind:"variable", id:1, op:">=", value:5 });
  expect(describeBranchCondition([0,2,1], data).test).toEqual({ kind:"switch", id:2, on:false });
  expect(describeBranchCondition([12,"x"], data).test).toEqual({ kind:"unknown" });
  expect(describePageConditions({ ...emptyConds, switch1Valid:true, switch1Id:1 }, 0, data).map(c => c.test))
    .toEqual([{ kind:"switch", id:1, on:true }, { kind:"trigger" }]);
});
// src/core/live/fixture.test.ts
it("fixture log has 35 records and one broken line", () => {
  expect(fixtureRecords()).toHaveLength(35);
  expect(fixtureLogText().split("\n").filter(l => l.trim()).length).toBe(36);
});
```
- [ ] **Step 2:** FAIL 확인 → **Step 3:** 구현(기존 테스트의 기대값에 `cmd`를 추가해 갱신) → **Step 4:** `npx vitest run` 전체 PASS, `npx tsc -b --noEmit`
- [ ] **Step 5:** 커밋 `feat(core): live data contract, command indices, condition tests, log fixture`

---

### Task 2: 쓰기 가능한 폴더

**Files:**
- Modify: `src/core/fs/folder.ts`, `src/core/fs/browserFolders.ts`
- Test: `src/core/fs/folder.test.ts`, `src/core/fs/browserFolders.test.ts`

**Interfaces — Produces** (`src/core/fs/folder.ts`):
```ts
export interface FileStat { size: number; lastModified: number }
export interface WritableGameFolder extends GameFolder {
  stat(path: string): Promise<FileStat | null>;
  readRange(path: string, start: number, end: number): Promise<ArrayBuffer | null>; // [start, end)
  writeText(path: string, text: string): Promise<boolean>;   // 상위 폴더 생성, 성공 여부
  remove(path: string): Promise<boolean>;
  canWrite(): Promise<boolean>;      // 권한 조회(요청 안 함)
  requestWrite(): Promise<boolean>;  // 권한 요청(사용자 제스처 안에서 호출)
}
export function isWritableFolder(f: GameFolder): f is WritableGameFolder;
```
- `MemoryFolder` 구현: `stat.size`는 UTF-8 바이트 길이, `lastModified`는 쓰기마다 증가하는 카운터; `canWrite/requestWrite` → true. 테스트용 `appendText(path, text)` 추가.
- `DirectoryHandleFolder` 구현: 대소문자 무시 경로 해석 재사용. `writeText`는 `getDirectoryHandle(name, {create:true})`/`getFileHandle(name,{create:true})` + `createWritable()`; 쓰기 후 해당 디렉터리의 이름 캐시 갱신. `stat`/`readRange`는 `getFile()` + `file.slice(start,end).arrayBuffer()`. 권한은 `queryPermission/requestPermission({mode:"readwrite"})`(없으면 false).
- `FileListFolder`는 구현하지 않는다(`isWritableFolder` false).

- [ ] **Step 1: 실패 테스트**
```ts
it("memory folder write/stat/readRange/remove", async () => {
  const f = new MemoryFolder({});
  expect(await f.writeText("rpg-viewer/a.txt", "가나")).toBe(true);
  expect(await f.stat("rpg-viewer/a.txt")).toMatchObject({ size: 6 });
  f.appendText("rpg-viewer/a.txt", "다");
  expect(new TextDecoder().decode((await f.readRange("rpg-viewer/a.txt", 6, 9))!)).toBe("다");
  expect(await f.list("rpg-viewer")).toEqual(["a.txt"]);
  expect(await f.remove("rpg-viewer/a.txt")).toBe(true);
  expect(await f.stat("rpg-viewer/a.txt")).toBeNull();
});
it("lastModified increases on write", async () => { /* 두 번 쓰고 비교 */ });
it("isWritableFolder", () => { expect(isWritableFolder(new MemoryFolder({}))).toBe(true); });
// browserFolders.test.ts: 기존 가짜 핸들에 getFile/createWritable/removeEntry/getDirectoryHandle({create}) 흉내를 추가해
// writeText가 없는 하위 폴더를 만들고, 대소문자 다른 기존 파일에 덮어쓰는지, stat/readRange 확인
```
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS (`npx vitest run src/core/fs`, 전체, tsc)
- [ ] **Step 5:** 커밋 `feat(core): writable game folder`

---

### Task 3: 게임 플러그인 RPGViewerBridge.js

**Files:**
- Create: `plugin/RPGViewerBridge.js`, `tests/plugin/harness.ts`, `tests/plugin/bridge.test.ts`

**Interfaces:**
- Consumes: 스펙의 데이터 계약(위 Task 1 `LogRecord`/`LiveSnapshot`와 동일한 JSON 모양). Task 1 코드를 import하지 않는다(플러그인은 독립 JS). 테스트에서만 `LogRecord` 타입을 import해도 된다.
- Produces: 파일 첫 주석 블록에 RPG Maker 플러그인 헤더(`/*: @target MZ MV`, `@plugindesc RPG Viewer 기록 플러그인`, `@author RPG Viewer`). 전역 `RPGViewerBridge = { VERSION: "1.0.0", _flushNow(), _snapshotNow() }` — 뷰어 설치기는 정규식 `/RPGViewerBridge\.VERSION\s*=\s*"([^"]+)"/` 또는 객체 리터럴 `VERSION: "x"`를 읽으므로 **소스에 정확히 `VERSION: "1.0.0"` 형태 한 번**만 둔다.

**동작 규칙 (플러그인 구현자가 결정할 수 없는 것들):**
- 환경: `require("fs")`, `require("path")`, 기준 폴더 `path.dirname(process.mainModule.filename)`. 테스트 주입: 로드 전에 `globalThis.__RPGV_TEST__ = { fs, path, baseDir, now }`가 있으면 그것을 사용하고 타이머를 만들지 않는다.
- 파일: `<base>/rpg-viewer/meta.json`(`{nextRun, nextBranch, nextSeq}`, 없으면 1,1,1), `log.jsonl`(append), `live.json`(`live.json.tmp`에 쓰고 rename). 폴더 없으면 생성.
- 현재 run/branch는 처음 null. `branchStart`가 생기기 전(타이틀)에는 `error` 외 기록을 쓰지 않는다.
- 출처 해석: `Game_Interpreter.prototype.setup(list, eventId)` 래핑 — **list 객체 동일성**으로 찾는다: `eventId > 0`이고 `$gameMap.event(eventId)` 페이지 중 `page.list === list`면 `{source:"map", mapId:$gameMap.mapId(), eventId, page}`; 아니면 `$dataCommonEvents` 중 `ce.list === list`면 `{source:"common", commonEventId}`; 아니면 `$gameTroop.troop().pages` 중 일치하면 `{source:"troop", troopId, page}`; 없으면 null. `this._rpgvSrc`에 저장.
- 명령 위치: 훅은 `this._list[this._index]`가 해당 코드인지 확인하고 `cmd = this._index`. 대사 원문은 `this._list`에서 이어지는 401(105는 405) 파라미터를 `\n`으로 연결. `face=params[0]`, `faceIndex=params[1]`, `speaker=params[4] ?? ""`.
- 훅 대상: `command101`, `command102`(+ `$gameMessage` 선택 콜백을 감싸 확정 시 `choice` 기록, `picked = n`), `command105`, `command231`, `Game_Player.prototype.performTransfer`(호출 전 `isTransferring()`이었으면 호출 후 `transfer{mapId:$gameMap.mapId(), x, y}`), `BattleManager.setup`(start, troopId), `BattleManager.endBattle(result)`(0 win, 1 escape, 2 lose), `Game_Switches/Game_Variables/Game_SelfSwitches.prototype.setValue`(값이 실제로 바뀔 때만; selfSwitch id는 키 배열을 `join(",")`), `DataManager.setupNewGame`(새 run·branch, `branchStart newGame`), `DataManager.makeSaveContents`(결과에 `rpgViewer:{run,branch,seq:마지막 seq}`), `DataManager.saveGame(id)`(`save{slot:id}`), `DataManager.extractSaveContents(contents)`(스탬프 있으면 `branchStart{reason:"load", run:스탬프.run, parentBranch:스탬프.branch, fromSeq:스탬프.seq}`, 없으면 새 run의 `unknownSave`; 새 branch id 발급), `DataManager.loadGame(id)`(성공 후 `load{slot:id}` — 반드시 `branchStart` 뒤).
- 상태 변경 묶음: 현재 실행 중 인터프리터의 `{src, cmd}`(`executeCommand` 래핑으로 추적)를 붙여 버퍼링, 다음 비-state 기록이 생기거나 flush될 때 같은 `{src,cmd}`끼리 한 `state` 기록으로.
- 기록 쓰기: 메모리 버퍼 → 250ms마다(또는 `_flushNow()`) `appendFileSync` 한 번 + meta 갱신.
- 스냅샷: 250ms마다 계산, JSON이 직전과 다르면 쓰기; 아니어도 2초마다 `t` 갱신해 쓰기. 필드 출처: `$gameMap.events()`의 `eventId()`/`_pageIndex`, `$gameSwitches._data`, `$gameVariables._data`, `$gameSelfSwitches._data`의 true 키, `$gameParty._items/_weapons/_armors/_gold/_actors`, `running` = `$gameMap._interpreter.isRunning() ? _rpgvSrc : null`, `choice` = `$gameMessage.isChoice()`면 마지막 `choices` 기록 내용, `inBattle` = `$gameParty.inBattle()`. 게임 객체가 아직 없으면(타이틀) 쓰지 않는다.
- 오류: 모든 훅 try/catch → 원래 함수는 반드시 호출/반환. `error` 기록은 초당 1회 제한.
- 문법: ES2015 이하(MV의 오래된 NW.js 호환), 모듈 문법 금지, IIFE.

**테스트 harness** (`tests/plugin/harness.ts`): `createHarness({ engine: "MZ" | "MV" })` → 최소 가짜 전역(`Game_Interpreter` 생성자와 setup/executeCommand/command101/102/105/231 기본 구현, `Game_Message`/`$gameMessage`(setChoiceCallback/onChoice/isChoice), `Game_Switches/Variables/SelfSwitches`, `Game_Player`, `$gameMap`(mapId, event(id), events(), _interpreter), `$gameParty`, `$gameTroop`, `$dataCommonEvents`, `DataManager`(setupNewGame, makeSaveContents, extractSaveContents, saveGame, loadGame), `BattleManager`), 메모리 fs(`appendFileSync`, `writeFileSync`, `readFileSync`, `existsSync`, `mkdirSync`, `renameSync`), 그리고 플러그인 소스를 `vm.runInThisContext` 또는 `new Function`으로 실행. 헬퍼 `runCommand(interp, index)`, `readLog(): LogRecord[]`, `readLive()`.

- [ ] **Step 1: 실패 테스트** (`tests/plugin/bridge.test.ts`)
```ts
it("writes nothing before a branch starts", ...)               // 타이틀에서 setValue → 기록 없음
it("new game starts run 1 branch 1", ...)                      // [branchStart newGame run1 branch1 parent null from null]
it("records a message with source and cmd", ...)               // map 이벤트 list에 101+401+401 → message{src:{map..}, cmd:0, text:"a\nb", speaker(MZ params[4])}
it("resolves common event source by list identity", ...)       // setup($dataCommonEvents[1].list, 0) → src common 1
it("records choices and the picked index", ...)                // 102 → choices; onChoice(1) → choice picked 1; onChoice(-2) → picked -2
it("groups state changes per frame with source", ...)          // 같은 프레임 setValue 2번 → state 1줄 changes 2개
it("ignores setValue with unchanged value", ...)
it("stamps saves and branches on load", ...)                   // save 후 makeSaveContents에 rpgViewer{run1,branch1,seq}; extractSaveContents → branchStart load parent1 fromSeq; loadGame → load 기록이 branchStart 뒤
it("unknown save starts a new run", ...)                       // 스탬프 없는 contents → run 2 unknownSave
it("continues seq across restarts via meta.json", ...)         // harness 재생성(같은 fs) → seq 이어짐
it("writes live snapshot atomically", ...)                     // _snapshotNow() → live.json 모양(필드 전부), tmp 남지 않음
it("never throws from hooks", ...)                             // $gameMap.event가 throw해도 command101 원래 동작 수행
it("exposes VERSION once", ...)                                 // 소스에서 /VERSION:\s*"1\.0\.0"/ 매치 1회
```
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** `npx vitest run tests/plugin` PASS, 전체 PASS, lint 0 오류(필요하면 `plugin/`을 oxlint 대상에서 브라우저 전역 허용 설정만 추가)
- [ ] **Step 5:** 커밋 `feat(plugin): RPGViewerBridge game plugin`

---

### Task 4: 기록 파싱 + 갈래 모델 + 타임라인 접기

**Files:**
- Create: `src/core/live/log.ts`, `src/core/live/history.ts`
- Test: `src/core/live/log.test.ts`, `src/core/live/history.test.ts`

**Interfaces:**
- Consumes: Task 1 타입, `locationKey`(src/core/index/locations.ts), 픽스처 헬퍼, 이름 헬퍼(names.ts)
- Produces:
  - `parseLogText(text: string): { records: LogRecord[]; badLines: number }` — 빈 줄 무시, JSON 실패·`v!==1`·`type` 없음은 badLines.
  - `buildHistory(records: LogRecord[]): HistoryModel` — `branchStart`로 갈래 생성, 그 외 기록으로 lastSeq/lastT 갱신. run 0/branch 0 기록 무시. parent의 `children`에 추가.
  - `branchPath(records: LogRecord[], model: HistoryModel, branchId: number): LogRecord[]` — 조상 갈래들의 기록(각각 자식의 `fromSeq` 이하) + 자기 기록, seq 순. 같은 run의 조상만.
  - `foldTimeline(path: LogRecord[], model: HistoryModel, opts: { uncertainSeqs?: Set<number> }): HistoryItem[]` — 스펙의 접기 규칙 1~3 + fork 삽입. **에피소드** = 같은 `src`를 가진 연속된 message/scroll/choices/choice/picture 기록 중 `cmd`가 엄격히 증가하는 최대 구간(같은 페이지를 다시 실행하면 cmd가 줄거나 같아져 새 에피소드). 반복 판정 시그니처 = 에피소드의 message `cmd` 목록. fork 삽입: 경로상의 기록 seq가 어떤 갈래의 `fromSeq`와 같고 그 갈래의 parent가 그 기록의 branch면, 그 기록 뒤에 `{kind:"fork", atSeq, branches:[경로에서 이어지는 갈래(parent 자신이면 parent id), ...형제 갈래 id 오름차순]}`. `branchStart`, `load`, `error` 기록은 `record` 항목으로 남긴다(화면에서 표시 방식 결정).
  - `branchLabel(model: HistoryModel, branchId: number): string` → `"{run}회차 갈래 {n}"`.
  - `noisyVariables(records: LogRecord[]): Set<number>` — 어떤 60초 창 안에 10회 초과 변경된 변수 id.

- [ ] **Step 1: 실패 테스트**
```ts
it("parses fixture with one bad line", () => {
  const r = parseLogText(fixtureLogText());
  expect(r.records).toHaveLength(35); expect(r.badLines).toBe(1);
});
it("builds branches", () => {
  const m = buildHistory(fixtureRecords());
  expect([...m.branches.keys()]).toEqual([1, 2, 3]);
  expect(m.branches.get(2)).toMatchObject({ run: 1, parent: 1, fromSeq: 8, reason: "load" });
  expect(m.branches.get(1)!.children).toEqual([2]);
  expect(m.runs).toEqual([{ run: 1, branches: [1, 2] }, { run: 2, branches: [3] }]);
  expect(m.latestBranch).toBe(3);
});
it("labels", () => { const m = buildHistory(fixtureRecords());
  expect(branchLabel(m, 2)).toBe("1회차 갈래 2"); expect(branchLabel(m, 3)).toBe("2회차 갈래 1"); });
it("branch path includes ancestor up to fromSeq", () => {
  const recs = fixtureRecords(); const m = buildHistory(recs);
  expect(branchPath(recs, m, 2).map(r => r.seq)).toEqual([1,2,3,4,5,6,7,8,28,29,30,31]);
});
it("noisy variables", () => expect(noisyVariables(fixtureRecords())).toEqual(new Set([5])));
it("folds branch 1", () => {
  const recs = fixtureRecords(); const m = buildHistory(recs);
  const items = foldTimeline(branchPath(recs, m, 1), m, {});
  expect(items.map(i => i.kind === "record" ? i.record.seq : i.kind)).toEqual(
    [1,2,3,4,5,6,7,8,"fork",9,10,11,12,"repeat",27]);
  expect(items.find(i => i.kind === "repeat")).toMatchObject({ count: 2 });
  expect(items.find(i => i.kind === "fork")).toMatchObject({ atSeq: 8, branches: [1, 2] });
});
it("groups unrelated state changes", () => {
  const base = { v: 1, run: 1, branch: 1 } as const;
  const recs = [ { ...base, seq: 1, t: 0, type: "branchStart", reason: "newGame", parentBranch: null, fromSeq: null },
    { ...base, seq: 2, t: 0, type: "state", src: null, cmd: null, changes: [{ kind: "switch", id: 2, value: true }] },
    { ...base, seq: 3, t: 0, type: "state", src: null, cmd: null, changes: [{ kind: "switch", id: 3, value: true }] } ] as LogRecord[];
  const items = foldTimeline(recs, buildHistory(recs), {});
  expect(items[1]).toMatchObject({ kind: "stateGroup", count: 2 });
});
it("marks uncertain records", () => { /* uncertainSeqs {2} → seq 2 record item uncertain true */ });
```
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS, tsc
- [ ] **Step 5:** 커밋 `feat(core): log parsing, branch model, timeline folding`

---

### Task 5: 진행도 + 조건 판정 + 못 본 것

**Files:**
- Create: `src/core/live/coverage.ts`, `src/core/live/evaluate.ts`, `src/core/live/missing.ts`
- Test: `src/core/live/coverage.test.ts`, `evaluate.test.ts`, `missing.test.ts`

**Interfaces:**
- Consumes: Task 1 타입·`cmd`·`ConditionTest`·`findNodePathByCmd`·`walk`/`subBlocks`, `buildIndex`, `locationKey`, names.ts, `formatText`
- Produces:
  - `pageList(data: GameData, loc: Location): EventCommand[] | null`
  - `computeCoverage(records: LogRecord[], data: GameData): Coverage` — 검증: `message`는 `list[cmd].code===101`이고 `list[cmd+1]`(401) 원문이 `text`의 첫 줄과 같을 때만; `scroll`은 105와 405 첫 줄; `choices`/`choice`는 102. 불일치·위치 없음은 `uncertainSeqs`에 추가하고 제외. `picks` 키는 choices 명령 위치. `aftermath`: 같은 branch에서 그 choice 뒤, 다음 `choice` 전까지 순서대로 최대 3개 — 첫 `message`는 `{speaker||"(내레이션)"}: "{formatText 첫 줄}"`, `state`의 switch 변경은 `스위치 {이름} → ON/OFF`, `transfer`는 `🚪 {맵 이름} 이동`. 그 외 기록(변수 변경 등)은 세지 않는다.
  - `evaluate(test: ConditionTest | undefined, live: LiveSnapshot | null, ctx: { mapId?: number; eventId?: number }): EvalStatus` — live null·test 없음·`unknown` → `"unknown"`; `trigger` → `"met"`; selfSwitch는 ctx 필요(없으면 unknown), 키 `${mapId},${eventId},${letter}`; item/weapon/armor는 개수 > 0; variable 비교는 없으면 0.
  - `computeMissing(index: GameIndex, data: GameData, coverage: Coverage, live: LiveSnapshot | null): MissingItem[]` — 스펙 규칙. 선택지 항목 라벨 `"{option label}"`(따옴표 포함), 취소 분기는 `취소했을 때`. 요구 조건: 페이지 조건 중 `test.kind !== "trigger"`인 것 + 감싸는 conditional(then: 조건 그대로 / else: `아니라면: {text}` 판정 반전, unknown은 그대로) + 감싸는 선택지 분기(`선택지 "{label}" 선택`, unknown). `onCurrentMap` = live?.mapId === entry의 mapId. `allMet` = 요구 조건에 unmet·unknown 없음(빈 목록이면 true). 정렬: onCurrentMap 내림 → allMet 내림 → index.pages 순서 → nodePath 사전순.
  - `pickKey(loc: Location, cmd: number): string`, `seenKey` 동일 형식 — UI 공용.

- [ ] **Step 1: 실패 테스트**
```ts
it("coverage from fixture", () => {
  const c = computeCoverage(fixtureRecords(), data);
  expect([...c.seen].sort()).toEqual(["common:1#0","map:2:1:0#0","map:2:1:0#12","map:2:1:0#3","map:2:1:0#5","map:2:1:0#8","map:2:1:1#0","map:2:3:0#0"]);
  const picks = c.picks.get("map:2:1:0#10")!;
  expect(picks.map(p => [p.picked, p.branch])).toEqual([[0, 1], [1, 2]]);
  expect(picks[0].aftermath).toEqual(['촌장: "고맙네!"', "스위치 숲 개방 → ON", "🚪 숲 입구 이동"]);
  expect(c.uncertainSeqs.size).toBe(0);
});
it("excludes mismatched records", () => {
  const recs = fixtureRecords().map(r => r.seq === 10 ? { ...r, text: "다른 대사" } as LogRecord : r);
  const c = computeCoverage(recs, data);
  expect(c.seen.has("map:2:1:0#12")).toBe(false); expect(c.uncertainSeqs.has(10)).toBe(true);
});
it("evaluate", () => {
  const live = fixtureLive();
  expect(evaluate({ kind: "switch", id: 1, on: true }, live, {})).toBe("met");
  expect(evaluate({ kind: "variable", id: 1, op: ">=", value: 5 }, live, {})).toBe("unmet");
  expect(evaluate({ kind: "item", id: 1 }, live, {})).toBe("met");
  expect(evaluate({ kind: "selfSwitch", letter: "A", on: true }, live, { mapId: 2, eventId: 1 })).toBe("unmet");
  expect(evaluate({ kind: "unknown" }, live, {})).toBe("unknown");
  expect(evaluate({ kind: "switch", id: 1, on: true }, null, {})).toBe("unknown");
});
it("missing: unpicked choice option", () => {
  const recs = fixtureRecords().filter(r => r.seq <= 27);
  const m = computeMissing(buildIndex(data), data, computeCoverage(recs, data), fixtureLive());
  const ch = m.filter(i => i.kind === "choice");
  expect(ch.map(i => [i.entry.path, i.label, i.nodePath])).toEqual([["촌장의 집 › 촌장 › p1", '"생각해볼게요"', [5, 1]]]);
  expect(ch[0].onCurrentMap).toBe(true);
});
it("missing: unseen page lines with requirements", () => {
  const m = computeMissing(buildIndex(data), data, computeCoverage(fixtureRecords(), data), fixtureLive());
  const p = m.find(i => i.kind === "page" && i.entry.path === "촌장의 집 › 촌장 › p1")!;
  expect(p.label).toBe("이건 내 아내가 남긴 물건이네.");
  expect(p.requirements).toEqual([{ text: "변수: 호감도 ≥ 5", status: "unmet" }]);
  expect(p.allMet).toBe(false);
  expect(m.some(i => i.entry.path === "전투 › 슬라임 › p1")).toBe(true);
  expect(m.some(i => i.entry.path === "공통 이벤트 › 밤의 장면")).toBe(false);
});
it("missing without live is all unknown", () => { /* live null → onCurrentMap false, 요구 조건 status unknown */ });
```
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS, tsc
- [ ] **Step 5:** 커밋 `feat(core): coverage, condition evaluation, missing items`

---

### Task 6: 플러그인 설치기

**Files:**
- Create: `src/core/live/installer.ts`
- Test: `src/core/live/installer.test.ts`

**Interfaces:**
- Consumes: `WritableGameFolder`(Task 2), `GameData.dataRoot`
- Produces:
```ts
export const PLUGIN_NAME = "RPGViewerBridge";
export interface PluginEntry { name: string; status: boolean; description: string; parameters: Record<string, string> }
export interface LivePaths { base: string; pluginsJs: string; pluginFile: string; logDir: string; logFile: string; liveFile: string; backupFile: string }
export function livePaths(dataRoot: string): LivePaths;
export function pluginVersionOf(source: string): string | null;  // /VERSION:\s*"([^"]+)"/
export function parsePluginsJs(text: string): PluginEntry[] | null;
export function formatPluginsJs(entries: PluginEntry[]): string;
export type InstallStatus =
  | { state: "unsupported"; reason: string }
  | { state: "notInstalled" }
  | { state: "installed"; version: string | null; outdated: boolean };
export function getInstallStatus(folder: GameFolder, dataRoot: string, bundledVersion: string): Promise<InstallStatus>;
export type InstallResult = { ok: true } | { ok: false; message: string };
export function install(folder: WritableGameFolder, dataRoot: string, pluginSource: string): Promise<InstallResult>;
export function uninstall(folder: WritableGameFolder, dataRoot: string): Promise<InstallResult>;
```
- `livePaths("www/data")` → base `www`, pluginsJs `www/js/plugins.js`, pluginFile `www/js/plugins/RPGViewerBridge.js`, logDir `www/rpg-viewer`, logFile `www/rpg-viewer/log.jsonl`, liveFile `www/rpg-viewer/live.json`, backupFile `www/rpg-viewer/plugins.js.bak`. `livePaths("data")` → base `""`, `js/plugins.js`, … `rpg-viewer/…`.
- `parsePluginsJs`: 주석 줄 허용, `var $plugins =` 뒤 배열을 `JSON.parse`. 실패 시 null.
- `formatPluginsJs`: RPG Maker 형식 그대로 — `// Generated by RPG Maker.\n// Do not edit this file directly.\nvar $plugins =\n[\n` + 항목마다 `JSON.stringify(entry)`를 `,\n`로 연결 + `\n];\n`.
- install: pluginsJs 없음/파싱 실패 → `{ok:false, message:"이 게임은 자동 설치를 지원하지 않아요"}`(아무것도 쓰지 않음). backupFile 없으면 원문 그대로 저장. 플러그인 파일 쓰기. 항목이 있으면 status true로 갱신, 없으면 맨 끝에 `{name, status:true, description:"RPG Viewer 기록 플러그인", parameters:{}}` 추가. 쓰기 실패 → `{ok:false, message:"쓰기 권한이 필요해요"}`.
- uninstall: 우리 항목만 제거해 다시 쓰고 플러그인 파일 삭제. 기록 폴더·백업은 남긴다.
- status: pluginsJs 없거나 파싱 실패 → unsupported(reason 위 문구); 항목 없음 → notInstalled; 있으면 플러그인 파일에서 버전 읽어 `outdated = version !== bundledVersion`.

- [ ] **Step 1: 실패 테스트**
```ts
const ORIGINAL = `// Generated by RPG Maker.\n// Do not edit this file directly.\nvar $plugins =\n[\n{"name":"A","status":true,"description":"x","parameters":{"k":"v \\"q\\""}},\n{"name":"B","status":false,"description":"","parameters":{}}\n];\n`;
it("paths", () => { expect(livePaths("www/data").pluginsJs).toBe("www/js/plugins.js"); expect(livePaths("data").logFile).toBe("rpg-viewer/log.jsonl"); });
it("round-trips plugins.js", () => expect(formatPluginsJs(parsePluginsJs(ORIGINAL)!)).toBe(ORIGINAL));
it("installs, preserving other entries", async () => {
  const f = new MemoryFolder({ "js/plugins.js": ORIGINAL });
  expect(await install(f, "data", 'x = { VERSION: "1.0.0" }')).toEqual({ ok: true });
  const entries = parsePluginsJs((await f.readText("js/plugins.js"))!)!;
  expect(entries.map(e => e.name)).toEqual(["A", "B", "RPGViewerBridge"]);
  expect(entries[0]).toEqual(parsePluginsJs(ORIGINAL)![0]);
  expect(await f.readText("rpg-viewer/plugins.js.bak")).toBe(ORIGINAL);
  expect(await getInstallStatus(f, "data", "1.0.0")).toEqual({ state: "installed", version: "1.0.0", outdated: false });
  expect(await getInstallStatus(f, "data", "1.1.0")).toMatchObject({ outdated: true });
});
it("reinstall does not duplicate or overwrite backup", async () => { /* install 두 번 → 항목 1개, bak는 최초 원문 */ });
it("uninstall removes only our entry and the file", async () => { /* → 항목 A,B; plugin 파일 stat null; status notInstalled */ });
it("unsupported when plugins.js missing or unparsable", async () => { /* install → ok:false 문구, 아무 파일도 안 생김 */ });
```
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS, tsc
- [ ] **Step 5:** 커밋 `feat(core): plugin installer`

---

### Task 7: LogTail + readLive

**Files:**
- Create: `src/core/live/tail.ts`
- Test: `src/core/live/tail.test.ts`

**Interfaces:**
- Consumes: `WritableGameFolder.stat/readRange/readText`(Task 2), `parseLogText`(Task 4)
- Produces:
```ts
export interface TailResult { records: LogRecord[]; badLines: number; reset: boolean; changed: boolean }
export class LogTail {
  constructor(folder: WritableGameFolder, path: string);
  poll(): Promise<TailResult>;   // 크기 변화 없으면 {records:[],badLines:0,reset:false,changed:false}, 읽기 없음
}
export function readLive(folder: WritableGameFolder, path: string, prevModified: number | null):
  Promise<{ snapshot: LiveSnapshot | null; modified: number | null; changed: boolean }>;
```
- 바이트 단위로 `[offset, size)`만 읽고, 마지막 `\n`(0x0A) 이후의 남은 바이트는 다음 poll로 이월(디코드 전에 자름 → UTF-8 경계 안전). 크기가 offset보다 작아지면 offset=0, 이월 비우고 `reset:true`.
- readLive: `stat.lastModified === prevModified`면 읽지 않고 `changed:false`. JSON 실패 → snapshot null, changed false(다음에 재시도하도록 modified는 prev 유지).

- [ ] **Step 1: 실패 테스트**
```ts
it("reads only appended bytes", async () => {
  const f = new MemoryFolder({}); await f.writeText("l", line(1) + "\n");
  const tail = new LogTail(f, "l");
  expect((await tail.poll()).records.map(r => r.seq)).toEqual([1]);
  const spy = vi.spyOn(f, "readRange");
  f.appendText("l", line(2) + "\n");
  expect((await tail.poll()).records.map(r => r.seq)).toEqual([2]);
  expect(spy).toHaveBeenCalledWith("l", expect.any(Number), expect.any(Number));
  expect(spy.mock.calls[0][1]).toBeGreaterThan(0);
  expect((await tail.poll()).changed).toBe(false);
});
it("keeps partial lines and split UTF-8 for next poll", async () => {
  // "가" 대사 줄의 앞 절반 바이트만 append → records [] ; 나머지 append → 완전한 한 줄, text에 깨짐 없음
});
it("resets when file shrinks", async () => { /* 덮어써서 작아짐 → reset true, 처음부터 */ });
it("readLive skips unchanged and tolerates bad json", async () => { /* ... */ });
```
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS, tsc
- [ ] **Step 5:** 커밋 `feat(core): incremental log tail and live snapshot reader`

---

### Task 8: LiveProvider + 상단 탭·연결 상태·설치 Dialog + 라우트

**Files:**
- Create: `src/app/LiveProvider.tsx`, `src/app/devLive.ts`, `src/ui/live/LiveTabs.tsx`, `src/ui/live/ConnectionBadge.tsx`, `src/ui/live/InstallDialog.tsx`, `src/ui/live/HistoryView.tsx`(자리표시), `src/ui/live/MissingView.tsx`(자리표시), `src/vite-env.d.ts`에 `*.js?raw` 선언이 필요하면 추가
- Modify: `src/app/route.ts`(+test), `src/app/GameProvider.tsx`(`folder` 노출), `src/App.tsx`

**Interfaces:**
- Consumes: Task 4·5·6·7 전부, `useGame`
- Produces:
  - Route: `{ kind: "history" }` ↔ `#/history`, `{ kind: "missing" }` ↔ `#/missing` (route.test.ts에 왕복 테스트 추가)
  - `useGame()`에 `folder?: GameFolder` 추가
  - `useLive(): LiveContextValue`:
```ts
interface LiveContextValue {
  supported: boolean;                 // isWritableFolder(folder)
  install: InstallStatus | null; refreshInstall(): Promise<void>;
  doInstall(): Promise<InstallResult>; doUninstall(): Promise<InstallResult>;   // 내부에서 requestWrite
  connection: "noPlugin" | "waiting" | "connected" | "stale";   // waiting = 설치됐지만 기록·상태 없음
  lastSeenT: number | null;
  records: LogRecord[]; badLines: number;
  model: HistoryModel; coverage: Coverage; live: LiveSnapshot | null;
  missing: MissingItem[];
}
```
  - 폴링: 게임 ready + supported일 때 500ms 간격, `document.visibilityState !== "visible"`이면 건너뜀. `connected` = live.t가 현재로부터 5초 이내. records 누적, 모델·진행도·못 본 것은 records/live 변화 시 `useMemo`로 재계산. LiveProvider는 GameProvider 안, Shell 바깥.
  - 설치기는 `import pluginSource from "../../plugin/RPGViewerBridge.js?raw"`, `bundledVersion = pluginVersionOf(pluginSource)`.
  - DEV 시뮬레이터(`devLive.ts`, `import.meta.env.DEV`에서만 동적 import): `__rpgViewer.simulateFixtureLog()`(픽스처 기록과 live를 현재 MemoryFolder의 `livePaths(dataRoot)` 위치에 씀; `t`는 현재 시각으로 치환), `__rpgViewer.appendLog(record)`, `__rpgViewer.setLive(partial)`. 픽스처 파일은 `fetch("/tests/fixtures/logs/...")`.
- 화면:
  - Shell 헤더 왼쪽 Breadcrumb 대신 `LiveTabs`(shadcn `Tabs` — `탐색기 | 기록 | 못 본 것 ({missing.length})`), 탐색기 탭은 마지막 page 라우트(없으면 home)로 이동. Breadcrumb은 탐색기 탭일 때만 본문 위에 표시.
  - `ConnectionBadge`: 스펙 문구. `noPlugin`/`unsupported` → `플러그인 미설치` Badge(outline), 클릭 시 `InstallDialog`. 연결 상태에서도 클릭하면 Dialog.
  - `InstallDialog`(shadcn Dialog): 상태 문구, 버튼 `설치` / `업데이트` / `제거`, 결과 메시지(Alert), FileListFolder면 "크롬이나 엣지에서 폴더 열기로 연 게임만 지원해요".
  - main: route history → `HistoryView`, missing → `MissingView`(이 Task에서는 각각 "준비 중" muted 텍스트).
- [ ] **Step 1:** route 테스트(RED→GREEN), **Step 2:** 구현, **Step 3:** `npx vitest run`, `npm run build`, lint
- [ ] **Step 4:** 커밋 `feat(ui): live provider, tabs, connection badge, install dialog`

---

### Task 9: 사이드바 "지금" + 탐색기 주석

**Files:**
- Create: `src/ui/live/NowGroup.tsx`, `src/ui/live/annotations.ts`(+test)
- Modify: `src/ui/AppSidebar.tsx`, `src/ui/EventView.tsx`, `src/ui/RefBadge.tsx`, `src/ui/script/ScriptView.tsx`, `src/ui/script/MessageNode.tsx`, `src/ui/script/BlockNode.tsx`

**Interfaces:**
- Consumes: `useLive`, `evaluate`, `seenKey/pickKey`, `branchLabel`, `findNodePathByCmd`
- Produces: `annotations.ts` 순수 함수 — `nowEvents(data, index, live): { eventId: number; page: number; title: string; mark: "talk" | "auto" | "none"; location: Location }[]`(mark: 페이지 trigger 0~2 + hasDialogue → talk, 3·4 → auto, 그 외 none), `conditionIcon(status): "✓" | "✗" | "?"`.
- 사이드바 맨 위 `SidebarGroup` "지금": `{맵 이름} ({x}, {y})`, 이벤트 목록(`●`/`⚡`/`○`, ○는 "대사 없는 항목 표시" 토글을 따름), 클릭 → `openPage`. 연결 안 됐으면 그룹 숨김. 그룹 헤더 오른쪽 `따라가기` Switch(기본 켜짐) — 켜져 있으면 live.mapId를 맵 트리 자동 펼침 대상으로(기존 activeMapId 로직에 합류).
- EventView: 현재 맵의 해당 이벤트 페이지 탭 라벨 옆 `지금` Badge.
- RefBadge/조건 Badge: `condition.test`를 `evaluate`(ctx: 맵 페이지면 mapId/eventId)해 아이콘을 Badge 앞에 붙임(`✓`/`✗`/`?`).
- ScriptView에 React context `ScriptLocation`(현재 Location)을 제공. MessageNode/스크롤: `seen.has(seenKey(loc, node.cmd))`면 본문 끝에 lucide `Check` 아이콘(`text-muted-foreground size-3.5`, `aria-label="본 대사"`).
- BlockNode 선택지 분기 라벨 옆: 그 분기 인덱스(취소 분기는 picked -2)로 고른 기록이 있으면 `Badge variant="secondary"` `{branchLabel}`들(중복 갈래 제거), 없으면 `아직 안 고름`(muted text-xs).
- [ ] **Step 1:** annotations 테스트(RED→GREEN): sample-mz + fixtureLive → nowEvents = [{eventId:1,page:1,mark:"talk"},{eventId:3,page:0,mark:"talk"}]
- [ ] **Step 2:** UI 구현, **Step 3:** test/build/lint, **Step 4:** 커밋 `feat(ui): now group and explorer annotations`

---

### Task 10: 기록 탭

**Files:**
- Modify/Create: `src/ui/live/HistoryView.tsx`, `src/ui/live/ChoiceNowCard.tsx`, `src/ui/live/TimelineItem.tsx`, (필요 시 `npx shadcn@latest add select`)

**Interfaces:**
- Consumes: `useLive`(records, model, coverage, live), `branchPath`, `foldTimeline`, `noisyVariables`(foldTimeline 내부), `branchLabel`, `pickKey`, `findNodePathByCmd`, `openPage`, `highlightNode`
- 화면:
  - 상단 shadcn `Select`: run별 그룹(`SelectGroup` 라벨 `{run}회차`), 항목 `branchLabel`. 기본값 `model.latestBranch`; 사용자가 고르기 전에는 새 갈래가 생기면 따라감.
  - `ChoiceNowCard`(live.choice 있을 때만, Card): 제목 `지금 선택지`, 각 옵션 줄 — formatText(옵션), 고른 기록 Badge들(`branchLabel`), 그 아래 aftermath 문자열(muted, ` · `로 연결), 없으면 `아직 안 고름`.
  - 타임라인(세로 목록, `space-y-1`): record 종류별 한 줄 — message: 얼굴(FaceImage 재사용, 32px로 축소 가능하면 기존 40px 그대로), 화자, formatText 본문; choices는 표시하지 않고 choice: `▶ 선택: "{옵션 텍스트}"`(choices 기록에서 라벨 찾기); picture: `🖼 {name}`; transfer: `🚪 {맵 이름} ({x}, {y})`; battle: `⚔ 전투 시작: {troop 이름}` / `⚔ 전투 종료: 승리|도주|패배`; save/load: `💾 저장 (슬롯 n)` / `💾 불러오기 (슬롯 n)`; branchStart: 구분선 + `{branchLabel} 시작` (reason별 보조 문구: 새 게임 / 세이브에서 갈라짐 / 출처 모를 세이브); state: `⚙ ` + 변경 목록(names.ts로 이름); error: 생략. repeat: `↻ 같은 대화 다시 봄 ×{count}`(Collapsible로 원본 한 줄). stateGroup: `⚙ 상태 변경 {count}개`(Collapsible). fork: `갈래 {N}개 ⇄` + 각 갈래 버튼(현재 선택은 비활성). uncertain: 줄 끝 `위치 불확실` Badge(outline), 링크 없음.
  - src·cmd 있는 줄 클릭 → `openPage(src)` 후 `highlightNode(locationKey(src), findNodePathByCmd(entryNodes, cmd))`.
  - 새 기록이 오면 맨 아래 근처에 있을 때만 자동 스크롤.
  - 기록이 없으면 연결 상태별 안내: 미설치 → `플러그인을 설치하면 플레이 기록이 여기에 쌓여요`, 설치됨 → `게임을 실행해 새 게임을 시작하거나 세이브를 불러오세요`.
- [ ] **Step 1:** 순수 헬퍼가 생기면(예: 레코드 → 한 줄 문자열) 테스트, **Step 2:** 구현, **Step 3:** test/build/lint, **Step 4:** 커밋 `feat(ui): history tab`

---

### Task 11: 못 본 것 탭

**Files:**
- Modify/Create: `src/ui/live/MissingView.tsx`

**Interfaces:**
- Consumes: `useLive().missing`, `openPage`, `highlightNode`, `locationKey`
- 화면: 상단 `Switch` + Label `지금 갈 수 있는 것만`(on이면 요구 조건에 `unmet`이 없는 항목만). 두 섹션 제목 `안 고른 선택지 항목 ({n})`, `안 본 대사가 있는 페이지 ({n})`. 각 항목 Card(작게): 1행 라벨(굵게) + `지금 이 맵` Badge(onCurrentMap), 2행 `entry.path`(muted), 3행 요구 조건 Badge들(`✓/✗/? {text}`; met=secondary, unmet=outline, unknown=outline muted). 클릭 → 탐색기 이동 + 강조(nodePath). 섹션이 비면 `없음`. 연결 전에는 상단에 `게임에 연결되면 조건 충족 여부가 표시돼요` muted. 항목 많을 때를 위해 섹션당 처음 100개 + `더 보기` 버튼.
- [ ] **Step 1:** 구현, **Step 2:** test/build/lint, **Step 3:** 커밋 `feat(ui): missing tab`

---

### Task 12: 문서 + 마무리

**Files:**
- Modify: `README.md`
- Create: `docs/live-checklist.md`

- README: "실시간 연결과 플레이 기록" 섹션 — 설치(상단 `플러그인 미설치` → 설치, 쓰기 권한), 게임 실행 후 연결 표시, 기록/못 본 것 탭, 제거, 게임 폴더에 생기는 `rpg-viewer/` 폴더 설명, 개발 시뮬레이터(`await __rpgViewer.openFixture("sample-mz"); await __rpgViewer.simulateFixtureLog()`).
- `docs/live-checklist.md`: 실제 게임 확인 체크리스트 — 설치/제거 후 게임이 정상 실행되는지, 새 게임 → 1회차 갈래 1, 대사 기록과 탐색기 체크 표시, 선택지 고르기 → 분기에 Badge, 세이브 후 다른 선택 → 갈래 2와 `갈래 2개 ⇄`, 게임 재시작 후 이어짐, "지금" 영역과 조건 ✓/✗, 지금 선택지 카드, 못 본 것 정렬·필터, 게임 종료 시 `게임 꺼짐`, 압축 포장 게임에서 `지원하지 않아요`.
- [ ] **Step 1:** 작성, `npx vitest run`, `npm run build`, `npm run lint`, purity grep(`grep -rnE "from \"react\"|window\.|document\.|indexedDB" src/core` → 없음)
- [ ] **Step 2:** 커밋 `docs: live connection and history`
