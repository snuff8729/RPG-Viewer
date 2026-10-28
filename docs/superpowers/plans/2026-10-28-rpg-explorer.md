# RPG Viewer 1단계 (전체 탐색기) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** RPG Maker MV/MZ 게임 폴더를 브라우저에서 열어 모든 맵·공통 이벤트·전투 이벤트의 대사·선택지·그림·상태 변경을 대본 형태로 보고, 검색과 스위치/변수 상호참조를 할 수 있는 웹앱을 만든다.

**Architecture:** `src/core/`는 React와 브라우저 API에 의존하지 않는 순수 TypeScript 모듈(fs 추상화 → loader → text/conditions/interpret → index, assets)이고 Vitest로 테스트한다. `src/ui/`와 `src/app/`은 shadcn/ui로 만든 React 화면이며, 상태는 React context 하나(`GameProvider`)와 URL 해시 라우트로 관리한다.

**Tech Stack:** Node 24, Vite + React + TypeScript, Tailwind CSS v4, shadcn/ui (latest CLI), Vitest, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-28-rpg-explorer-design.md`

## Global Constraints

- 지원 엔진: RPG Maker **MV / MZ**만. XP/VX/VX Ace 코드 경로를 만들지 않는다.
- 모든 UI는 **shadcn/ui 컴포넌트와 공식 예제 디자인**으로 구성한다. 커스텀 색·폰트·디자인 토큰을 새로 만들지 않는다. shadcn에 없는 요소는 shadcn 컴포넌트와 기존 토큰(`text-muted-foreground`, `border`, `bg-muted` 등)만 조합한다.
- `src/core/**`는 `react`, `window`, `document`, `indexedDB`를 import하거나 참조하지 않는다.
- 해석기·로더·색인은 어떤 입력에도 예외를 던지지 않는다. 문제는 `other` 노드나 `GameData.errors`로 보존한다.
- 화면 문구는 한국어. 표시 형식은 spec의 표 그대로(예: `스위치: 숲 개방 ON`, `↪ 공통 이벤트 [이름] 실행`, `🚪 이동 → [맵 이름] (x, y)`, `기타 명령 N개`).
- 이름이 비어 있는 스위치/변수는 `#번호`로 표시한다(예: `스위치: #2 ON`).
- 테스트 실행: `npx vitest run`. 빌드 확인: `npm run build`.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **배열 속 `null`** — `Actors`, `CommonEvents`, `MapInfos`, `map.events`, `Troops`의 빈 칸(`null`)은 건너뛰어야 하며 화면·색인에서 오류를 내면 안 된다. (Task 3, Task 8 테스트)
2. **MapInfos에는 있는데 `Map###.json` 파일이 없음** — 그 맵만 `errors`에 기록하고 사이드바에 ⚠로 표시, 나머지는 정상. (Task 3 테스트)
3. **파일명 대소문자 불일치** — 데이터에는 `Actor1`, 디스크에는 `actor1.png`. Windows 게임에서 흔하다. 대소문자를 무시하고 찾아야 한다. (Task 2 테스트)
4. **깨진 명령 구조** — 닫는 코드(`0`, `404`, `412`) 누락이나 indent 점프가 있어도 해석기는 멈추지 않고 나머지를 출력해야 한다. (Task 6 테스트)
5. **그림 이름이 빈 문자열인 231 명령 / 얼굴 이름이 빈 101** — 이미지 요청을 하지 않고 각각 노드 생략 / 내레이션 처리. (Task 6 테스트)

---

## File Structure

```
package.json, vite.config.ts, tsconfig*.json, components.json, index.html
scripts/make-fixture-images.mjs     픽스처 PNG(평문 + 암호화) 생성
tests/fixtures/sample-mz/           MZ 픽스처 (data/, img/)
tests/fixtures/sample-mv/           MV 픽스처 (www/data/, www/img/)
tests/helpers/fixtureFolder.ts      디스크 픽스처 → MemoryFolder
src/core/types.ts                   모든 공용 타입 (계약)
src/core/fs/folder.ts               GameFolder, MemoryFolder, resolveCaseInsensitive
src/core/fs/browserFolders.ts       DirectoryHandleFolder, FileListFolder (브라우저 전용, 테스트 없음)
src/core/loader/loadGame.ts         데이터 루트 탐지 + 로드
src/core/text/escape.ts             제어문자 처리
src/core/conditions/describe.ts     페이지 조건 / 조건 분기 / 트리거 설명
src/core/interpret/interpret.ts     명령 → ScriptNode
src/core/assets/decrypt.ts          복호화 (순수)
src/core/assets/assets.ts           경로 해석 + 캐시 → Blob
src/core/index/locations.ts         모든 페이지 순회 + 표시 이름
src/core/index/buildIndex.ts        검색 + 상호참조
src/app/route.ts                    URL 해시 ↔ Route
src/app/GameProvider.tsx            로드 상태, GameData, GameIndex, AssetStore 제공
src/app/recent.ts                   IndexedDB 최근 폴더
src/ui/StartScreen.tsx
src/ui/AppSidebar.tsx
src/ui/EventView.tsx
src/ui/script/*.tsx                 노드별 렌더러
src/ui/SearchDialog.tsx
src/ui/XrefSheet.tsx
src/ui/ErrorsBadge.tsx
src/App.tsx, src/main.tsx
```

---

### Task 1: 프로젝트 골격

**Files:**
- Create: Vite React-TS 템플릿 파일 일체, `components.json`, `src/components/ui/*` (shadcn 생성), `src/smoke.test.ts`

**Interfaces:**
- Produces: `@/` 경로 별칭 → `src/`. shadcn 컴포넌트: `sidebar, card, badge, tabs, collapsible, dialog, command, sheet, button, scroll-area, separator, breadcrumb, tooltip, skeleton, alert`.

- [ ] **Step 1:** 현재 폴더(비어 있지 않음: `docs/`, `.gitignore`)에 `npm create vite@latest . -- --template react-ts`로 생성. 기존 파일 덮어쓰기를 묻는다면 `docs/`와 `.gitignore`는 유지한다(템플릿의 `.gitignore`와 합치고 `.superpowers/` 줄을 남긴다).
- [ ] **Step 2:** shadcn 공식 Vite 설치 가이드(ui.shadcn.com/docs/installation/vite)대로 Tailwind v4(`@tailwindcss/vite`), `@/*` 별칭(tsconfig.json, tsconfig.app.json, vite.config.ts), `npx shadcn@latest init`(base color: neutral)을 적용한다.
- [ ] **Step 3:** `npx shadcn@latest add sidebar card badge tabs collapsible dialog command sheet button scroll-area separator breadcrumb tooltip skeleton alert`
- [ ] **Step 4:** `npm i -D vitest`, `package.json`에 `"test": "vitest run"` 추가. `vite.config.ts`에 `test: { environment: "node", include: ["src/**/*.test.ts", "tests/**/*.test.ts"] }`.
- [ ] **Step 5:** `src/smoke.test.ts`: `expect(1 + 1).toBe(2)`. `npx vitest run` → 1 passed. `npm run build` → 성공.
- [ ] **Step 6:** 커밋 `chore: scaffold vite + react + shadcn + vitest`

---

### Task 2: 공용 타입 + 폴더 추상화

**Files:**
- Create: `src/core/types.ts`, `src/core/fs/folder.ts`, `src/core/fs/browserFolders.ts`, `tests/helpers/fixtureFolder.ts`
- Test: `src/core/fs/folder.test.ts`

**Interfaces:**
- Produces: 아래 `types.ts` 전체(이후 모든 Task의 계약). `MemoryFolder`, `resolveCaseInsensitive`, `DirectoryHandleFolder`, `FileListFolder`, `loadFixtureFolder(name)`.

`src/core/types.ts` (그대로 작성):

