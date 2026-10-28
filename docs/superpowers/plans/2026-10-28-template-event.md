# TemplateEvent 지원 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Triacontane `TemplateEvent` 플러그인을 쓰는 게임에서 `<TE:이름|번호>` 이벤트의 페이지를 템플릿 맵 이벤트의 페이지로 풀어, 탐색기·진행도·지금 영역·지금 이후·못 본 것이 실제 실행 내용을 보게 한다.

**배경(실측, 사용자 샘플):** MV 게임, 이벤트 7,118개 중 4,463개가 `<TE:이름>`(템플릿 맵 2번, 템플릿 548개). 기록의 위치 불확실 81건 전부가 템플릿 이벤트. 인게임 플러그인은 `Game_Event.event()`가 템플릿을 돌려주므로 이미 템플릿 기준 페이지 번호·명령 번호를 기록한다 — 뷰어만 맞추면 된다.

## Global Constraints
- 기존 제약 유지(shadcn만, `src/core` 순수성, 예외 금지, 한국어 문구, 커밋 트레일러 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
- 사용자 실제 게임 폴더는 테스트에 쓰지 않는다(픽스처만). 컨트롤러가 샘플 진단은 따로 돌린다.

## Task 1: 로더에서 템플릿 이벤트 풀기

**Files:** Modify `src/core/loader/loadGame.ts`, `src/core/types.ts`; Create `src/core/loader/templateEvent.ts` + test; Create fixture `tests/fixtures/sample-te/` (MV 구조 `www/data`, `www/js/plugins.js`)

- `plugins.js`(`<base>/js/plugins.js`, base는 dataRoot에서 계산 — `src/core/live/installer.ts`의 `livePaths`/`parsePluginsJs` 재사용)에서 `name === "TemplateEvent" && status === true`인 항목의 `parameters.TemplateMapId`(정수)를 읽는다. 없거나 파일이 없으면 아무것도 하지 않는다(현재 동작 그대로).
- 템플릿 맵(`Map%03d.json`)을 로드(이미 MapInfos에 있으면 그 데이터 재사용, 없어도 파일이 있으면 읽음).
- 모든 맵의 각 이벤트 `note`에서 `<TE:값>` 또는 `<TemplateEvent:값>`을 찾는다(앞뒤 공백 trim). 값이 정수면 템플릿 맵 이벤트 id, 아니면 이름이 같은 첫 템플릿 이벤트. 찾으면 그 이벤트의 `pages`로 교체(원본 이벤트의 id·이름·좌표·note는 유지). 못 찾으면 그대로 두고 `errors`에 `{file, message: "템플릿 이벤트를 찾을 수 없어요: <값>", mapId}` 하나 추가.
- `GameData`에 `templateMapId?: number` 추가(템플릿을 풀었을 때만).
- 템플릿 맵 자체의 이벤트는 그대로 둔다(탐색기에서 볼 수 있게).
- 테스트(픽스처 sample-te: 템플릿 맵 2에 이름 "말하는 사람"·id 3 템플릿, 맵 1에 `<TE:말하는 사람>`, `<TE:3>`, `<TE:없는것>`, 일반 이벤트): 풀린 페이지 내용 일치, 원본 id/name 유지, 미해결 1건 errors, TemplateEvent 꺼짐(status false)이면 풀지 않음, plugins.js 없음이면 풀지 않음, templateMapId 설정.

## Task 2: 템플릿 맵을 "못 본 것"·새 N에서 제외 + 사이드바 표시

**Files:** Modify `src/core/live/missing.ts`, `src/core/live/interactable.ts`, `src/ui/AppSidebar.tsx` (+tests)
- `computeMissing`과 `mapNewCounts`는 `data.templateMapId`인 맵의 페이지를 제외.
- 사이드바 맵 트리에서 템플릿 맵 이름 옆에 muted `템플릿` Badge(outline, text-xs).
- 테스트: sample-te로 missing/newCounts에 맵 2 항목 없음.
