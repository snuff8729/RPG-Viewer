# RPG Viewer — 뷰어에서 게임 실행

**User request (verbatim):** "폴더로 열기 했을 때 뷰어에서 바로 실행할 수 있는 기능이 필요해."

**Constraint:** a browser page can't start programs and the File System Access API never reveals the folder's real path. The viewer is served by the local Vite server (`npm run dev`, README), so a small server-side endpoint in that same Node process can start the game. The user gives the folder path once per game; it is remembered.

## Design
- **Vite plugin** `scripts/launcher.ts` registered in `vite.config.ts` for both `configureServer` and `configurePreviewServer`:
  - `POST /api/game/check` `{ path }` → `{ ok, title?, engine?, exe?, error? }`: normalise the path (accept a folder or an .exe path; strip quotes); find the game root (folder containing `www/data/System.json` (MV) or `data/System.json` (MZ), also try the parent when the user points at `www`); read `gameTitle`; find the executable: `Game.exe` in the root, else `nw.exe`, else the only `*.exe` in the root (ignore `*uninst*`, `notification_helper.exe`); error texts in Korean (`폴더를 찾을 수 없어요`, `RPG Maker 게임 폴더가 아니에요`, `실행 파일(Game.exe)을 찾을 수 없어요`).
  - `POST /api/game/launch` `{ path }` → same checks, then `spawn(exe, [], { cwd: root, detached: true, stdio: "ignore" }).unref()`; `{ ok: true }` or error. Never uses a shell; never runs anything but the found exe.
  - Security: reject unless the request `Origin`/`Host` is the dev server's own localhost origin; JSON body ≤ 4 KB; only POST.
  - `GET /api/game/ping` → `{ ok: true }` so the UI knows launching is available.
- **Client** `src/app/launcher.ts`: `launcherAvailable()` (ping, cached), `checkGame(path)`, `launchGame(path)`; remembers the path per game key in localStorage `rpgv.gamePath.{gameKey}` (try/catch).
- **UI**: header Button `게임 실행` (lucide `Play`) next to `게임 보조`, shown only when a game folder is open and the launcher is available.
  - First click with no remembered path → shadcn Dialog `게임 폴더 위치`: Input for the path, help text `탐색기에서 게임 폴더를 Shift+오른쪽 클릭 → "경로로 복사" 후 붙여 넣으세요.`, `확인` runs check: shows `「{title}」 찾았어요` and compares with the opened game's title (`data.system.gameTitle`); mismatch → warning `지금 연 게임과 제목이 달라요` but allow continuing. Save → launch.
  - Later clicks launch directly; a small `…` DropdownMenu (or secondary ghost button) `위치 바꾸기` reopens the dialog.
  - After launch: toast-like inline text in the button area `실행했어요` for 3 s; if the launch fails show the error in the dialog.
  - When the game is already connected (`connection === "connected"`), the button shows disabled `실행 중`.
- Tests: launcher path resolution and exe selection with a temp directory (vitest, node fs), origin check helper; client storage helpers.
- README: mention 게임 실행 (works when the viewer is opened with `npm run dev` or `npm run preview`).
