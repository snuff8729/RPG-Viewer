/**
 * 세이브 폴더 백업 API(scripts/backups.ts, scripts/launcher.ts) 클라이언트와 자동 백업 판단.
 */

export type BackupKind = "auto" | "manual" | "safety";

export interface BackupMeta {
  id: string;
  kind: BackupKind;
  reason: string;
  name?: string;
  createdAt: string;
  fileCount: number;
  bytes: number;
  hash: string;
  /** 게임 루트 기준 세이브 폴더. 예전 백업에는 없다. */
  saveDir?: string;
}

export interface ApiError { ok: false; error: string }

const NETWORK_ERROR = "뷰어 서버에 연결하지 못했어요";

async function post<T extends object>(route: string, body: Record<string, unknown>): Promise<({ ok: true } & T) | ApiError> {
  try {
    const r = await fetch(`/api/game/${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json()) as { ok?: unknown; error?: unknown };
    if (!j || typeof j.ok !== "boolean") return { ok: false, error: NETWORK_ERROR };
    if (!j.ok) return { ...j, ok: false, error: typeof j.error === "string" ? j.error : NETWORK_ERROR } as ApiError;
    return j as { ok: true } & T;
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

export interface BackupList {
  backups: BackupMeta[];
  /** 지금 쓰는 세이브 폴더(게임 루트 기준) */
  saveDir?: string;
  /** 세이브 파일을 어디에서도 찾지 못함(NW.js localStorage 저장일 수 있음) */
  saveFilesMissing?: boolean;
}

export const fetchBackups = (path: string) => post<BackupList>("backups/list", { path });
export const fetchSaveState = (path: string) => post<{ signature: string }>("backups/state", { path });
export const makeBackup = (path: string, kind: BackupKind, reason: string, name?: string) =>
  post<{ skipped?: true; backup?: BackupMeta }>("backups/create", { path, kind, reason, ...(name ? { name } : {}) });
export const removeBackup = (path: string, id: string) => post<object>("backups/delete", { path, id });
export const fetchRunning = (path: string) => post<{ running: boolean }>("running", { path });

export interface RestoreOutcome { ok: boolean; error?: string; killed: number; relaunched: boolean }

/** 실행 중이면 강제로 끄고 복원한 뒤 다시 실행한다. 꺼져 있으면 `launch`일 때만 실행. */
export async function restoreAndRestart(path: string, id: string, launch: boolean): Promise<RestoreOutcome> {
  const r = await post<{ killed: number; relaunched: boolean; error?: string }>("restart-restore", { path, id, launch });
  const extra = r as Partial<RestoreOutcome>;
  return {
    ok: r.ok,
    ...(r.ok ? (extra.error ? { error: extra.error } : {}) : { error: r.error }),
    killed: typeof extra.killed === "number" ? extra.killed : 0,
    relaunched: extra.relaunched === true,
  };
}

// ── 자동 백업 설정(게임마다) ──

export const autoBackupKey = (gameKey: string) => `rpgv.autoBackup.${gameKey}`;

/** 자동 백업 켜짐 여부. 기본은 켜짐. */
export function loadAutoBackup(gameKey: string): boolean {
  try {
    return localStorage.getItem(autoBackupKey(gameKey)) !== "off";
  } catch {
    return true;
  }
}

export function saveAutoBackup(gameKey: string, on: boolean): void {
  try { localStorage.setItem(autoBackupKey(gameKey), on ? "on" : "off"); } catch { /* 이번 세션만 */ }
}

// ── 목록이 바뀌었음을 알림(자동 백업 뒤 열린 목록을 새로 고침) ──

const listeners = new Set<() => void>();
export function onBackupsChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
export function notifyBackupsChanged(): void {
  for (const cb of [...listeners]) cb();
}

// ── 게임 저장 감지: 세이브 폴더 서명이 바뀌고 다음 확인 때도 같으면(안정) 백업 ──

export const POLL_MS = 15_000;
export const MIN_GAP_MS = 2 * 60_000;

export interface WatchState {
  /** 마지막으로 백업한 서명. 처음엔 ""(모름) — 첫 안정 서명도 백업을 시도하고, 같은 내용이면 서버가 건너뛴다. */
  baseline: string;
  /** 직전 확인 때 본 서명 */
  prev: string | null;
  lastBackupAt: number | null;
}

export const initialWatch: WatchState = { baseline: "", prev: null, lastBackupAt: null };

/** 새로 본 서명으로 다음 상태와 지금 백업할지를 정한다. */
export function nextWatch(state: WatchState, signature: string, now: number, minGap = MIN_GAP_MS): { state: WatchState; backup: boolean } {
  const settled = signature !== state.baseline && signature === state.prev;
  const gapOk = state.lastBackupAt === null || now - state.lastBackupAt >= minGap;
  if (settled && gapOk) {
    return { state: { baseline: signature, prev: signature, lastBackupAt: now }, backup: true };
  }
  return { state: { ...state, prev: signature }, backup: false };
}

export const KIND_LABEL: Record<BackupKind, string> = { manual: "수동", auto: "자동", safety: "복원 전" };

/** 파일이 하나도 없는 백업(세이브 폴더를 못 찾던 때 만든 것 등). */
export function isEmptyBackup(b: Pick<BackupMeta, "fileCount">): boolean {
  return b.fileCount === 0;
}