```ts
// ---- RPG Maker 원본 데이터 (필요한 필드만) ----
export interface EventCommand { code: number; indent: number; parameters: any[] }
export interface PageConditions {
  switch1Valid: boolean; switch1Id: number; switch2Valid: boolean; switch2Id: number;
  variableValid: boolean; variableId: number; variableValue: number;
  selfSwitchValid: boolean; selfSwitchCh: string;
  itemValid: boolean; itemId: number; actorValid: boolean; actorId: number;
}
export interface EventPage { conditions: PageConditions; trigger: number; list: EventCommand[] }
export interface MapEvent { id: number; name: string; x: number; y: number; pages: EventPage[] }
export interface MapData { displayName: string; events: (MapEvent | null)[] }
export interface MapInfo { id: number; name: string; parentId: number; order: number }
export interface CommonEvent { id: number; name: string; trigger: number; switchId: number; list: EventCommand[] }
export interface TroopPageConditions {
  turnEnding: boolean; turnValid: boolean; enemyValid: boolean; actorValid: boolean; switchValid: boolean;
  turnA: number; turnB: number; enemyIndex: number; enemyHp: number; actorId: number; actorHp: number; switchId: number;
}
export interface TroopPage { conditions: TroopPageConditions; span: number; list: EventCommand[] }
export interface Troop { id: number; name: string; pages: TroopPage[] }
export interface Actor { id: number; name: string; faceName: string; faceIndex: number }
export interface NamedEntry { id: number; name: string }
export interface SystemData {
  gameTitle: string; currencyUnit: string; switches: string[]; variables: string[];
  encryptionKey?: string; hasEncryptedImages?: boolean; advanced?: unknown;
}

// ---- 로드 결과 ----
export type Engine = "MV" | "MZ";
export interface LoadError { file: string; message: string; mapId?: number }
export interface GameData {
  engine: Engine;
  dataRoot: string;            // 예: "www/data" 또는 "data"
  imgRoot: string;             // 예: "www/img" 또는 "img"
  system: SystemData;
  mapInfos: (MapInfo | null)[];
  maps: Map<number, MapData>;  // 로드 성공한 맵만
  commonEvents: (CommonEvent | null)[];
  troops: (Troop | null)[];
  actors: (Actor | null)[];
  items: (NamedEntry | null)[];
  weapons: (NamedEntry | null)[];
  armors: (NamedEntry | null)[];
  errors: LoadError[];
}

// ---- 해석 결과 ----
export type RefType = "switch" | "variable" | "selfSwitch" | "item" | "weapon" | "armor" | "actor" | "commonEvent" | "map";
export interface Ref { type: RefType; id: number | string }   // selfSwitch는 "A"~"D"
export interface Condition { text: string; refs: Ref[] }
export interface FaceRef { name: string; index: number }
export type ScriptNode =
  | { kind: "message"; face?: FaceRef; speaker?: string; lines: string[] }
  | { kind: "scroll"; lines: string[] }
  | { kind: "choices"; branches: { label: string; body: ScriptNode[] }[]; cancelBranch?: ScriptNode[] }
  | { kind: "conditional"; condition: Condition; then: ScriptNode[]; else?: ScriptNode[] }
  | { kind: "loop"; body: ScriptNode[] }
  | { kind: "picture"; pictureId: number; name: string }
  | { kind: "commonEvent"; commonEventId: number }
  | { kind: "transfer"; mapId: number | null; x?: number; y?: number }
  | { kind: "stateChange"; target: "switch" | "variable" | "selfSwitch" | "item" | "weapon" | "armor" | "gold" | "party"; description: string; refs: Ref[] }
  | { kind: "other"; commands: EventCommand[] };

// ---- 색인 ----
export type Location =
  | { source: "map"; mapId: number; eventId: number; page: number }   // page는 0부터
  | { source: "common"; commonEventId: number }
  | { source: "troop"; troopId: number; page: number };
export interface PageEntry {
  location: Location;
  path: string;                // 예: "촌장의 집 › 촌장 › p1"
  title: string;               // 사이드바용 표시 이름
  nodes: ScriptNode[];
  conditions: Condition[];     // 페이지 출현 조건 + 트리거 설명
  hasDialogue: boolean;
}
export interface SearchHit { entry: PageEntry; text: string; nodePath: number[] }
export interface XrefEntry { writes: PageEntry[]; reads: PageEntry[] }
export interface GameIndex {
  pages: PageEntry[];
  search(query: string, limit?: number): SearchHit[];
  xref(ref: Ref): XrefEntry;
  callers(commonEventId: number): PageEntry[];
}
```

`nodePath`는 `ScriptNode` 트리에서의 위치(최상위 인덱스, 하위 블록이면 `[i, branchIndex, j]` 식으로 이어붙임). 렌더러는 같은 규칙으로 각 노드에 `data-node-path="0.2.1"` 속성을 붙인다. 하위 블록 인덱스 규칙: choices → `[i, branchIdx, j]`, cancelBranch → `[i, -1, j]`, conditional → `[i, 0, j]`(then) / `[i, 1, j]`(else), loop → `[i, 0, j]`.

`src/core/fs/folder.ts`:
- `interface GameFolder { readText(path): Promise<string|null>; readBinary(path): Promise<ArrayBuffer|null>; list(dir): Promise<string[]> }` — 경로는 `/` 구분, 폴더 루트 기준 상대 경로. `list`는 바로 아래 항목 이름만(없으면 `[]`).
- `class MemoryFolder implements GameFolder` — `constructor(files: Record<string, string | Uint8Array>)`. 읽을 때 대소문자를 무시하고 매칭한다(Windows 동작 재현).
- `resolveCaseInsensitive(names: string[], wanted: string): string | null` — 정확히 일치하면 그것, 아니면 소문자 비교로 첫 일치.

`src/core/fs/browserFolders.ts`: `DirectoryHandleFolder(handle: FileSystemDirectoryHandle)` — 경로 세그먼트마다 `getDirectoryHandle`/`getFileHandle`, 실패 시 디렉터리 항목 이름을 나열해 `resolveCaseInsensitive`로 재시도. `FileListFolder(files: FileList)` — `webkitRelativePath`의 첫 세그먼트(선택한 폴더 이름)를 떼어 낸 경로로 맵을 만들고 소문자 키로 조회.

`tests/helpers/fixtureFolder.ts`: `loadFixtureFolder(name: "sample-mz" | "sample-mv"): MemoryFolder` — `node:fs`로 `tests/fixtures/<name>/` 아래 모든 파일을 재귀로 읽는다(.json은 문자열, 나머지는 Uint8Array).

- [ ] **Step 1: 실패 테스트 작성** `src/core/fs/folder.test.ts`

```ts
it("reads files case-insensitively", async () => {
  const f = new MemoryFolder({ "img/faces/actor1.png": new Uint8Array([1, 2]) });
  expect(new Uint8Array((await f.readBinary("img/faces/Actor1.png"))!)).toEqual(new Uint8Array([1, 2]));
});
it("returns null for missing files", async () => {
  expect(await new MemoryFolder({}).readText("data/System.json")).toBeNull();
});
it("lists direct children only", async () => {
  const f = new MemoryFolder({ "data/a.json": "{}", "data/sub/b.json": "{}" });
  expect((await f.list("data")).sort()).toEqual(["a.json", "sub"]);
});
it("resolveCaseInsensitive prefers exact match", () => {
  expect(resolveCaseInsensitive(["Actor1.png", "actor1.png"], "actor1.png")).toBe("actor1.png");
  expect(resolveCaseInsensitive(["Actor1.png"], "ACTOR1.PNG")).toBe("Actor1.png");
  expect(resolveCaseInsensitive(["x.png"], "y.png")).toBeNull();
});
```

