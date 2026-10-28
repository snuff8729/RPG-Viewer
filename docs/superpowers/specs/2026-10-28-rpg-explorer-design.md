# RPG Viewer — 1단계: 전체 탐색기 설계

작성일: 2026-10-28

## 목적

쯔꾸르(RPG Maker) MV/MZ 게임의 대사와 장면을 플레이 중 하나씩 넘기는 대신, 게임 데이터를 직접 읽어 **모든 대사·선택지·그림·상호작용을 한 화면에서 대본처럼** 보는 뷰어. 나중에 스토리를 떠올릴 때 보기 쉬워야 한다.

### 전체 로드맵 (이 문서는 1단계만 다룸)

1. **전체 탐색기** (이 문서) — 게임 실행 없이 데이터 분석
2. **실시간 상호작용 표시** — 게임 플러그인이 localhost로 현재 맵/상태를 보내고, 탐색기에 "지금 가능한 것"을 하이라이트
3. **플레이 히스토리** — 실제로 본 대사·장면을 시간순 기록 + 중복 제거, 탐색기에 "본 것" 표시

세 단계 모두 1단계의 **명령 해석기**와 **화면 틀**을 재사용한다. 2·3단계는 각각 별도 설계를 거친다.

## 범위

### 포함
- RPG Maker **MV / MZ** 게임 폴더 (`www/data/` 또는 `data/`)
- 맵(`MapInfos.json`, `Map###.json`), 공통 이벤트(`CommonEvents.json`), 전투 이벤트(`Troops.json`)
- 이름 참조: `System.json`(스위치·변수 이름, 암호화 키), `Actors.json`, `Items.json`, `Weapons.json`, `Armors.json`
- 암호화 이미지(`.rpgmvp`, `.png_`) 복호화
- A안 화면(맵 › 이벤트 트리 + 대본), 전체 대사 검색, 스위치/변수/공통 이벤트 상호참조

### 제외
- XP / VX / VX Ace
- 데이터 JSON 자체가 플러그인으로 암호화된 게임 (오류 메시지로 안내만)
- 실제 맵 타일 렌더링, 실시간 게임 연결, 히스토리·중복 제거
- 플러그인 명령 / 스크립트 명령 해석 (원문 그대로 "기타"에 표시)
- 오디오 재생

## 기술 스택

- Vite + React + TypeScript
- Tailwind CSS + **shadcn/ui** — 모든 UI는 shadcn 컴포넌트와 공식 예제(blocks) 디자인을 따른다. 별도 디자인 시스템을 만들지 않는다. shadcn에 없는 요소(대사 줄, 분기 블록 등)는 shadcn 기본 컴포넌트(Card, Badge, Collapsible 등)와 토큰만 조합해 만든다.
- Vitest (단위 테스트)
- 로컬에서 실행하는 정적 SPA. 크롬/엣지의 File System Access API(`showDirectoryPicker`)로 게임 폴더를 연다. 미지원 브라우저는 `<input webkitdirectory>`로 대체한다.

## 아키텍처

각 부품은 한 가지 역할만 하고 독립적으로 테스트 가능하다. 순수 로직(`src/core/`)은 React와 브라우저 API에 의존하지 않는다.

```
src/
  core/
    fs/          게임 폴더 추상화 (GameFolder 인터페이스)
    loader/      데이터 폴더 탐지 + JSON 로드 → GameData
    assets/      이미지 경로 해석 + 복호화 → blob URL
    text/        메시지 제어문자 처리
    interpret/   이벤트 명령 목록 → ScriptNode 트리
    conditions/  페이지 조건·조건 분기 → 사람이 읽는 문장
    index/       검색 색인 + 상호참조 색인
  ui/            React 컴포넌트 (shadcn)
  app/           라우팅(URL 해시), 상태, 최근 폴더
```

### 1. fs — 게임 폴더 추상화

```ts
interface GameFolder {
  readText(path: string): Promise<string | null>;   // 없으면 null
  readBinary(path: string): Promise<ArrayBuffer | null>;
  exists(path: string): Promise<boolean>;
  list(dir: string): Promise<string[]>;
}
```

구현체: `DirectoryHandleFolder`(File System Access API), `FileListFolder`(webkitdirectory), `MemoryFolder`(테스트용).

### 2. loader

- `www/data/System.json` → `data/System.json` 순서로 데이터 루트를 찾는다. 이미지 루트(`www/img` 또는 `img`)도 같은 기준으로 정한다.
- 로드 대상: System, MapInfos, CommonEvents, Troops, Actors, Items, Weapons, Armors, MapInfos에 있는 모든 `Map###.json`.
- MV/MZ 구분: `System.json`의 `advanced` 필드 유무 등으로 판별하고 `engine: "MV" | "MZ"`로 기록한다 (명령 파라미터 차이 처리용).
- 파일별 파싱 실패는 전체를 멈추지 않고 `GameData.errors`에 쌓는다.
- JSON이 아닌 내용(암호화된 데이터)을 감지하면 `UnsupportedEncryptionError`로 처리한다.

### 3. assets

