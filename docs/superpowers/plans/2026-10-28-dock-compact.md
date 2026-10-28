# 하단 카드 짧게 보기 (A안) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 기록 탭 하단의 "지금 이후"와 "지금 선택지"가 길어지는 문제를 A안으로 정리한다(실측: 샘플에서 지금 이후가 대사 52줄).

## A안 (사용자 선택)
1. **지금 이후 → "다음 대사"**: 남은 대본을 **다음 멈춤 지점까지만** 보여준다. 멈춤 = 최상위 남은 노드 중 첫 `choices` 또는 `transfer`. 멈춤이 choices면 마지막에 `⤷ 여기서 선택지 ({N}개)`, transfer면 `⤷ 여기서 이동: {맵 이름}`. 멈춤 전 노드가 길면 대사(message/scroll) 5개까지만 보이고 `더 보기 ({N}줄)` 버튼으로 나머지(멈춤 전까지) 펼침. 카드 제목 `다음 대사`, 부제 `{entry.path} · 다음 선택지까지`(멈춤이 이동이면 `· 다음 이동까지`, 없으면 `· 페이지 끝까지`). 기본 펼침(기존 접기 버튼 유지).
2. **지금 선택지 → 항목당 한 줄**: 각 항목 한 줄 = `formatText(라벨)`(말줄임) + 고른 기록 Badge(`✓ {n}회차 갈래 {m}`, 갈래 라벨 중복 제거) 또는 `아직 안 고름`. 항목을 누르면 아래로 펼침(한 번에 하나): **이걸 고르면** — 그 분기 본문의 첫 대사 1개(화자: "본문 첫 줄") + 예전 결과 요약(aftermath, ` · ` 연결)이 있으면 한 줄. 취소 분기 행(`취소`)은 cancelBranch가 있거나 -2를 고른 기록이 있을 때만.
   - 분기 본문은 `live.choice.src` 페이지의 nodes에서 `findNodePathByCmd(nodes, live.choice.cmd)`로 choices 노드를 찾아 `branches[i].body`(취소는 `cancelBranch`)에서 첫 message를 찾는다(하위 conditional 안까지 문서 순서로 탐색).

## Global Constraints
- 기존 제약(shadcn만, core 순수성, 예외 금지, 한국어 문구, 커밋 트레일러 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). 사용자 게임 폴더는 읽지 않는다.
- 문구(정확히): `다음 대사`, `· 다음 선택지까지`, `· 다음 이동까지`, `· 페이지 끝까지`, `⤷ 여기서 선택지 ({N}개)`, `⤷ 여기서 이동: {맵 이름}`, `더 보기 ({N}줄)`, `이걸 고르면`, `아직 안 고름`, `취소`.

## Task 1: core 헬퍼
**Files:** Modify `src/core/live/remaining.ts` (+test)
- `untilStop(nodes: ScriptNode[]): { nodes: ScriptNode[]; stop: { kind: "choices"; node: ScriptNode } | { kind: "transfer"; node: ScriptNode } | null }` — 최상위에서 첫 choices/transfer 직전까지(멈춤 노드는 nodes에 포함하지 않음).
- `firstMessage(nodes: ScriptNode[]): ScriptNode | null` — 문서 순서 첫 message(하위 블록 포함).
- 테스트: 픽스처 EV1 p0 `remainingNodes(nodes, 0)` → untilStop 결과 nodes kinds `["message","message","message","picture","message"]`, stop choices; `remainingNodes(nodes, 14, list)`(분기 0 이후) → stop transfer 앞까지; 멈춤 없음 → stop null. firstMessage(choices.branches[0].body) → cmd 12.

## Task 2: UI
**Files:** Modify `src/ui/live/NowNextCard.tsx`, `src/ui/live/ChoiceNowCard.tsx`
- 위 A안 1·2. ChoiceNowCard 행은 button(키보드 접근), 펼침 상태는 선택지(choiceKey)가 바뀌면 초기화.