- [ ] **Step 2:** `npx vitest run src/core/fs` → FAIL (모듈 없음)
- [ ] **Step 3:** `types.ts`, `folder.ts`, `browserFolders.ts`, `fixtureFolder.ts` 구현
- [ ] **Step 4:** `npx vitest run src/core/fs` → PASS, `npx tsc -b --noEmit` 오류 없음
- [ ] **Step 5:** 커밋 `feat(core): shared types and folder abstraction`

---

### Task 3: 픽스처 + 로더

**Files:**
- Create: `scripts/make-fixture-images.mjs`, `tests/fixtures/sample-mz/**`, `tests/fixtures/sample-mv/**`, `src/core/loader/loadGame.ts`
- Test: `src/core/loader/loadGame.test.ts`

**Interfaces:**
- Consumes: `GameFolder`, `GameData`, `loadFixtureFolder`
- Produces: `loadGame(folder: GameFolder): Promise<LoadResult>`, where `type LoadResult = { ok: true; data: GameData } | { ok: false; reason: "notFound"; searched: string[] } | { ok: false; reason: "encrypted"; file: string }`

**픽스처 내용 (이후 Task 테스트가 이 값에 의존한다):**

`sample-mz/data/` — MZ (`System.json`에 `"advanced": {}` 있음):
- `System.json`: `gameTitle "샘플 게임"`, `currencyUnit "G"`, `switches ["", "숲 개방", ""]`, `variables ["", "호감도"]`, `encryptionKey "0123456789abcdef0123456789abcdef"`, `hasEncryptedImages true`
- `Actors.json`: `[null, {id:1,name:"레나",faceName:"Actor1",faceIndex:0}, {id:2,name:"촌장",faceName:"People1",faceIndex:3}]`
- `Items.json`: `[null, {id:1,name:"낡은 열쇠"}, {id:2,name:"은 반지"}]`; `Weapons.json`, `Armors.json`: `[null]`
- `MapInfos.json`: `[null, {id:1,name:"마을",parentId:0,order:1}, {id:2,name:"촌장의 집",parentId:1,order:2}, {id:3,name:"숲 입구",parentId:0,order:3}, {id:4,name:"잃어버린 맵",parentId:0,order:4}]` — **`Map004.json`은 만들지 않는다.**
- `Map001.json`: `events: [null]`
- `Map003.json`: `events: [null, {id:1,name:"문",pages:[{trigger 0, 조건 없음, list:[{code:250,...SE},{code:0}]}]}]` (대사 없음)
- `Map002.json` (`displayName "촌장의 집"`), `events: [null, EV1, null, EV3]`
  - **EV1** `name "촌장"`, page 0 (조건 없음, trigger 0) list (indent는 괄호):
    1. `101 ["People1",3,0,2,"촌장"]`(0), `401 ["왔구나, \\N[1]."]`(0), `401 ["숲이 이상하다는 소문은 들었겠지?"]`(0)
    2. `101 ["Actor1",0,0,2,""]`(0), `401 ["네… 밤마다 이상한 소리가 난다고요."]`(0)
    3. `101 ["",0,0,2,""]`(0), `401 ["(창밖에서 바람 소리가 들린다.)"]`(0)
    4. `231 [1,"village_map",0,0,0,0,100,100,255,0]`(0)
    5. `101 ["People1",3,0,2,"촌장"]`(0), `401 ["도와주겠나? \\C[2]보상\\C[0]은 \\V[1]만큼."]`(0)
    6. `102 [["네, 도울게요","생각해볼게요"],1,0,2,0]`(0)
       `402 [0,"네, 도울게요"]`(0) → `101 ["People1",3,0,2,"촌장"]`(1), `401 ["고맙네!"]`(1), `121 [1,1,0]`(1), `0`(1)
       `402 [1,"생각해볼게요"]`(0) → `0`(1)
       `404 []`(0)
    7. `111 [1,1,0,5,1]`(0) → `101 ["People1",3,0,2,"촌장"]`(1), `401 ["이건 내 아내가 남긴 물건이네."]`(1), `126 [2,0,0,1]`(1), `0`(1); `411 []`(0) → `0`(1); `412 []`(0)
    8. `105 [2,false]`(0), `405 ["― 그날 밤 ―"]`(0), `405 ["마을에 다시 정적이 찾아왔다."]`(0)
    9. `117 [1]`(0)
    10. `250 [{"name":"Wind","volume":90,"pitch":100,"pan":0}]`(0), `225 [5,5,30,true]`(0), `357 ["SomePlugin","doThing","",{}]`(0), `9999 ["x"]`(0)
    11. `201 [0,3,5,12,0,0]`(0)
    12. `0 []`(0)
  - **EV1** page 1: conditions `switch1Valid true, switch1Id 1`, trigger 0, list `101 ["People1",3,0,2,"촌장"]`, `401 ["숲을 부탁하네."]`, `0`
  - **EV3** `name "EV003"`, page 0 (조건 없음): `101 ["",0,0,2,""]`, `401 ["낡은 책이 꽂혀 있다. 숲의 전설에 대한 책이다."]`, `0`
- `CommonEvents.json`: `[null, {id:1,name:"밤의 장면",trigger:0,switchId:1,list:[101 ["",0,0,2,""], 401 ["밤이 깊었다."], 0]}, null]`
- `Troops.json`: `[null, {id:1,name:"슬라임",pages:[{conditions:{turnEnding:false,turnValid:true,enemyValid:false,actorValid:false,switchValid:false,turnA:1,turnB:0,enemyIndex:0,enemyHp:50,actorId:1,actorHp:50,switchId:1},span:0,list:[101 ["",0,0,2,""],401 ["슬라임이 나타났다!"],0]}]}]`
- 모든 page의 생략된 `conditions` 필드는 false/0/`"A"`로 채운다.

`sample-mz/img/` — `scripts/make-fixture-images.mjs`로 생성 후 커밋:
- `faces/People1.png_` (576×288 PNG, 8칸 서로 다른 단색, 암호화)
- `faces/actor1.png` (576×288 평문, **소문자 파일명**)
- `pictures/village_map.png_` (816×624 단색, 암호화)

`sample-mv/www/data/` — MV (`advanced` 없음): `System.json`(`gameTitle "MV 샘플"`, 같은 encryptionKey, switches `["",""]`, variables `["",""]`), `Actors.json`(레나/Actor1/0 하나), `MapInfos.json`(`[null,{id:1,name:"시작",parentId:0,order:1}]`), `Map001.json`(EV1 `name "EV001"`, `101 ["Actor1",0,0,2]`, `401 ["MV 대사입니다."]`, `0`), `CommonEvents.json [null]`, `Troops.json [null]`, `Items/Weapons/Armors [null]`. `www/img/faces/Actor1.rpgmvp` (암호화).

`make-fixture-images.mjs`: `node:zlib`로 단색(칸별 색) RGBA PNG를 직접 인코딩(시그니처, IHDR, IDAT, IEND, CRC32). 암호화 = 헤더 `52 50 47 4D 56 00 00 00 00 03 01 00 00 00 00 00` + (PNG 앞 16바이트를 키 바이트와 XOR) + PNG 나머지.

**로더 규칙:**
- 데이터 루트 후보 순서: `www/data`, `data`. `<root>/System.json`이 있는 첫 번째. 이미지 루트는 같은 접두(`www/img` 또는 `img`). 둘 다 없으면 `{ok:false, reason:"notFound", searched:["www/data/System.json","data/System.json"]}`.
- `System.json` 내용이 `{`/`[`로 시작하지 않으면(공백 제거 후) `{ok:false, reason:"encrypted", file:"<root>/System.json"}`.
- `engine = system.advanced !== undefined ? "MZ" : "MV"`.
- 나머지 파일: 없거나 파싱 실패하면 `errors`에 `{file, message}` 추가하고 빈 배열(`[null]`)로 대체.
- 맵: `mapInfos`의 null 아닌 항목마다 `Map` + 3자리 0패딩 + `.json`. 실패 시 `errors`에 `{file, message, mapId}`.

