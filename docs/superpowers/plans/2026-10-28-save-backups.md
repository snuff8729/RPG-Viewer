# RPG Viewer — 세이브 폴더 백업(자동·수동)

**User request (paraphrased):** "자동/수동 저장을 만들 수 있을까? 기본 세이브는 공용 데이터(global.rpgsave·config, 플러그인이 쓰는 파일)를 건드리면 슬롯을 되돌려도 복구가 안 된다. 치트를 기본으로 쓸 거라 세이브 슬롯 밖이 망가지면 복구가 어렵다."
Follow-up: restoring while the game runs must not be blocked — hard-kill the game, restore, relaunch.

## Design
- **Snapshots of the whole save folder** (MV `www/save`, MZ `save`) by the existing local launcher server (Vite plugin, `scripts/launcher.ts`).
- `scripts/backups.ts`: `<root>/rpg-viewer/backups/<id>/{files/, meta.json}`; meta `{ id, kind: auto|manual|safety, reason, name?, createdAt, fileCount, bytes, hash }`. id `YYYYMMDD-HHMMSS-mmm(-n)` checked by a strict regex everywhere. Written to `.tmp-<id>` then renamed. Auto backup skipped when the content hash equals the newest backup. Retention: 30 auto, 10 safety, manual never pruned.
- Restore: safety backup (`복원 전`) first, then copy the snapshot to a sibling temp dir and swap it in (rename old → temp-old, new → save, delete temp-old; roll back on failure). Missing save dir is fine.
- `scripts/gameProcess.ts`: find game processes by executable path (PowerShell `Get-CimInstance Win32_Process`, path passed by env var, `execFile`, no shell string), plus pids spawned by `/launch`; `taskkill /PID /T /F`; wait up to 10 s. Injectable `ProcessOps` for tests.
- Endpoints (same localhost Host/Origin checks, POST, ≤ 4 KB JSON): `/api/game/backups/{list,create,restore,delete,state}`, `/api/game/running`, `/api/game/restart-restore {path,id,launch}` → kill → wait → restore → relaunch (if it was running or `launch`).
- Client `src/app/backups.ts`: API calls, per-game `rpgv.autoBackup.{gameKey}` (default on), `nextWatch` settle logic (signature changed and same on the next 15 s poll, ≥ 2 min apart).
- UI: header `백업` button → shadcn Sheet: `지금 백업` with optional name, `자동 백업` Switch, Table of backups (time, kind Badge, name/reason, file count, 복원/삭제 behind AlertDialogs). Restore while running → `게임을 강제로 끄고 복원한 뒤 다시 실행해요. 저장하지 않은 진행은 사라져요.` (`끄고 복원`); otherwise a `복원 후 게임 실행` Switch (default on). The game-path Dialog is shared with `게임 실행` (`GamePathDialog`).
- Auto backups: before launching from the viewer (`게임 실행 전`), after the game saves while the bridge reports connected (`게임 저장 후`), and safety before restore.

## Tests
`tests/launcher/backups.test.ts` (copy, hash skip, retention, mirror restore + safety, ids/path traversal, MV vs MZ), `tests/launcher/gameProcess.test.ts` (process lookup fallback, kill/wait/timeout, kill → restore → relaunch ordering with fakes), middleware routes in `tests/launcher/launcher.test.ts`, `src/app/backups.test.ts` (storage, settle logic).
