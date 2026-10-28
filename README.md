# RPG Viewer

RPG Maker MV/MZ 게임 폴더를 브라우저에서 열어, 모든 이벤트의 대사·선택지·그림·상태 변화를 읽기 좋은 스크립트로 보여주는 로컬 웹 앱입니다.

## 실행 방법

```bash
npm install
npm run dev
```

크롬 또는 엣지에서 http://localhost:5173 을 열고 **"게임 폴더 열기"** 를 눌러 게임 폴더(MV/MZ 프로젝트 루트)를 선택합니다.

## 지원 범위

- RPG Maker **MV / MZ**만 지원합니다 (XP/VX/VX Ace 미지원).
- 맵 이벤트, 공통 이벤트, 전투 이벤트를 읽습니다.
- 암호화 이미지 `.rpgmvp`, `.png_`를 복호화해 표시합니다.
- 데이터 JSON까지 암호화된 게임은 미지원입니다.
- 플러그인 명령은 해석하지 않고 원문 그대로 표시합니다.

## 사용법

- **사이드바**: 맵과 공통/전투 이벤트를 탐색합니다.
- **"대사 없는 항목 표시" 토글**: 대사가 없는 이벤트도 목록에 포함할지 정합니다.
- **Ctrl+K**: 이벤트·대사를 검색합니다. (macOS는 Cmd+K)
- **스위치/변수 Badge 클릭**: 해당 스위치·변수를 참조하는 위치 목록(상호참조)을 엽니다.

## 개발

```bash
npx vitest run               # 테스트
npm run build                # 프로덕션 빌드 (타입 체크 포함)
node scripts/make-fixture-images.mjs   # 테스트 픽스처 암호화 이미지 재생성
```

개발 모드(`npm run dev`)에서는 브라우저 콘솔에서 테스트 데이터를 바로 열 수 있습니다.

```js
await __rpgViewer.openFixture("sample-mz")
```