- [ ] **Step 1:** `scripts/make-fixture-images.mjs` 작성, `node scripts/make-fixture-images.mjs` 실행, 위 JSON 픽스처 작성
- [ ] **Step 2: 실패 테스트 작성** `src/core/loader/loadGame.test.ts`

```ts
it("loads MZ fixture", async () => {
  const r = await loadGame(loadFixtureFolder("sample-mz"));
  if (!r.ok) throw new Error("load failed");
  expect(r.data.engine).toBe("MZ");
  expect(r.data.dataRoot).toBe("data");
  expect(r.data.imgRoot).toBe("img");
  expect(r.data.system.gameTitle).toBe("샘플 게임");
  expect([...r.data.maps.keys()].sort()).toEqual([1, 2, 3]);
  expect(r.data.errors).toEqual([expect.objectContaining({ file: "data/Map004.json", mapId: 4 })]);
  expect(r.data.commonEvents[2]).toBeNull();
});
it("loads MV fixture from www/", async () => {
  const r = await loadGame(loadFixtureFolder("sample-mv"));
  if (!r.ok) throw new Error();
  expect(r.data.engine).toBe("MV");
  expect(r.data.dataRoot).toBe("www/data");
  expect(r.data.imgRoot).toBe("www/img");
});
it("reports notFound with searched paths", async () => {
  expect(await loadGame(new MemoryFolder({ "readme.txt": "x" }))).toEqual(
    { ok: false, reason: "notFound", searched: ["www/data/System.json", "data/System.json"] });
});
it("reports encrypted data", async () => {
  expect(await loadGame(new MemoryFolder({ "data/System.json": "U2FsdGVk..." })))
    .toEqual({ ok: false, reason: "encrypted", file: "data/System.json" });
});
it("keeps going when a file is malformed", async () => {
  const r = await loadGame(new MemoryFolder({
    "data/System.json": JSON.stringify({ gameTitle: "t", currencyUnit: "G", switches: [], variables: [] }),
    "data/MapInfos.json": "[null, {\"id\":1,\"name\":\"a\",\"parentId\":0,\"order\":1}]",
    "data/Map001.json": "{ broken",
    "data/CommonEvents.json": "[null]",
  }));
  if (!r.ok) throw new Error();
  expect(r.data.maps.size).toBe(0);
  expect(r.data.errors.map(e => e.file)).toContain("data/Map001.json");
  expect(r.data.errors.map(e => e.file)).toContain("data/Troops.json");
});
```

- [ ] **Step 3:** `npx vitest run src/core/loader` → FAIL
- [ ] **Step 4:** `loadGame` 구현
- [ ] **Step 5:** `npx vitest run src/core/loader` → PASS
- [ ] **Step 6:** 커밋 `feat(core): fixtures and game loader`

---

### Task 4: 제어문자 처리

**Files:**
- Create: `src/core/text/escape.ts`
- Test: `src/core/text/escape.test.ts`

**Interfaces:**
- Consumes: `GameData`
- Produces: `formatText(raw: string, data: GameData): string`, `variableName(data: GameData, id: number): string`(`"호감도"` 또는 `"#3"`), `switchName(data, id)`(같은 규칙), `itemName/weaponName/armorName/actorName(data, id)`(없으면 `#id`). 이름 헬퍼는 `src/core/text/names.ts`에 두고 Task 5·6·8이 사용한다.

규칙(spec 표): `\N[n]`→배우 이름, `\P[n]`→`[파티원 n]`, `\V[n]`→`[변수: 이름]`, `\G`→currencyUnit, `\\`→`\`, 그 외 `\` + 영문자열 + 선택적 `[...]`/`<...>`, 그리고 `\{ \} \. \| \! \> \< \^ \$`는 제거. 대소문자 무시(`\n[1]`도 이름). `\V`, `\N` 인자 안에 중첩 `\V[n]`이 있으면 먼저 변수 표시로 바꾸지 않고 원문 숫자만 지원(중첩은 `[변수: …]`로 대체).

- [ ] **Step 1: 실패 테스트**

```ts
const data = /* sample-mz 로드 결과 */;
it("replaces actor names", () => expect(formatText("왔구나, \\N[1].", data)).toBe("왔구나, 레나."));
it("shows variables by name", () => expect(formatText("\\V[1]만큼", data)).toBe("[변수: 호감도]만큼"));
it("falls back to #id for unnamed", () => expect(formatText("\\V[7]", data)).toBe("[변수: #7]"));
it("strips color and wait codes", () => expect(formatText("\\C[2]보상\\C[0]\\.\\|!", data)).toBe("보상!"));
it("strips unknown plugin codes", () => expect(formatText("a\\FS[20]b\\MSGCore<x>c", data)).toBe("abc"));
it("handles currency, party, backslash", () => expect(formatText("10\\G \\P[2] \\\\", data)).toBe("10G [파티원 2] \\"));
it("is case-insensitive", () => expect(formatText("\\n[1]", data)).toBe("레나"));
it("unknown actor gives #id", () => expect(formatText("\\N[99]", data)).toBe("#99"));
```

- [ ] **Step 2:** FAIL 확인 → **Step 3:** 구현 → **Step 4:** `npx vitest run src/core/text` PASS
- [ ] **Step 5:** 커밋 `feat(core): message escape codes`

---

### Task 5: 조건 설명

**Files:**
- Create: `src/core/conditions/describe.ts`
- Test: `src/core/conditions/describe.test.ts`

**Interfaces:**
- Consumes: `GameData`, 이름 헬퍼(Task 4)
- Produces:
  - `describePageConditions(c: PageConditions, trigger: number, data: GameData): Condition[]`
  - `describeCommonEventConditions(ev: CommonEvent, data: GameData): Condition[]`
  - `describeTroopPageConditions(c: TroopPageConditions, span: number, data: GameData): Condition[]`
  - `describeBranchCondition(params: any[], data: GameData): Condition`

문구(정확히):
- 스위치: `스위치: 숲 개방 ON` / `OFF`; refs `[{type:"switch",id}]`
- 변수(페이지): `변수: 호감도 ≥ 5`
- 셀프 스위치: `셀프 스위치 A ON`; ref `{type:"selfSwitch", id:"A"}`
- 아이템 보유: `아이템: 낡은 열쇠 보유`; 무기/방어구: `무기: X 보유`, `방어구: X 보유`
- 배우: `파티에 레나 있음` (조건 분기 actor subtype 0일 때도 같음, 다른 subtype은 `배우: 레나 (조건 유형 n)`)
- 트리거: `실행: 결정 키`, `실행: 플레이어 접촉`, `실행: 이벤트 접촉`, `실행: 자동 실행`, `실행: 병렬 처리` (refs 없음). 공통 이벤트 trigger 0이면 트리거 항목 없음, 1 `실행: 자동 실행`, 2 `실행: 병렬 처리` + 스위치 조건 `스위치: X ON`.
- 전투: `턴 종료 시`, `턴 A + B*X` 형식 `턴: 1 + 0×X`, `적 #1 HP ≤ 50%`, `레나 HP ≤ 50%`, 스위치. span: 0 `범위: 전투`, 1 `범위: 턴`, 2 `범위: 순간`.
- 조건 분기 변수 연산자 `[=, ≥, ≤, >, <, ≠]`; 피연산자가 변수(params[2]===1)면 `변수: A ≥ 변수: B`.
- 골드: `소지금 ≥ 100G` (연산자 `[≥, ≤, <]`)
- 타이머 `타이머 ≥ 1분 30초`, 캐릭터 방향 `캐릭터 n 방향 = 아래/왼쪽/오른쪽/위`, 버튼 `버튼: ok 누름`, 탈것 `탈것 n 탑승 중`, 적 `적 #n 등장`, 스크립트 `스크립트: <원문>`. 그 외 알 수 없는 유형 `알 수 없는 조건 (유형 n)`.