- `img/faces/<name>.png`, `img/pictures/<name>.png`를 찾고, 없으면 `.rpgmvp`(MV) 또는 `.png_`(MZ)를 찾는다.
- 복호화: 16바이트 헤더를 제거하고, 이어지는 16바이트를 `System.json`의 `encryptionKey`(hex)와 XOR한 뒤 PNG blob으로 만든다.
- 얼굴 그래픽은 시트(가로 4 × 세로 2, 칸당 144px)에서 `faceIndex` 칸을 CSS로 잘라 표시한다.
- 결과는 경로별로 캐시한다. 실패하면 `null`을 반환하고, UI는 자리표시를 보여준다.

### 4. text — 제어문자

| 코드 | 처리 |
|---|---|
| `\N[n]` | 배우 n의 이름 |
| `\P[n]` | `[파티원 n]` |
| `\V[n]` | `[변수: 이름]` |
| `\G` | 통화 단위 (`System.currencyUnit`) |
| `\C[n]`, `\I[n]`, `\{`, `\}`, `\.`, `\|`, `\!`, `\>`, `\<`, `\^`, `\$`, `\FS[n]` 등 | 제거 (아이콘은 1차에서 생략) |
| `\\` | `\` |
| 알 수 없는 `\XXX[...]` | 제거 (플러그인 제어문자) |

### 5. interpret — 명령 해석기

입력: `EventCommand[]` (`{code, indent, parameters}`). 출력: `ScriptNode[]`.

```ts
type ScriptNode =
  | { kind: "message"; face?: FaceRef; speaker?: string; lines: string[] }   // 101 + 401…
  | { kind: "scroll"; lines: string[] }                                      // 105 + 405…
  | { kind: "choices"; branches: { label: string; body: ScriptNode[] }[];
      cancelBranch?: ScriptNode[] }                                          // 102 / 402 / 403 / 404
  | { kind: "conditional"; condition: Condition; then: ScriptNode[];
      else?: ScriptNode[] }                                                  // 111 / 411 / 412
  | { kind: "loop"; body: ScriptNode[] }                                     // 112 / 413
  | { kind: "picture"; pictureId: number; name: string }                     // 231
  | { kind: "commonEvent"; commonEventId: number }                           // 117
  | { kind: "transfer"; mapId: number | null; x?: number; y?: number }      // 201 (변수 지정이면 mapId null)
  | { kind: "stateChange"; target: "switch" | "variable" | "selfSwitch" | "item" | "gold" | "party";
      description: string; refs: Ref[] }                                    // 121, 122, 123, 125, 126, 127, 128, 129
  | { kind: "other"; commands: EventCommand[] };                             // 연속된 나머지 명령을 하나로 묶음
```

규칙:
- `indent` 기준으로 블록 구조를 만든다. 401·405 연속 줄은 하나의 메시지로 합친다.
- 화자 결정: MZ의 101 이름 파라미터 → 얼굴 파일명+인덱스와 일치하는 배우의 이름 → 없음.
- 얼굴 없는 메시지는 UI에서 내레이션으로 표시한다(해석기는 `face` 없음만 기록).
- 그림 지우기(235)와 대사 없는 블록 내부의 기타 명령은 `other`로 묶는다.
- 모르는 코드는 항상 `other`로 보존한다. 해석기는 예외를 던지지 않는다.
- `hasDialogue(nodes)` 헬퍼: message, scroll, choices 중 하나라도 있으면 true (재귀).

### 6. conditions

- 이벤트 페이지 조건(스위치1/2, 변수 ≥ 값, 셀프 스위치, 아이템, 배우)과 트리거(결정 키, 플레이어 접촉, 이벤트 접촉, 자동 실행, 병렬 처리)를 `Condition[]` + 한국어 설명으로 변환한다.
- 조건 분기(111)의 파라미터 형식(스위치, 변수, 셀프 스위치, 타이머, 배우, 적, 캐릭터 방향, 골드, 아이템, 무기, 방어구, 버튼, 스크립트, 탈것)을 설명 문자열로 변환한다. 스크립트 조건은 원문을 표시한다.
- 스위치·변수는 `System.json`의 이름을 쓰고, 이름이 비어 있으면 `#번호`로 표시한다.
- 각 `Condition`은 상호참조용 `Ref`(`{type: "switch"|"variable"|"item"|…, id}`)를 포함한다.

### 7. index — 검색 & 상호참조

로드 시 모든 이벤트 페이지를 해석해 한 번에 만든다.

- **위치(Location):** `{source: "map"|"common"|"troop", id, eventId?, page}` + 표시용 경로 문자열 (예: `촌장의 집 › 촌장 › p1`)
- **검색 색인:** 대사 줄, 선택지 문구, 스크롤 텍스트, 화자 이름 → Location + 노드 경로. 부분 문자열 검색(대소문자 무시)이며 1차에서는 퍼지 검색 없이 단순 `includes`로 처리한다.
- **상호참조:** `Ref` → `{writes: Location[], reads: Location[]}`. writes는 stateChange, reads는 페이지 조건과 조건 분기에서 수집한다. 공통 이벤트는 `callers: Location[]`를 기록한다.

