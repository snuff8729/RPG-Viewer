# "못 본 것" 정리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 실측 샘플에서 4,342건이던 "못 본 것"을 **지금 실제로 갈 수 있는 것** 위주로, 맵 → 이벤트 단위로 묶어 쓸 만한 목록으로 만든다.

**핵심 판단:** 맵 이벤트 항목은 그 페이지가 **지금 이벤트의 현재 페이지**일 때만 실제로 볼 수 있다(지나간 이전 페이지·아직 안 열린 페이지는 불가). 현재 페이지는 현재 맵이면 live.events, 다른 맵이면 `activePageIndex`(src/core/live/interactable.ts).

## Global Constraints
- 기존 제약(shadcn만, core 순수성, 예외 금지, 한국어 문구, 커밋 트레일러 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). 사용자 게임 폴더는 읽지 않는다.
- 문구(정확히): 보기 전환 `지금 맵` / `갈 수 있는 것` / `전체`; 그룹 헤더 카운트 `선택지 {N} · 대사 {N}`(0인 쪽 생략); 이벤트 배지 `지금 페이지`; 그룹 `공통 이벤트`, `전투`; 검색 placeholder `맵·이벤트 이름 검색`; 빈 목록 `없음`; 미연결 안내(기존) `게임에 연결되면 조건 충족 여부가 표시돼요`.

## Task 1: core 묶기
**Files:** Create `src/core/live/missingGroups.ts` + test
```ts
export type MissingView = "now" | "reachable" | "all";
export interface MissingEventGroup {
  key: string;                 // locationKey(entry.location)
  entry: PageEntry;
  active: boolean | null;      // 맵 이벤트: 이 페이지가 현재 페이지인지(live 없으면 null). 공통/전투: null
  items: MissingItem[];
  choiceCount: number; pageCount: number;
  reachable: boolean;          // active !== false && 이 그룹 항목 중 unmet 없는 것이 하나라도 있음
}
export interface MissingGroup {
  key: string;                 // "map:{id}" | "common" | "troop"
  kind: "map" | "common" | "troop";
  mapId?: number; name: string; current: boolean;
  events: MissingEventGroup[];
  choiceCount: number; pageCount: number; reachableEvents: number;
}
export function groupMissing(items: MissingItem[], data: GameData, index: GameIndex, live: LiveSnapshot | null): MissingGroup[];
export function viewGroups(groups: MissingGroup[], view: MissingView, query: string): MissingGroup[];
export function reachableCount(groups: MissingGroup[]): number;   // reachable 이벤트 그룹 수 합
```
- 맵 그룹 이름 = MapInfo.name. 정렬: current 맵 → reachableEvents 내림차순 → MapInfos order; 그 뒤 공통 이벤트, 전투.
- 이벤트 그룹 정렬: reachable 먼저 → index.pages 순서. 이벤트 그룹 안 items는 기존 정렬 유지.
- `viewGroups`: "now" = current 맵 그룹만(그 안 이벤트 전부); "reachable" = reachable 이벤트만 남기고 빈 그룹 제거(공통/전투는 제외 — 조건 판정이 불완전하므로); "all" = 전부. query(trim, 대소문자 무시)는 맵 이름 또는 이벤트 title/path 부분 일치로 거른다.
- 테스트(sample-mz + fixtureLive, 기록 일부): 촌장의 집 그룹이 current·맨 앞; EV1 page0 항목은 live에서 EV1이 page1이므로 active false → reachable false, page1 그룹(있다면)은 active true; "reachable" 보기에서 page0 항목 제외; live null이면 active null; query "촌장" 필터; 공통/전투 그룹은 reachable 보기에서 빠짐.

## Task 2: UI
**Files:** Modify `src/ui/live/MissingView.tsx`, `src/ui/live/LiveTabs.tsx`(탭 숫자); 기존 `missingItems.ts`는 필요 없으면 제거(테스트도)
- 상단: shadcn ToggleGroup(single) `지금 맵`/`갈 수 있는 것`/`전체` — 기본값은 연결 중이면 `갈 수 있는 것`, 아니면 `전체`(연결 상태가 바뀌어도 사용자가 고른 값은 유지). 검색 Input. 미연결 안내 유지.
- 맵 그룹: shadcn Collapsible, 헤더 = 이름 + `선택지 N · 대사 N` + (current면 `지금 이 맵` Badge). current 그룹은 기본 펼침, 나머지는 접힘. 접힌 그룹은 내용 렌더 안 함.
- 이벤트 행: 제목 + 경로(muted) + `지금 페이지` Badge(active true) + 카운트; 누르면 펼쳐 기존 항목 카드(요구 조건 Badge 포함, 클릭 시 이동·강조) 표시.
- 그룹이 많으면 처음 50개 그룹만 + `더 보기`.
- 탭 라벨 `못 본 것 ({N})`: 연결 중이면 reachableCount, 아니면 전체 이벤트 그룹 수.