- [ ] **Step 1: 실패 테스트** (sample-mz 데이터 사용)

```ts
it("page with switch 1", () => expect(describePageConditions({ ...emptyConds, switch1Valid: true, switch1Id: 1 }, 0, data).map(c => c.text))
  .toEqual(["스위치: 숲 개방 ON", "실행: 결정 키"]));
it("page with variable/self/item", () => expect(describePageConditions({ ...emptyConds, variableValid: true, variableId: 1, variableValue: 5, selfSwitchValid: true, selfSwitchCh: "B", itemValid: true, itemId: 1 }, 3, data).map(c => c.text))
  .toEqual(["변수: 호감도 ≥ 5", "셀프 스위치 B ON", "아이템: 낡은 열쇠 보유", "실행: 자동 실행"]));
it("unnamed switch", () => expect(describeBranchCondition([0, 2, 1], data).text).toBe("스위치: #2 OFF"));
it("branch variable >= const", () => {
  const c = describeBranchCondition([1, 1, 0, 5, 1], data);
  expect(c.text).toBe("변수: 호감도 ≥ 5");
  expect(c.refs).toEqual([{ type: "variable", id: 1 }]);
});
it("branch variable vs variable", () => expect(describeBranchCondition([1, 1, 1, 2, 5], data).refs)
  .toEqual([{ type: "variable", id: 1 }, { type: "variable", id: 2 }]));
it("branch gold", () => expect(describeBranchCondition([7, 100, 0], data).text).toBe("소지금 ≥ 100G"));
it("branch script", () => expect(describeBranchCondition([12, "$gameParty.size() > 2"], data).text).toBe("스크립트: $gameParty.size() > 2"));
it("unknown type", () => expect(describeBranchCondition([42], data).text).toBe("알 수 없는 조건 (유형 42)"));
it("troop page", () => expect(describeTroopPageConditions(sampleTroopConds, 0, data).map(c => c.text)).toEqual(["턴: 1 + 0×X", "범위: 전투"]));
```

- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** `npx vitest run src/core/conditions` PASS
- [ ] **Step 5:** 커밋 `feat(core): human-readable conditions`

---

### Task 6: 명령 해석기

**Files:**
- Create: `src/core/interpret/interpret.ts`
- Test: `src/core/interpret/interpret.test.ts`

**Interfaces:**
- Consumes: `EventCommand`, `GameData`, `formatText`, `describeBranchCondition`, 이름 헬퍼
- Produces: `interpret(list: EventCommand[], data: GameData): ScriptNode[]`, `hasDialogue(nodes: ScriptNode[]): boolean`

**알고리즘:** 커서 기반 재귀 하강. `parseBlock(indent)`는 `cmd.indent < indent`인 명령을 만나거나 목록이 끝나면 반환한다. 블록 여는 명령(102, 111, 112)은 하위 분기 본문을 `parseBlock(indent+1)`로 읽고, 같은 indent의 다음 분기 마커(402/403, 411)나 종료 마커(404, 412, 413)를 소비한다. 종료 마커가 없으면(깨진 구조) 그 자리에서 블록을 닫는다. 코드 `0`은 소비하고 무시한다. indent가 기대보다 큰 명령은 현재 블록에 그대로 이어 처리한다. 예외를 던지지 않는다.

**노드 규칙:**
- 101: 이후 연속 401 줄을 `formatText`로 처리해 `lines`. `face`는 `params[0]`이 빈 문자열이면 생략. `speaker` = (engine MZ이고 `params[4]` 비어 있지 않으면) `formatText(params[4])`, 아니면 `faceName`·`faceIndex`가 일치하는 첫 배우의 이름, 아니면 생략.
- 105 + 405: `scroll`. 102: `choices` (`branches[i].label = formatText(params[0][i])`), 403 분기는 `cancelBranch`.
- 111: `conditional`, `condition = describeBranchCondition(params)`. 411 이후는 `else`. else 본문이 비어 있으면 `else`는 `[]`(UI가 빈 분기로 표시).
- 112 … 413: `loop`. 113(루프 탈출)은 `other`.
- 231: `params[1]`이 빈 문자열이면 `other`로 보낸다. 아니면 `picture`.
- 117: `commonEvent`. 201: `params[0]===0`이면 `mapId: params[1], x: params[2], y: params[3]`, 아니면 `mapId: null`.
- `stateChange` description 형식: 121 `스위치 숲 개방 → ON` (범위면 `스위치 #1~#3 → OFF`, refs는 각 id), 122 `변수 호감도 = 5` / `+= 5` / `-=` / `*=` / `/=` / `%=` (피연산자: 상수 숫자, 변수면 `[변수: 이름]`, 랜덤 `랜덤 a~b`, 그 외 `(게임 데이터)` / `(스크립트)`), 123 `셀프 스위치 A → ON`, 125 `소지금 +100G` / `-100G`(피연산자 변수면 `[변수: 이름]G`), 126 `아이템 은 반지 +1`, 127 `무기 X +1`, 128 `방어구 X +1`, 129 `파티에 레나 추가` / `파티에서 레나 제외`.
- 나머지 모든 코드(235, 250, 225, 357, 356, 355+655, 알 수 없는 코드 등)는 연속된 것끼리 하나의 `other`로 묶는다. 다른 노드가 끼면 새 `other`를 시작한다.
- `hasDialogue`: message, scroll, choices가 하나라도 있으면(하위 블록 포함) true.

- [ ] **Step 1: 실패 테스트** (sample-mz Map002 EV1 page 0 = `list`)

```ts
const nodes = interpret(ev1Page0.list, data);
it("produces the expected top-level kinds", () => expect(nodes.map(n => n.kind)).toEqual(
  ["message", "message", "message", "picture", "message", "choices", "conditional", "scroll", "commonEvent", "other", "transfer"]));
it("message with MZ speaker and escapes", () => expect(nodes[0]).toEqual(
  { kind: "message", face: { name: "People1", index: 3 }, speaker: "촌장", lines: ["왔구나, 레나.", "숲이 이상하다는 소문은 들었겠지?"] }));
it("infers speaker from face", () => expect((nodes[1] as any).speaker).toBe("레나"));
it("faceless message is narration", () => expect(nodes[2]).toEqual({ kind: "message", lines: ["(창밖에서 바람 소리가 들린다.)"] }));
it("choices with branches", () => {
  const c = nodes[5] as Extract<ScriptNode, { kind: "choices" }>;
  expect(c.branches.map(b => b.label)).toEqual(["네, 도울게요", "생각해볼게요"]);
  expect(c.branches[0].body.map(n => n.kind)).toEqual(["message", "stateChange"]);
  expect(c.branches[0].body[1]).toMatchObject({ description: "스위치 숲 개방 → ON", refs: [{ type: "switch", id: 1 }] });
  expect(c.branches[1].body).toEqual([]);
});
it("conditional with then/else", () => {
  const c = nodes[6] as Extract<ScriptNode, { kind: "conditional" }>;
  expect(c.condition.text).toBe("변수: 호감도 ≥ 5");
  expect(c.then[1]).toMatchObject({ kind: "stateChange", description: "아이템 은 반지 +1" });
  expect(c.else).toEqual([]);
});
it("groups other commands", () => expect((nodes[9] as any).commands.map((c: any) => c.code)).toEqual([250, 225, 357, 9999]));
it("transfer", () => expect(nodes[10]).toEqual({ kind: "transfer", mapId: 3, x: 5, y: 12 }));
it("MV speaker comes from face", () => /* sample-mv Map001 EV1 */ expect((mvNodes[0] as any).speaker).toBe("레나"));
it("survives missing end markers", () => {
  const broken = [{ code: 102, indent: 0, parameters: [["a"], 1, 0, 2, 0] }, { code: 402, indent: 0, parameters: [0, "a"] },
    { code: 101, indent: 1, parameters: ["", 0, 0, 2] }, { code: 401, indent: 1, parameters: ["x"] },
    { code: 101, indent: 0, parameters: ["", 0, 0, 2] }, { code: 401, indent: 0, parameters: ["after"] }];
  const out = interpret(broken, data);
  expect(out.map(n => n.kind)).toEqual(["choices", "message"]);
  expect((out[1] as any).lines).toEqual(["after"]);
});
it("survives indent jumps and unknown codes", () => expect(() => interpret([
  { code: 401, indent: 3, parameters: ["orphan"] }, { code: 411, indent: 0, parameters: [] }, { code: 77, indent: 0, parameters: [] }], data)).not.toThrow());
it("empty picture name becomes other", () => expect(interpret([{ code: 231, indent: 0, parameters: [1, "", 0] }], data)[0].kind).toBe("other"));
it("hasDialogue", () => {
  expect(hasDialogue(nodes)).toBe(true);
  expect(hasDialogue(interpret([{ code: 250, indent: 0, parameters: [{}] }, { code: 0, indent: 0, parameters: [] }], data))).toBe(false);
});
```

- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** `npx vitest run src/core/interpret` PASS
- [ ] **Step 5:** 커밋 `feat(core): event command interpreter`

---

### Task 7: 이미지 복호화 + 에셋 저장소

**Files:**
- Create: `src/core/assets/decrypt.ts`, `src/core/assets/assets.ts`
- Test: `src/core/assets/assets.test.ts`

**Interfaces:**
- Consumes: `GameFolder`, `GameData`
- Produces:
  - `decryptImage(buf: ArrayBuffer, keyHex: string): ArrayBuffer` — 앞 16바이트 제거, 다음 16바이트를 키 바이트와 XOR.
  - `class AssetStore { constructor(folder: GameFolder, data: GameData); load(kind: "faces" | "pictures", name: string): Promise<Blob | null> }` — 후보 순서: `<imgRoot>/<kind>/<name>.png`, `.png_`, `.rpgmvp`. 암호화 파일이고 키가 없으면 `null`. 결과(실패 포함)는 `kind/name` 키로 Promise 캐시. Blob type `image/png`. `name`이 빈 문자열이면 즉시 `null`.
  - UI가 Blob → object URL 변환을 담당한다(core는 `URL`을 쓰지 않음).

- [ ] **Step 1: 실패 테스트**

```ts
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
it("decrypts MZ face to a valid PNG", async () => {
  const blob = await new AssetStore(folder, data).load("faces", "People1");
  expect([...new Uint8Array(await blob!.arrayBuffer()).slice(0, 8)]).toEqual(PNG_SIG);
});
it("finds plain file with different case", async () => expect(await store.load("faces", "Actor1")).not.toBeNull());
it("decrypts MV .rpgmvp", async () => { /* sample-mv faces/Actor1 → PNG_SIG */ });
it("returns null for missing", async () => expect(await store.load("pictures", "nope")).toBeNull());
it("returns null for empty name", async () => expect(await store.load("faces", "")).toBeNull());
it("caches", async () => expect(store.load("faces", "People1")).toBe(store.load("faces", "People1")));
```

- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** `npx vitest run src/core/assets` PASS
- [ ] **Step 5:** 커밋 `feat(core): image decryption and asset store`

---

### Task 8: 페이지 목록 + 검색 + 상호참조 색인

**Files:**
- Create: `src/core/index/locations.ts`, `src/core/index/buildIndex.ts`
- Test: `src/core/index/buildIndex.test.ts`

**Interfaces:**
- Consumes: `GameData`, `interpret`, `hasDialogue`, `describe*Conditions`
- Produces: `buildIndex(data: GameData): GameIndex`, `locationKey(loc: Location): string`(예: `map:2:1:0`, `common:1`, `troop:1:0`)

**규칙:**
- `pages` 순서: 맵(MapInfos의 `order` 순, 맵 안에서 이벤트 id 순, 페이지 순) → 공통 이벤트(id 순) → 전투(id 순, 페이지 순). null 항목은 건너뛴다.
- `path`: 맵 `"<맵 이름> › <이벤트 title> › p<page+1>"`, 공통 `"공통 이벤트 › <이름>"`, 전투 `"전투 › <이름> › p<page+1>"`. 맵 이름은 MapInfo.name.
- `title`: 이벤트 이름이 `/^EV\d+$/`가 아니면 이벤트 이름. 맞으면 해당 이벤트의 첫 페이지들 중 첫 message에서 `speaker`가 있으면 `${speaker} — "${첫 줄 앞 20자}…"`, 없으면 `"${첫 줄 앞 20자}…"`(20자 이하면 `…` 없이; 자른 뒤 `trimEnd()` 후 `…`를 붙인다), message가 없으면 원래 이름. 공통/전투는 그 이름.
- `conditions`: 맵 페이지 → `describePageConditions`, 공통 → `describeCommonEventConditions`, 전투 → `describeTroopPageConditions`.
- 검색: message lines, speaker, scroll lines, choice labels를 하위 블록까지 수집. `query`를 소문자로 바꿔 `includes`. 빈 query는 `[]`. 기본 limit 200. `SearchHit.text`는 일치한 문자열 전체(줄 또는 라벨).
- 상호참조 키 `${type}:${id}`. writes: `stateChange.refs`. reads: 페이지 `conditions[].refs`, `conditional.condition.refs`. 같은 페이지는 목록에 한 번만. selfSwitch는 이벤트마다 다르므로 xref 대상에서 제외(UI도 클릭 불가).
- `callers(id)`: `commonEvent` 노드를 포함한 페이지.

- [ ] **Step 1: 실패 테스트** (sample-mz)

```ts
const idx = buildIndex(data);
it("orders pages and skips nulls", () => expect(idx.pages.map(p => p.path)).toEqual([
  "촌장의 집 › 촌장 › p1",
  "촌장의 집 › 촌장 › p2",
  "촌장의 집 › \"낡은 책이 꽂혀 있다. 숲의 전설에…\" › p1",
  "숲 입구 › 문 › p1",
  "공통 이벤트 › 밤의 장면",
  "전투 › 슬라임 › p1",
]));
it("flags dialogue", () => expect(idx.pages.find(p => p.path.startsWith("숲 입구"))!.hasDialogue).toBe(false));
it("searches nested text", () => {
  const hits = idx.search("고맙네");
  expect(hits).toHaveLength(1);
  expect(hits[0].entry.path).toBe("촌장의 집 › 촌장 › p1");
  expect(hits[0].nodePath).toEqual([5, 0, 0]);
});
it("uses speaker in title for EV### names", () => {
  // MV 픽스처: EV001 → 첫 화자 레나
  expect(buildIndex(mvData).pages[0].title).toBe("레나 — \"MV 대사입니다.\"");
});
it("searches choice labels and speakers", () => {
  expect(idx.search("생각해볼게요")[0].text).toBe("생각해볼게요");
  expect(idx.search("촌장").length).toBeGreaterThan(0);
});
it("empty query", () => expect(idx.search("  ")).toEqual([]));
it("xref switch 1", () => {
  const x = idx.xref({ type: "switch", id: 1 });
  expect(x.writes.map(p => p.path)).toEqual(["촌장의 집 › 촌장 › p1"]);
  // 밤의 장면은 trigger 0이라 switchId가 조건이 아니다 → reads에 없음
  expect(x.reads.map(p => p.path)).toEqual(["촌장의 집 › 촌장 › p2"]);
});
it("xref variable read in branch", () => expect(idx.xref({ type: "variable", id: 1 }).reads.map(p => p.path)).toEqual(["촌장의 집 › 촌장 › p1"]));
it("callers", () => expect(idx.callers(1).map(p => p.path)).toEqual(["촌장의 집 › 촌장 › p1"]));
it("locationKey", () => expect(locationKey({ source: "map", mapId: 2, eventId: 1, page: 0 })).toBe("map:2:1:0"));
```

- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** `npx vitest run src/core/index` PASS, `npx vitest run` 전체 PASS
- [ ] **Step 5:** 커밋 `feat(core): page list, search and cross-reference index`

---

### Task 9: 앱 셸 — 라우팅, 폴더 열기, 사이드바

**Files:**
- Create: `src/app/route.ts`, `src/app/route.test.ts`, `src/app/recent.ts`, `src/app/GameProvider.tsx`, `src/ui/StartScreen.tsx`, `src/ui/AppSidebar.tsx`, `src/ui/ErrorsBadge.tsx`
- Modify: `src/App.tsx`, `src/main.tsx` (Vite 템플릿 내용 교체, `App.css`/템플릿 에셋 삭제)

**Interfaces:**
- Consumes: `loadGame`, `buildIndex`, `AssetStore`, `DirectoryHandleFolder`, `FileListFolder`, `PageEntry`, `locationKey`
- Produces:
  - `type Route = { kind: "home" } | { kind: "page"; location: Location }`; `parseRoute(hash: string): Route`; `formatRoute(r: Route): string`. 형식: `#/map/12/event/3/page/1`(page는 1부터 표기, 내부는 0부터), `#/common/5`, `#/troop/2/page/1`. 알 수 없는 해시는 `home`.
  - `useRoute(): [Route, (r: Route) => void]` (hashchange 구독, 설정 시 `location.hash` 변경)
  - `useGame(): { status: "idle" | "loading" | "ready" | "error"; data?: GameData; index?: GameIndex; assets?: AssetStore; error?: LoadResult; openHandle(h: FileSystemDirectoryHandle): Promise<void>; openFiles(f: FileList): Promise<void> }`
  - `recent.ts`: `saveRecent(h: FileSystemDirectoryHandle): Promise<void>`, `loadRecent(): Promise<FileSystemDirectoryHandle | null>` (IndexedDB `rpg-viewer` / store `recent` / key `last`, 모든 오류는 삼켜서 null)
  - `src/ui/navigation.ts`: `openPage(loc: Location)` 헬퍼 — UI 전역에서 이동할 때 사용

- [ ] **Step 1: 실패 테스트** `src/app/route.test.ts`

```ts
it("parses map page", () => expect(parseRoute("#/map/12/event/3/page/2")).toEqual({ kind: "page", location: { source: "map", mapId: 12, eventId: 3, page: 1 } }));
it("parses common", () => expect(parseRoute("#/common/5")).toEqual({ kind: "page", location: { source: "common", commonEventId: 5 } }));
it("round-trips troop", () => { const h = "#/troop/2/page/1"; expect(formatRoute(parseRoute(h))).toBe(h); });
it("unknown is home", () => { expect(parseRoute("")).toEqual({ kind: "home" }); expect(parseRoute("#/map/x")).toEqual({ kind: "home" }); });
```

- [ ] **Step 2:** FAIL → **Step 3:** `route.ts` 구현 → **Step 4:** PASS
- [ ] **Step 5: 화면 구현**
  - `StartScreen`: 화면 중앙 `Card` (제목 "RPG Viewer", 설명 "RPG Maker MV/MZ 게임 폴더를 열어 대사와 장면을 한눈에 보세요."), `Button` "게임 폴더 열기"(`showDirectoryPicker` 있으면 사용, 없으면 숨겨진 `<input type="file" webkitdirectory>`), 최근 핸들이 있으면 `Button variant="outline"` "최근 게임 다시 열기: <폴더 이름>" (`requestPermission({mode:"read"})` 거부 시 `Alert` "권한이 거부되었어요. 폴더를 다시 선택해 주세요."). 로딩 중 `Skeleton`. 실패 시 `Alert variant="destructive"`: notFound → "MV/MZ 게임 폴더가 아니에요" + 찾아본 경로 목록, encrypted → "지원하지 않는 암호화 방식이에요 (<file>)".
  - `App`: status가 ready가 아니면 `StartScreen`. ready면 shadcn `SidebarProvider` + `AppSidebar` + `SidebarInset` 레이아웃(공식 sidebar 예제 구조). 헤더: `SidebarTrigger`, `Breadcrumb`(PageEntry.path를 ` › `로 나눔), 오른쪽에 게임 제목 · `Badge variant="secondary"`(엔진) · `ErrorsBadge` · 검색 버튼(Task 11에서 연결, 지금은 자리만). route가 home이면 본문에 "왼쪽에서 이벤트를 선택하세요" muted 텍스트.
  - `AppSidebar`: `SidebarHeader`에 "대사 없는 항목 표시" 토글(shadcn `Switch`가 필요하면 `npx shadcn@latest add switch`). `SidebarGroup` 3개: "맵" — MapInfos `parentId` 트리를 `Collapsible` + `SidebarMenuSub`로, 맵 아래에 이벤트(같은 eventId의 페이지들 중 첫 PageEntry의 title, 클릭 시 page 0으로 이동), "공통 이벤트", "전투". 토글 OFF면 `hasDialogue`인 페이지가 하나도 없는 이벤트를 숨기고, 보일 이벤트·하위 맵이 없는 맵도 숨긴다. `errors`에 `mapId`가 있는 맵은 숨기지 않고 `TriangleAlert` 아이콘 + `Tooltip`(오류 메시지). 현재 route와 일치하는 항목은 `isActive`.
  - `ErrorsBadge`: errors가 0이면 렌더링 안 함. 아니면 `Badge variant="destructive"` "오류 N" → 클릭 시 `Dialog`에 `file: message` 목록.
- [ ] **Step 6:** `npm run build` 성공. `npm run dev` 후 브라우저에서 `tests/fixtures/sample-mz` 폴더를 열어 확인: 사이드바에 "마을 › 촌장의 집"(촌장, `"낡은 책이…"`), 공통 이벤트 "밤의 장면", 전투 "슬라임"이 보이고, "숲 입구"는 토글 OFF에서 숨겨지며 ON에서 보이고, "잃어버린 맵"은 ⚠와 함께 보이고, 오류 Badge가 1개.
- [ ] **Step 7:** 커밋 `feat(ui): app shell, folder opening, sidebar`

---

### Task 10: 이벤트 화면 + 대본 렌더러

**Files:**
- Create: `src/ui/EventView.tsx`, `src/ui/script/ScriptView.tsx`, `src/ui/script/MessageNode.tsx`, `src/ui/script/BlockNode.tsx`, `src/ui/script/PictureNode.tsx`, `src/ui/script/OtherNode.tsx`, `src/ui/script/FaceImage.tsx`, `src/ui/script/useAssetUrl.ts`, `src/ui/RefBadge.tsx`
- Modify: `src/App.tsx` (route가 page면 `EventView`)

**Interfaces:**
- Consumes: `useGame`, `useRoute`, `openPage`, `PageEntry`, `ScriptNode`, `AssetStore`
- Produces: `<ScriptView nodes basePath={[]} />` — 각 노드 래퍼에 `data-node-path={path.join(".")}`. `<RefBadge condition={Condition} />` — refs 중 switch/variable/item/weapon/armor가 있으면 클릭 가능(Task 11에서 Sheet 연결, 지금은 `onRefClick?: (ref: Ref) => void` prop). `useAssetUrl(kind, name): string | null | undefined`(undefined=로딩) — Blob을 object URL로 만들고 unmount 시 revoke.