## UI (shadcn)

### 레이아웃 — A안
- **시작 화면:** "게임 폴더 열기" 버튼 + "최근 게임 다시 열기"(IndexedDB에 디렉터리 핸들 저장, 권한 재요청). Card 중앙 배치.
- **좌측 Sidebar:** 그룹은 `맵`, `공통 이벤트`, `전투`.
  - 맵은 MapInfos의 `parentId`/`order` 기준 트리. 펼치면 해당 맵의 이벤트 목록이 나온다.
  - 이벤트 이름이 `EV\d+`처럼 기본값이면 `첫 화자 — "첫 대사 앞부분…"`으로 표시한다.
  - 상단 토글: "대사 없는 항목 표시" (기본 OFF).
  - 로드 오류가 있는 맵은 ⚠ 아이콘을 표시한다.
- **본문:** breadcrumb, 페이지 Tabs(페이지가 2개 이상일 때), 페이지 조건 Badge, 대본.
- **상단:** 게임 제목(`System.gameTitle`), 엔진 표시, 검색 버튼(`Ctrl+K`).

### 대본 렌더링 규칙
| 노드 | 표시 |
|---|---|
| message | 얼굴(40px) + 화자(굵게) + 본문(줄바꿈 유지). 얼굴 없으면 기울임체 내레이션 |
| scroll | 가운데 정렬 muted 박스 |
| choices | 테두리 박스 "선택지", 모든 분기를 **펼쳐서** 표시. 본문이 비어 있는 분기는 접힌 상태 + "(대사 없음)" |
| conditional | 테두리 박스 "만약 [조건 Badge]", "그렇다면 / 아니라면" 분기 펼침. 빈 분기는 접힘 |
| loop | 테두리 박스 "반복" |
| picture | 썸네일(120px) + 파일명. 클릭하면 Dialog로 원본 보기 |
| stateChange | ⚙ 한 줄 muted 텍스트. 스위치/변수 이름은 클릭 가능 |
| commonEvent | `↪ 공통 이벤트 [이름] 실행` 링크 |
| transfer | `🚪 이동 → [맵 이름] (x, y)` 링크. 변수 지정이면 "(변수로 지정된 위치)" |
| other | Collapsible "기타 명령 N개". 펼치면 `코드 이름: 파라미터 JSON` 목록 |

### 검색
- shadcn Command를 Dialog로 띄운다(`Ctrl+K`). 결과는 Location별로 묶고 일치한 줄을 보여준다. 최대 200건.
- 결과를 선택하면 해당 페이지로 이동하고, 그 노드로 스크롤한 뒤 2초간 강조한다.

### 상호참조
- 스위치·변수·아이템 Badge(조건, stateChange)를 클릭하면 Sheet가 열린다: "값을 바꾸는 곳" / "조건으로 쓰는 곳" 목록. 항목을 누르면 이동한다.
- 공통 이벤트 화면 상단에 "호출하는 곳 N곳" (Collapsible 목록).

### 라우팅
- URL 해시: `#/map/12/event/3/page/1`, `#/common/5`, `#/troop/2/page/1`. 뒤로가기 지원.

## 오류 처리

| 상황 | 처리 |
|---|---|
| 데이터 폴더 없음 | 시작 화면에 "MV/MZ 게임 폴더가 아니에요" + 찾아본 경로 목록 |
| 데이터 JSON 암호화 | "지원하지 않는 암호화 방식" 안내 |
| 일부 파일 파싱 실패 | 해당 항목 ⚠, 나머지 정상 동작. 상단에 오류 개수 Badge → 클릭하면 목록 |
| 이미지 없음 / 복호화 실패 | 회색 자리표시 + 파일명 |
| 알 수 없는 명령 | `other`로 원문 표시 |
| 디렉터리 API 미지원 | webkitdirectory 대체 |
| 최근 폴더 권한 거부 | 시작 화면으로 돌아가 다시 선택하도록 안내 |

## 테스트

- **픽스처:** `tests/fixtures/sample-mz/`, `sample-mv/`에 직접 만든 작은 게임 데이터. 대사(얼굴/이름/내레이션), 스크롤, 선택지(취소 분기 포함), 중첩 조건 분기, 반복, 그림 표시, 공통 이벤트 호출, 이동, 스위치/변수/아이템 변경, 플러그인 명령, 모르는 코드, 제어문자, 암호화 이미지 1개(알려진 키)를 포함한다.
- **단위 테스트 (Vitest):** loader(루트 탐지, 부분 실패), assets(복호화 결과가 유효한 PNG 시그니처), text(각 제어문자), interpret(각 노드 종류, 중첩, 모르는 코드), conditions(각 조건 유형), index(검색, writes/reads, callers).
- **UI:** 픽스처 폴더를 열어 브라우저에서 직접 확인한다. 실제 게임을 구하면 추가로 검증한다.

## 미결 / 이후 단계에서 결정
- 중복 제거 정책 → 3단계(히스토리) 설계에서 결정
- 플러그인 명령 중 많이 쓰는 것(예: 메시지 확장 플러그인)의 해석 지원 여부 → 실제 게임 검증 후 결정
