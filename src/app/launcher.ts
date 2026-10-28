/**
 * 게임 실행 API(scripts/launcher.ts) 클라이언트.
 * 뷰어를 `npm run dev`·`npm run preview`로 열었을 때만 서버 쪽 API가 있다.
 */

export interface GameCheckResult {
  ok: boolean;
  title?: string;
  engine?: string;
  exe?: string;
  error?: string;
}

const NETWORK_ERROR = "뷰어 서버에 연결하지 못했어요";

let pingPromise: Promise<boolean> | null = null;

/** 게임 실행 API가 있는지(한 번만 확인하고 기억). */
export function launcherAvailable(): Promise<boolean> {
  pingPromise ??= fetch("/api/game/ping", { cache: "no-store" })
    .then(async (r) => r.ok && ((await r.json()) as { ok?: unknown }).ok === true)
    .catch(() => false);
  return pingPromise;
}

async function post(route: "check" | "launch", path: string): Promise<GameCheckResult> {
  try {
    const r = await fetch(`/api/game/${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    const body = (await r.json()) as GameCheckResult;
    if (!body || typeof body.ok !== "boolean") return { ok: false, error: NETWORK_ERROR };
    return body;
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

export const checkGame = (path: string) => post("check", path);
export const launchGame = (path: string) => post("launch", path);

export function gamePathKey(gameKey: string): string {
  return `rpgv.gamePath.${gameKey}`;
}

/** 기억한 게임 폴더 경로. 없거나 읽을 수 없으면 null. */
export function loadGamePath(gameKey: string): string | null {
  try {
    const v = localStorage.getItem(gamePathKey(gameKey));
    return v === null || v === "" ? null : v;
  } catch {
    return null;
  }
}

const pathListeners = new Set<() => void>();

/** 게임 폴더 경로가 바뀌면 알림(실행·백업 버튼이 같은 경로를 쓴다). */
export function onGamePathChanged(cb: () => void): () => void {
  pathListeners.add(cb);
  return () => { pathListeners.delete(cb); };
}

export function saveGamePath(gameKey: string, path: string): void {
  try { localStorage.setItem(gamePathKey(gameKey), path); } catch { /* 저장 못 해도 이번 실행은 된다 */ }
  for (const cb of [...pathListeners]) cb();
}