**표시 규칙** (spec "대본 렌더링 규칙" 표 그대로, shadcn 토큰만 사용):
- `EventView`: location에 해당하는 PageEntry들(같은 이벤트의 모든 페이지). 페이지가 2개 이상이면 `Tabs`(라벨 `페이지 1`…; 탭 변경 시 route 갱신). 위에 "나타나는 조건" muted 라벨 + 조건 `RefBadge`(조건 없으면 "항상"). 본문은 `Card` 안에 `ScriptView`. 공통 이벤트면 상단에 `Collapsible` "호출하는 곳 N곳"(callers, 클릭 이동). 해당 location이 없으면 "찾을 수 없는 이벤트예요" muted.
- message: `FaceImage`(40px, 시트 4열×2행 중 index 칸, 원본 칸 144px → `background-size: 160px 80px`, `background-position: -(index%4)*40px -floor(index/4)*40px`, 로딩/실패 시 `bg-muted` 사각형) + speaker(`font-semibold text-sm`) + 본문(`whitespace-pre-line`). face 없으면 얼굴 칸 비우고 `italic text-muted-foreground`.
- scroll: `rounded-md border bg-muted/50 p-4 text-center whitespace-pre-line`.
- choices / conditional / loop (`BlockNode`): `rounded-md border` 박스, 헤더 줄 `bg-muted/50 border-b px-3 py-1.5 text-sm font-medium`("선택지" / "만약 " + RefBadge / "반복"). 분기는 `Collapsible`, 기본 open, 본문이 비어 있으면 기본 closed + 라벨 옆 `(대사 없음)`. 분기 라벨: choices `"<label>"`, cancel `취소했을 때`, conditional `그렇다면` / `아니라면`. 분기 본문은 `border-l-2 pl-3 ml-1`.
- picture: 썸네일 `h-[68px] w-[120px] object-cover rounded-md`(실패 시 `bg-muted` + 파일명) + `🖼 그림 #<id> 표시: <name>`. 클릭 시 `Dialog`에 원본(`max-h-[80vh]`).
- stateChange: `⚙ <description>` `text-sm text-muted-foreground`. refs가 있으면 끝에 작은 링크 아이콘 버튼으로 `onRefClick`.
- commonEvent: `↪ 공통 이벤트 [이름] 실행` — 이름 부분은 `Button variant="link" size="sm"`로 해당 공통 이벤트로 이동. 이름 없으면 `#id`.
- transfer: `🚪 이동 → [맵 이름] (x, y)` — 맵 이름 링크 클릭 시 그 맵의 첫 PageEntry로 이동(없으면 링크 비활성). `mapId: null`이면 `🚪 이동 → (변수로 지정된 위치)`.
- other: `Collapsible` 트리거 `기타 명령 N개` (`text-xs text-muted-foreground`, 점선 테두리 `border-dashed`). 펼치면 `코드 <code>: <JSON.stringify(parameters)>` 목록(`font-mono text-xs`).
- 노드 사이 간격 `space-y-2`, 본문 최대 폭 `max-w-3xl`.

- [ ] **Step 1:** 구현
- [ ] **Step 2:** `npm run build` 성공
- [ ] **Step 3:** 브라우저에서 sample-mz의 "촌장" 확인: 페이지 탭 2개, p1 조건 "항상"이 아닌 `실행: 결정 키`, 얼굴 이미지(복호화된 People1 3번 칸 색) 표시, "레나" 화자 추정, 내레이션 기울임, 그림 썸네일 클릭 시 Dialog, 선택지 두 분기("생각해볼게요"는 접힘 + "(대사 없음)"), 조건 분기 "아니라면" 접힘, 스크롤 박스, "밤의 장면" 링크 클릭 시 공통 이벤트로 이동하고 "호출하는 곳 1곳" 표시, "기타 명령 4개" 펼침, "숲 입구" 링크 이동. p2 탭에서 `스위치: 숲 개방 ON` Badge. sample-mv를 열어 MV 얼굴(.rpgmvp)도 표시되는지 확인.
- [ ] **Step 4:** 커밋 `feat(ui): event view and script renderer`

---

### Task 11: 검색 + 상호참조 Sheet

**Files:**
- Create: `src/ui/SearchDialog.tsx`, `src/ui/XrefSheet.tsx`, `src/ui/highlight.ts`
- Modify: `src/App.tsx`(검색 버튼, `Ctrl+K`/`⌘K`), `src/ui/EventView.tsx`, `src/ui/RefBadge.tsx`, stateChange 렌더러(`onRefClick` → XrefSheet 열기)

**Interfaces:**
- Consumes: `GameIndex.search`, `GameIndex.xref`, `openPage`, `data-node-path`
- Produces: `highlightNode(nodePath: number[])` — 이동 후 다음 프레임에 `[data-node-path="..."]`를 찾아 `scrollIntoView({block:"center"})` + `ring-2 ring-primary` 클래스를 2초간 추가. 대상이 접힌 Collapsible 안에 있으면 렌더러는 `forceOpenPaths` 문맥(React context)으로 해당 분기를 열어 둔다.

- `SearchDialog`: shadcn `CommandDialog`(공식 예제 형식). `shouldFilter={false}`로 두고 입력값을 `index.search(q)`에 넘긴다(200건). 결과는 `CommandGroup heading={entry.path}`로 묶고 각 `CommandItem`은 hit.text(일치 부분 `font-semibold`). 결과 없음 `CommandEmpty` "결과가 없어요". 선택 시 닫고 `openPage(entry.location)` → `highlightNode(hit.nodePath)`.
- `XrefSheet`: shadcn `Sheet`(side right). 제목: `스위치: 숲 개방` / `변수: 호감도` / `아이템: 낡은 열쇠` 등. 섹션 "값을 바꾸는 곳 (N)", "조건으로 쓰는 곳 (N)" — 각 항목은 PageEntry.path 버튼, 클릭 시 이동(Sheet 닫힘). 비어 있으면 "없음" muted.
- Ref가 여러 개인 Badge(변수 vs 변수 등)를 클릭하면 첫 번째 ref를 연다. selfSwitch, actor, map, commonEvent ref는 클릭 대상 아님.

- [ ] **Step 1:** 구현
- [ ] **Step 2:** `npm run build` 성공, `npx vitest run` 전체 PASS
- [ ] **Step 3:** 브라우저 확인: `Ctrl+K` → "고맙네" 입력 → 결과 선택 시 촌장 p1로 이동, 선택지 분기 안의 해당 줄이 가운데로 스크롤되고 2초간 강조. "생각해볼게요" 검색 시 분기 라벨 hit. p2의 `스위치: 숲 개방 ON` 클릭 → Sheet에 "값을 바꾸는 곳 (1): 촌장의 집 › 촌장 › p1", "조건으로 쓰는 곳 (2)". 선택지 안 `⚙ 스위치 숲 개방 → ON`의 링크 버튼도 같은 Sheet를 연다.
- [ ] **Step 4:** 커밋 `feat(ui): search dialog and cross-reference sheet`

---

### Task 12: 마무리 검증

**Files:**
- Create: `README.md` (실행 방법: `npm install`, `npm run dev`, 크롬/엣지에서 게임 폴더 열기; 지원 범위; 픽스처 재생성 `node scripts/make-fixture-images.mjs`)
- Delete: `src/smoke.test.ts`

- [ ] **Step 1:** `npx vitest run` 전체 PASS, `npm run build` 성공, `npx tsc -b` 오류 없음, `npm run lint`(템플릿 ESLint) 오류 없음
- [ ] **Step 2:** `src/core/**`에 `react`/`window`/`document`/`indexedDB` 참조가 없는지 확인: `grep -rnE "from \"react\"|window\.|document\.|indexedDB" src/core` → 결과 없음
- [ ] **Step 3:** 커밋 `docs: README and final cleanup`
