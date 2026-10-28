# RPG Viewer 2.2단계 (기록 UX + 성능) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기록 탭을 "아래로 쌓이고 아래에서 보는" 흐름으로 바꾸고(하단 고정 카드, 자동 스크롤, 맨 아래로 버튼, 종류별 표시 토글), 긴 플레이에서도 기록 파일·뷰어 계산이 커지지 않게 한다.

**Architecture:** UI는 `src/ui/live/HistoryView.tsx` 재구성. 성능은 플러그인 1.0.3(잦은 변수 기록 축소), core 증분 누적기 `src/core/live/accumulator.ts`(새 기록만 반영해 모델·진행도·잦은 변수 갱신), LiveProvider가 누적기를 사용, 설치 창에 기록 크기 표시.

**Tech Stack:** 기존과 동일.

**Spec (사용자 요청, 이 문서가 스펙을 겸함):**
1. 선택지·"지금 이후"는 최신 기록과 같은 **하단**에 보여야 한다.
2. 최신 기록이 오면 **자동으로 아래로 스크롤**, 아래로 바로 가는 버튼.
3. 기록에서 볼 종류를 **토글**로 고른다(예: 대사와 그림만).
4. 데이터가 빠르게 쌓여도 느려지지 않게 최적화.

## Global Constraints
- 기존 Global Constraints 유지(shadcn만, core 순수성, 예외 금지, 한국어 문구, 플러그인 ES5·try/catch, 커밋 트레일러 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
- 화면 문구(정확히): 토글 라벨 `대사`, `선택`, `그림`, `이동`, `전투`, `상태 변경`, `저장·불러오기`; 버튼 `최신으로`(새 항목이 있으면 `최신으로 · 새 {N}`); 카드 접기 버튼 aria-label `접기` / `펼치기`; 설치 창 `기록 크기 {크기} · {N}줄`(크기는 KB/MB 한 자리 소수).
- 사용자 실제 게임 폴더·기록은 읽지 않는다.

## Review Focus
1. 증분 누적기 결과가 기존 일괄 함수(buildHistory/computeCoverage/noisyVariables)와 **항상 같아야** 한다(같은 입력 → 같은 출력). (Task 1)
2. reset(기록 파일 줄어듦) 시 누적기가 처음부터 다시 쌓는다. (Task 3)
3. 자동 스크롤이 사용자가 위로 올려 읽는 중일 때는 끌어내리지 않는다. (Task 4)
4. 플러그인 축소가 스위치·대사 기록과 갈래 스탬프에 영향을 주지 않는다. (Task 2)

## 실행 웨이브
- **Wave A (병렬):** Task 1, Task 2, Task 4
- **Wave B:** Task 3 (Task 1 병합 후)

---

### Task 1: 증분 누적기 (core)

**Files:** Create `src/core/live/accumulator.ts` + test

**Interfaces — Produces:**
```ts
export interface LiveAccumulator {
  append(records: LogRecord[]): void;   // seq 순서로 들어온다고 가정, 아니어도 결과는 일괄 함수와 같아야 함
  reset(): void;
  readonly records: LogRecord[];        // 지금까지의 전체(append 순)
  readonly version: number;             // append/reset마다 +1
  model(): HistoryModel;                // 캐시: version이 바뀔 때만 재생성(내부 상태로부터 O(branches))
  coverage(): Coverage;
  noisy(): Set<number>;
}
export function createAccumulator(data: GameData): LiveAccumulator;
```
- 내부 상태를 새 기록만으로 갱신: 갈래 정보(branchStart, lastSeq/lastT, children), 진행도(seen, picks와 그 aftermath — 아직 3개가 안 찬 pick은 같은 갈래의 이후 기록이 올 때 계속 채움, 같은 갈래 다음 choice에서 닫음), uncertain/changed, 잦은 변수(변수별 최근 60초 시각 창 — 10회 초과가 한 번이라도 있으면 noisy).
- 반환 객체(model/coverage/noisy)는 version이 같으면 같은 객체(React memo용). 새 version이면 새 객체(얕은 복사 가능).
- [ ] Step 1 실패 테스트: (a) 픽스처 기록을 한 번에/한 줄씩/무작위 크기 묶음으로 append한 결과가 `buildHistory`·`computeCoverage`·`noisyVariables` 결과와 deep-equal(Map/Set 비교 헬퍼). (b) 갈래 2에서 고른 뒤 이후 기록이 나중에 들어와도 aftermath가 일괄 결과와 같음. (c) reset 후 비어 있음. (d) 성능: 200k 기록 누적 상태에서 1,000줄 append + coverage()/model() 호출이 50ms 미만(여유 있게; 측정값 로그).
- [ ] Step 2 FAIL → 3 구현 → 4 `npx vitest run`, tsc → 5 커밋 `feat(core): incremental live accumulator`

### Task 2: 플러그인 1.0.3 — 잦은 변수 기록 축소

**Files:** Modify `plugin/RPGViewerBridge.js`, `tests/plugin/bridge.test.ts`

- 변수별로 최근 60초 안의 변경 횟수를 센다. 30회를 넘으면 그 변수는 "잦음"으로 표시하고, 이후 그 변수의 변경은 **10초에 한 번만**(그 시점의 마지막 값) 기록한다. 60초 동안 30회 이하로 떨어지면 해제.
- 스위치·셀프 스위치·대사·선택·세이브 스탬프 등 다른 기록은 영향 없음. 상태 묶음(같은 창 마지막 값) 규칙 유지.
- VERSION `"1.0.3"`.
- [ ] 테스트(주입된 now): 매 16ms 변수 변경 2분 → 해당 변수 state 변경 수가 (첫 30여 회 + 10초당 1회) 수준으로 제한; 마지막 값이 기록됨; 스위치 변경은 매번 기록; 느려지면 해제 후 다시 매번 기록. VERSION 1회.
- [ ] test/lint → 커밋 `feat(plugin): throttle frequently changing variables (1.0.3)`

### Task 3: LiveProvider가 누적기 사용 + 기록 크기 표시

**Files:** Modify `src/app/LiveProvider.tsx`, `src/ui/live/InstallDialog.tsx`; (필요 시) `src/core/live/tail.ts`는 수정하지 않는다

- poll 결과의 새 기록을 누적기에 append, reset이면 accumulator.reset() 후 append. 화면용 파생값(model/coverage/noisy)은 기존 1초 스로틀을 유지하되 일괄 재계산 대신 누적기 getter 사용. `records`는 누적기의 배열을 그대로 노출(새 version마다 새 배열 참조가 필요하면 `slice()` 대신 version을 context에 추가하고 소비자가 version을 deps로 쓰도록 — HistoryView는 records 길이·version을 deps로 사용).
- `missing`은 coverage나 live 조건 키(`conditionsKey`)가 바뀔 때만 재계산.
- 컨텍스트에 `logStats: { bytes: number; lines: number } | null` 추가(LogTail이 읽은 바이트 = 파일 크기, 줄 = 누적 기록 수 + badLines). InstallDialog 상태 줄에 `기록 크기 {크기} · {N}줄`.
- [ ] build/test/lint → 커밋 `perf(ui): use incremental accumulator, show log size`

### Task 4: 기록 탭 UX — 하단 카드, 자동 스크롤, 최신으로, 종류 토글

**Files:** Modify `src/ui/live/HistoryView.tsx`, `src/ui/live/NowNextCard.tsx`, `src/ui/live/ChoiceNowCard.tsx`; Create `src/ui/live/historyFilter.ts`(+test); shadcn `toggle-group` 추가 가능

- 레이아웃: 기록 탭을 세로 flex로 — 위: 회차·갈래 Select + 종류 토글(ToggleGroup type="multiple"), 가운데: 타임라인 스크롤 영역(이 영역만 스크롤), 아래: 고정 영역에 `NowNextCard`, `ChoiceNowCard`(둘 다 없으면 영역 없음). 탭 전체 높이는 뷰포트에 맞춘다.
- NowNextCard: 접기/펼치기 버튼(aria-label `접기`/`펼치기`), 기본 접힘(제목·경로만), `live.choice`가 새로 나타나면 자동 펼침. ChoiceNowCard는 항상 펼침.
- 자동 스크롤: 타임라인 영역이 바닥 근처(80px 이내)면 새 항목 시 바닥으로. 아니면 그대로 두고 우하단에 `최신으로`(바닥에 있지 않을 때만, 새 항목 수가 있으면 `최신으로 · 새 {N}`) 버튼 — 누르면 바닥으로 스크롤하고 새 항목 수 0.
- 종류 토글: `historyFilter.ts`에 `type Kind = "message" | "choice" | "picture" | "transfer" | "battle" | "state" | "save"`, `itemKind(item: HistoryItem): Kind | null`(branchStart·fork·error는 null = 항상 표시; repeat → message; stateGroup·state → state; scroll → message; load·save → save; choices 기록은 choice), `filterItems(items, enabled: Set<Kind>)`. 기본 전부 켜짐. 선택은 localStorage `rpgv.historyKinds`(try/catch)로 기억.
- 표시 제한(최근 500 + "이전 기록 더 보기")은 필터 후 항목 기준.
- [ ] historyFilter 테스트 RED→GREEN, UI, build/test/lint → 커밋 `feat(ui): bottom-docked history cards, auto-scroll, kind toggles`
