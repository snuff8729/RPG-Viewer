# 읽기 탭·선택 흐름 최종 검토 수정 Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** master에 병합된 읽기 모드/선택 흐름/플러그인 1.0.4의 최종 검토 지적을 고친다. 대상 사용 방식: 게임은 빠르게 넘기고 뷰어에서 읽기, 긴 기록, 게임 끈 뒤 다시 열기.

## Global Constraints
- 기존 제약(shadcn만, core 순수성, 예외 금지, 한국어 문구, 플러그인 ES5·try/catch, 커밋 트레일러 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). 사용자 게임 폴더는 읽지 않는다.

## Fixes
1. **로딩 중 읽은 위치 유실** — 4MB 이상 기록을 나눠 읽는 동안 첫 파생이 잘린 경로로 계산돼 저장 위치가 버려지고 창이 잘못 정해진다. LiveProvider에 `caughtUp: boolean`(현재 게임 tail이 `more` 없이 끝까지 한 번 읽었는가)을 노출하고, FullReader는 caughtUp 전에는 위치·창 결정을 미루고 로딩 표시(Skeleton)만 보여준다. 또한 `initialReadSeq`는 `best > maxSeq`일 때 버리지 말고, 기록 초기화(LogTail `reset`) 때만 해당 게임의 저장 위치를 지운다(아래 6).
2. **따라가기 중 몰아 들어온 대사가 읽음 처리됨** — 따라가는 중 새 항목이 한 화면을 넘으면 맨 아래 대신 **첫 새 항목**으로 스크롤하고 따라가기를 멈춘다. 읽음 표시는 실제로 화면(뷰포트)과 교차했던 항목만, 그리고 `맨 아래로`/`↓ 다음`/Space 같은 명시적 동작으로만 일괄 처리한다.
3. **창 크기 무제한** — 렌더 범위를 읽은 위치 기준 **고정 크기 구간**으로: `[firstUnread-5, firstUnread+300)`을 기본으로, 위·아래 양쪽 `더 보기`(위: `이전 대사 더 보기`, 아래: `다음 대사 더 보기`)로 300씩 확장, 따라가기 중에는 끝 기준 300. ReaderItemView의 memo 비교를 key + repeat + lines 길이·첫 줄 등 가벼운 비교로 바꾸고, IntersectionObserver는 새로 추가/제거된 노드만 observe/unobserve(전체 재생성 금지).
4. **choiceFlow 이차 시간** — reader 항목을 key→index Map으로 한 번 만들어 O(1) 조회(또는 readerItems가 내는 타입에만 take). 테스트: 상태/세이브 기록 수천 개 섞인 경로에서 1회 계산 < 50ms(여유 있게, 측정값 로그).
5. **선택 카드 보강** — 해당 choices 기록이 경로에 없거나 picked가 옵션 범위를 넘으면 reader 항목 라벨을 고른 옵션으로 표시. `대사 {N}줄`은 메시지 박스 수가 아니라 **줄 수 합**(scroll 포함, repeat 제외). `elsewhere`에서 이 경로(path)에 포함된 seq의 선택은 제외(같은 이야기 안의 반복 선택이 다른 갈래로 보이지 않게).
6. **기록 초기화 시 저장 위치** — LogTail `reset`이 오면 해당 gameKey의 `rpgv.read.*` 키를 모두 지운다(readPosition에 `clearReadPositions(gameKey)`).
7. **처음 열기·다시 열기** — 저장 위치가 없으면 항상 첫 항목부터(작게 300 구간). 다시 열 때도 첫 화면을 자동 읽음 처리하지 않는다(사용자 동작 후부터).
8. **갈래 전환 시 잔여 상태** — posKey가 바뀌면 pendingKey·anchor 초기화.
9. **플러그인 META 쓰기 빈도** — 시작 시 log.jsonl 끝 64KB를 읽어 마지막 seq/run/branch로 meta를 보정(meta가 뒤처졌으면 올림). 그 뒤 meta.json은 250ms tick에서만(그리고 세이브 스탬프 flush 때) 쓴다. 테스트: meta가 뒤처진 상태로 시작해도 seq가 겹치지 않음. VERSION `"1.0.5"`.
