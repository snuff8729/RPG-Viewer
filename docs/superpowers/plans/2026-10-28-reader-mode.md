# 읽기 모드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal (사용자 확정, A안):** 게임은 빠르게 넘기고, 뷰어의 새 `읽기` 탭에서 실제로 지나간 대사·그림을 소설처럼 순서대로 읽는다. 읽은 위치를 따로 기억하고, 선택지는 읽는 흐름 끝에서 판단한다.

## Global Constraints
- 기존 제약(shadcn만, core 순수성, 예외 금지, 한국어 문구, 플러그인 ES5·try/catch, 커밋 트레일러 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). 사용자 게임 폴더는 테스트에 쓰지 않는다.
- 문구(정확히): 탭 `읽기`(탭 순서 `탐색기 | 읽기 | 기록 | 못 본 것`), 장면 구분 `— {맵 이름} —`, 갈래 시작 `— {run}회차 갈래 {n} 시작 —`, 읽음 표시 `여기까지 읽음 · 새 대사 {N}`, 하단 `↓ 다음 (Space)`, `맨 아래로`, `새 대사 {N}`, 선택 기록 `▶ 고른 것: "{라벨}"`, 반복 `↻ 같은 대화 다시 봄 ×{N}`, 전투 `⚔ 전투`, 미리보기 접기 제목 `다음에 나올 대사`, 빈 상태 `게임을 진행하면 지나간 대사가 여기에 쌓여요`, 이전 `이전 대사 더 보기`.

## Task 1: core — 읽기 항목 만들기
**Files:** Create `src/core/live/reader.ts` + test
```ts
export type ReaderItem =
  | { kind: "chapter"; key: string; text: string }                       // transfer, branchStart
  | { kind: "message"; key: string; seq: number; speaker: string; face: string; faceIndex: number; lines: string[]; src: Location | null; cmd: number | null; repeat?: number }
  | { kind: "scroll"; key: string; seq: number; lines: string[] }
  | { kind: "picture"; key: string; seq: number; name: string }
  | { kind: "choice"; key: string; seq: number; label: string }
  | { kind: "battle"; key: string; seq: number };
export function readerItems(items: HistoryItem[], data: GameData, choiceText: Map<number, string>): ReaderItem[];
export function lastSeqOf(item: ReaderItem): number | null;  // chapter → null
```
- 입력은 `foldTimeline` 결과(HistoryItem[]). record: message → formatText된 lines, speaker(formatText, 비면 face로 배우 이름 추정 — 기존 해석 규칙과 같게: 없으면 ""), scroll, picture, choice(라벨은 `choiceText.get(seq)`, 없으면 historyText의 대체 문구 규칙), transfer → chapter `— {맵 이름} —`(이름 없으면 `#{id}`), branchStart → chapter `— {branchLabel} 시작 —`(갈래 라벨은 호출 측이 모델로 계산해 넘기기 어렵다면 `readerItems`에 `model` 인자를 추가해도 된다 — 시그니처를 그렇게 확정해 문서화), battle phase start → battle. repeat → 원 message 항목 + `repeat: count`. state/stateGroup/save/load/error/choices(목록 자체)/fork는 제외.
- key는 안정적(`r{seq}` / `c{seq}`).
- 테스트: 픽스처 기록 갈래 1 경로 → 순서 `chapter(갈래 시작), message×3, picture, message, choice("네, 도울게요"), message, message(EV3, repeat 2), chapter(숲 입구)`; state 없음; 라벨·맵 이름 확인.

## Task 2: 플러그인 1.0.4 — 대사 흐름 즉시 반영
**Files:** Modify `plugin/RPGViewerBridge.js`, `tests/plugin/bridge.test.ts`
- `message`/`scroll`/`choices`/`choice`/`picture`/`transfer` 기록이 생기면 다음 tick(250ms)까지 기다리지 말고 **해당 프레임 끝에 flush**(같은 프레임의 여러 기록은 한 번에). 구현은 setTimeout(0) 1회 예약 등 ES5 방식. 테스트 환경에서는 `_flushNow`로 검증 가능하게.
- live.json: `running`·`runningCmd`·`choice`·`mapId`가 바뀌면 1초 하한을 무시하고 다음 tick에 쓴다(그 외 변경은 기존 1초 하한).
- VERSION `"1.0.4"`.
- 테스트: 대사 기록 후 타이머 진행 없이 다음 프레임(가짜 타이머) 내 파일에 반영; runningCmd 변경 시 1초 안 기다리고 기록; 다른 변수 변경은 여전히 1초 하한.

## Task 3: UI — 읽기 탭
**Files:** Create `src/ui/live/ReaderView.tsx`, `src/ui/live/readPosition.ts`(+test); Modify `src/app/route.ts`(+test: `#/read`), `src/ui/live/LiveTabs.tsx`, `src/App.tsx`(라우트 렌더만)
- 경로: 최신 갈래(`latestBranch`)의 `branchPath` → `foldTimeline`(noisy/uncertain/changed 전달) → `readerItems`. 최근 300개 항목만 렌더 + `이전 대사 더 보기`(위치 유지: 기록 탭의 scroll 복원 방식과 같게).
- 본문은 가운데 정렬 읽기 폭(max-w-2xl), 큰 글씨(text-base, leading-relaxed). message = FaceImage + 화자 + 줄들, picture = `useAssetUrl("pictures", name)` 이미지(전체 폭, max-h-[60vh], object-contain, 실패 시 파일명), chapter = 가운데 muted 구분선.
- 읽은 위치: `readPosition.ts` — `loadReadSeq(gameKey, branch): number`, `saveReadSeq(gameKey, branch, seq)`(localStorage `rpgv.read.{gameKey}.{branch}`, try/catch, 단조 증가만 저장). gameKey = `data.system.gameTitle` + dataRoot.
  - 항목이 화면 아래 끝 위로 완전히 지나가면(IntersectionObserver) 그 항목 seq까지 읽음으로 저장.
  - 마지막 읽은 항목 뒤에 `여기까지 읽음 · 새 대사 {N}` 구분선(N = 이후 message/scroll 수, 0이면 표시 안 함).
  - 하단 바: `↓ 다음 (Space)` = 다음 안 읽은 항목을 화면 위쪽으로 스크롤하고 그 앞까지 읽음 처리, `맨 아래로`, `새 대사 {N}`. Space/↓ 키(입력창 포커스 아닐 때).
  - 따라가기: 사용자가 맨 아래에 있고 새 대사가 0이면(다 읽은 상태) 새 항목이 오면 자동으로 아래로. 아니면 자동 스크롤하지 않는다.
- 선택지: `live?.choice`가 있으면 목록 끝에 기존 `ChoiceNowCard`.
- 미리보기: 맨 끝에 Collapsible `다음에 나올 대사`(기본 접힘) 안에 기존 `NowNextCard` 내용.
- 빈 상태 문구.
