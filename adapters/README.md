# 게임 전용 어댑터

특정 게임(또는 특정 플러그인을 쓰는 게임)에만 필요한 처리를 여기 폴더 하나로 모아 Git으로 관리합니다.
뷰어는 빌드할 때 이 폴더를 모두 묶고, 게임을 열면 맞는 어댑터를 `게임 설정`에 `이 게임 전용`으로 보여줍니다.
켜면 기본값(부가 기능 켜기·그림 구분)이 적용되고, 게임 쪽 확장이 있으면 게임 폴더에 설치됩니다.

## 새 게임 진단하기

`npm run diagnose -- "<게임 폴더>"`(읽기 전용)로 이 게임에서 특별한 것·모르는 플러그인을 보고서로 받고, Claude Code의 `onboard-game` 스킬(`.claude/skills/onboard-game`)로 어댑터를 만듭니다.
뷰어 안에서는 `게임 진단` 화면의 `개발용 보고서 복사`가 같은 보고서를 줍니다.

## 새 어댑터 더하기

1. `adapters/<id>/` 폴더를 만듭니다. `<id>`는 영문 소문자·숫자·`-`만(폴더 이름 = manifest의 id).
2. `manifest.json`을 씁니다.

   ```json
   {
     "id": "my-game",
     "label": "설정 화면에 보일 이름",
     "description": "무엇을 하는지 한두 문장",
     "match": { "plugins": ["PluginA", "PluginB"], "pluginsMode": "all", "gameTitle": ["제목 일부"] },
     "bridgeScript": "bridge.js",
     "defaults": {
       "addons": { "screenPictures": true, "notices": true },
       "pictureRoles": { "60": "cg", "101-103": "decoration", "111-150": "stand" },
       "spriteRoles": { "actor01_cutin_*": "stand", "organ/": "stand" }
     }
   }
   ```

   - `match`: 켜진 플러그인(`pluginsMode`: `all` 기본 / `any`)과 게임 제목 조건. 둘 다 있으면 둘 다 맞아야 합니다.
   - 구분: `cg`(이벤트 그림), `stand`(스탠딩), `decoration`(= `hud`, 화면 장식), `hidden`(숨김).
     사용자가 직접 고른 구분이 항상 먼저입니다.
   - `spriteRoles`: `폴더/`는 그 폴더 안 그림, `*`는 아무 글자, 그 밖에는 이름 열쇠(끝 번호를 뺀 이름)와 같은 것.
3. (선택) `bridge.js`: 게임 안에서 도는 확장. ES5, CRLF, 훅마다 try/catch.
   `js/plugins/RPGViewerBridge_<id>.js`로 설치되어 기록 플러그인(1.13.0 이상) 바로 뒤에 읽힙니다.
   `RPGViewerBridge.registerExtension({ id, onInstall(api), captureScene(scene), snapshotEntry(sprite, entry, scene), snapshotMeta(sprite, entry, scene) })`
   로 붙습니다(자세한 계약은 `plugin/RPGViewerBridge.js`의 `game extensions` 주석).
4. (선택) `viewer.ts`: `export const viewer: AdapterViewer = { ... }` — 읽기 화면에 쓰는 순수 함수(`src/core/adapters/bundle.ts`).
5. `npx vitest run`으로 확인합니다(`src/core/adapters/manifest.test.ts`가 모든 manifest를 검사합니다).

## 지금 있는 어댑터

- `character-picture-manager`: CharacterPictureManager 스탠딩에 배우·겹 이름을 붙이고 움직임(나타나기·흔들림·흐려짐)을 무시, 읽기에서 배우별로 나란히.
- `ddaggeo-mode`: CallStand·CallCutin·Ticker 게임의 그림 구분 기본값.
- `toast-achievement-notices`: AXY_Toast·Torigoya_Achievement 게임 — 알림 문구 기록을 켜서 획득·경험치·퀘스트 토스트와 업적 달성을 읽기에 보여줌(기록 플러그인 1.19.0+).
- `by-work-element`: BYWorkElement·BY_Cosplay·BY_Scenes 게임 — 맵·전투 옆 주인공 스탠딩(`tachie/`)을 기록하도록 그림 따라 그리기를 켜고 구분 기본값을 줌(기록 플러그인 1.18.0+).
