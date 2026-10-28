# 선택 흐름 보기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal (사용자 요청):** 엔딩을 본 뒤 처음부터 쭉 보면서, 내 선택들로 이야기가 어떻게 쌓였는지 한눈에 본다. 읽기 탭에 회차·갈래 선택과 `선택 흐름` 보기를 더한다.

## Global Constraints
- 기존 제약(shadcn만, core 순수성, 예외 금지, 한국어 문구, 커밋 트레일러 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). 사용자 게임 폴더는 테스트에 쓰지 않는다.
- 문구(정확히): 보기 전환 `전체 읽기` / `선택 흐름`; 머리말 `— {갈래 라벨} · 처음부터 —`; 구간 요약 `대사 {N}줄 · 그림 {N}`(0인 쪽 생략, 둘 다 0이면 구간 생략); 펼치기 `▸ 펼쳐 읽기` / `▾ 접기`; 선택 지점 질문 앞 `◆`; `▶ 고른 것: "{라벨}"`; `안 고름: "{라벨}"`; 다른 갈래에서 고른 표시 `✓ {갈래 라벨}`(여러 개면 각각); 갈라짐 `💾 여기서 세이브를 불러와 다른 갈래로` + 갈래 버튼; 장면 구분은 읽기 탭과 같은 `— {맵 이름} —`.

## Task 1: core — 선택 흐름 만들기
**Files:** Create `src/core/live/choiceFlow.ts` + test
```ts
export type FlowItem =
  | { kind: "chapter"; key: string; text: string }
  | { kind: "segment"; key: string; items: ReaderItem[]; messages: number; pictures: number }
  | { kind: "choice"; key: string; seq: number; question: { speaker: string; text: string } | null;
      options: { label: string; picked: boolean; elsewhere: string[] }[] }
  | { kind: "fork"; key: string; atSeq: number; branches: number[] };
export function choiceFlow(args: {
  items: HistoryItem[];          // foldTimeline(branchPath(...)) 결과
  reader: ReaderItem[];          // readerItems(items, ...) 결과
  data: GameData; model: HistoryModel; coverage: Coverage; branch: number; choiceText: Map<number, string>;
}): FlowItem[];
```
- 순서대로 훑으며: reader의 chapter는 그대로 chapter, 연속된 message/scroll/picture/battle 항목은 하나의 segment(choice 항목 또는 chapter 또는 fork에서 끊김), choice 항목은 choice 지점, HistoryItem의 fork는 fork.
- choice 지점: 같은 src+cmd의 직전 `choices` 기록(경로 안)의 options를 모두 나열(라벨 formatText), 고른 인덱스는 choice 기록의 picked(-2면 `취소` 항목을 추가하고 picked). `elsewhere` = coverage.picks의 같은 위치에서 **이 갈래가 아닌** 갈래들이 그 옵션을 고른 기록의 갈래 라벨(중복 제거, branchLabel). question = 그 choices 직전(같은 src) 마지막 message의 화자와 첫 줄(formatText, 40자 말줄임), 없으면 null.
- 키 안정적. 예외 금지.
- 테스트(픽스처, 갈래 2 경로): 머리 쪽 segment(대사 4 · 그림 1) → choice(질문 촌장 "도와주겠나? …", options ["네, 도울게요"(elsewhere ["1회차 갈래 1"]), "생각해볼게요"(picked)]) → segment(대사 1: 밤이 깊었다). 갈래 1 경로: fork 항목이 seq 8 뒤에 있음, choice에서 "네, 도울게요" picked, "생각해볼게요" elsewhere ["1회차 갈래 2"].

## Task 2: UI — 읽기 탭 갈래 선택 + 선택 흐름
**Files:** Modify `src/ui/live/ReaderView.tsx`; Create `src/ui/live/ChoiceFlowView.tsx`; (필요 시) 읽기 항목 렌더러를 `src/ui/live/ReaderItemView.tsx`로 분리해 둘이 공유
- 상단: 회차·갈래 Select(기록 탭과 같은 구성, 기본 최신 갈래, 사용자가 고르기 전엔 새 갈래를 따라감) + ToggleGroup(single) `전체 읽기`/`선택 흐름`(기본 `전체 읽기`, 선택은 localStorage `rpgv.readerMode` try/catch).
- `전체 읽기`: 고른 갈래의 경로로 기존 읽기 화면(읽은 위치는 갈래별 그대로).
- `선택 흐름`: 머리말 `— {갈래 라벨} · 처음부터 —`, FlowItem 순서대로. segment는 요약 한 줄 + `▸ 펼쳐 읽기`(펼치면 읽기 항목 렌더러로 그 구간 표시), choice는 Card: `◆ {화자}: "{질문}"`(없으면 `◆ 선택지`), 고른 것 강조 줄, 안 고른 것 muted 줄 + elsewhere Badge들. fork는 `💾 여기서 세이브를 불러와 다른 갈래로` + 각 갈래 버튼(현재 갈래 비활성, 누르면 그 갈래 선택).
- 선택 흐름 화면에서는 읽음 표시·자동 따라가기 없음.
