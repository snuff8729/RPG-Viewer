/**
 * 휴대폰 보기(scripts/lanShare.ts) 클라이언트.
 * - PC: 켜기·끄기·새 QR·상태, 연 게임 알리기
 * - 휴대폰: 주소의 `remote=1`로 알아보고(세션 저장소에 남겨 새로 고쳐도 유지), 공유 중인 게임을 연다(쓰기는 게임 보조·치트·게임 설정 파일만)
 */
import type { FetchFn, ServerSession } from "./serverFolder";

const defaultFetch: FetchFn = (input, init) => fetch(input, init);
const NETWORK_ERROR = "뷰어 서버에 연결하지 못했어요";
export const REMOTE_KEY = "rpgv.remote";
export const SHARE_DAYS = [1, 7, 30] as const;
export const DEFAULT_SHARE_DAYS = 7;
/** 휴대폰이 공유 상태를 다시 확인하는 간격 */
export const REMOTE_CHECK_MS = 5000;

interface StoreLike { getItem(k: string): string | null; setItem(k: string, v: string): void }

function sessionStore(): StoreLike | null {
  try { return window.sessionStorage; } catch { return null; }
}

/** 휴대폰 보기로 연 창인지. 주소에 `remote=1`이 있으면 기억해 두어, 새로 고쳐도(주소가 바뀌어도) 그대로다. */
export function detectRemote(search: string, store: StoreLike | null = sessionStore()): boolean {
  if (new URLSearchParams(search).get("remote") === "1") {
    try { store?.setItem(REMOTE_KEY, "1"); } catch { /* 저장 못 해도 이번엔 된다 */ }
    return true;
  }
  try { return store?.getItem(REMOTE_KEY) === "1"; } catch { return false; }
}

let remoteCache: boolean | null = null;

/** 이 창이 휴대폰 보기인지(처음 한 번 판단). */
export function isRemoteView(): boolean {
  remoteCache ??= typeof window !== "undefined" && detectRemote(window.location.search);
  return remoteCache;
}

export type SharedResult = { ok: true; session: ServerSession } | { ok: false; error: string };

/** 휴대폰: 공유 중인 게임. 막히면(꺼짐·기간 끝·QR 바뀜) 서버가 준 문구를 돌려준다. */
export async function fetchSharedSession(fetchFn: FetchFn = defaultFetch): Promise<SharedResult> {
  try {
    const r = await fetchFn("/api/share/current", { cache: "no-store" });
    const j = (await r.json()) as Record<string, unknown>;
    if (j?.ok === true && typeof j.id === "string") {
      const name = typeof j.name === "string" ? j.name : "";
      return {
        ok: true,
        // 휴대폰은 PC의 폴더 경로를 모른다(휴대폰 보기 폴더는 경로로 다시 열지 않는다).
        session: { id: j.id, root: "", name, title: typeof j.title === "string" ? j.title : "", engine: typeof j.engine === "string" ? j.engine : "" },
      };
    }
    return { ok: false, error: typeof j?.error === "string" ? j.error : NETWORK_ERROR };
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

export interface ShareStatus {
  on: boolean;
  /** 켜 두었지만 허용 기간이 끝났다 */
  expired: boolean;
  expiresAt: number | null;
  days: number;
  gamePath: string | null;
  title: string | null;
  urls: string[];
}

export type ShareResult = ({ ok: true } & ShareStatus) | { ok: false; error: string };

function toResult(j: unknown): ShareResult {
  const o = j as Record<string, unknown> | null;
  if (o?.ok !== true) return { ok: false, error: typeof o?.error === "string" ? o.error : NETWORK_ERROR };
  return {
    ok: true,
    on: o.on === true,
    expired: o.expired === true,
    expiresAt: typeof o.expiresAt === "number" ? o.expiresAt : null,
    days: typeof o.days === "number" ? o.days : DEFAULT_SHARE_DAYS,
    gamePath: typeof o.gamePath === "string" ? o.gamePath : null,
    title: typeof o.title === "string" ? o.title : null,
    urls: Array.isArray(o.urls) ? o.urls.filter((u): u is string => typeof u === "string") : [],
  };
}

async function post(route: string, body: unknown, fetchFn: FetchFn): Promise<ShareResult> {
  try {
    const r = await fetchFn(`/api/share/${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return toResult(await r.json());
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

export async function shareStatus(fetchFn: FetchFn = defaultFetch): Promise<ShareResult> {
  try {
    const r = await fetchFn("/api/share/status", { cache: "no-store" });
    return toResult(await r.json());
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

export const startShare = (days: number, gamePath: string | null, fetchFn: FetchFn = defaultFetch) =>
  post("start", gamePath ? { days, gamePath } : { days }, fetchFn);
export const stopShare = (fetchFn: FetchFn = defaultFetch) => post("stop", {}, fetchFn);
export const rotateShare = (fetchFn: FetchFn = defaultFetch) => post("rotate", {}, fetchFn);
/** PC가 연 게임을 알린다(켜져 있을 때만 서버가 바꾼다). */
export const shareGame = (gamePath: string, fetchFn: FetchFn = defaultFetch) => post("game", { gamePath }, fetchFn);

const dateFormat = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" });

/** "5월 3일까지 허용" */
export function untilText(expiresAt: number): string {
  return `${dateFormat.format(new Date(expiresAt))}까지 허용`;
}
