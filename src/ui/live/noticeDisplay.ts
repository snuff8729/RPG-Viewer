import { useCallback, useSyncExternalStore } from "react";
import { NOTICE_KINDS, type NoticeKind } from "@/core/addons/notices";

/** 읽기·기록의 `알림 문구 보기`(알림 문구 기록 애드온의 문구를 보일지). 기본 켬, 브라우저에 기억한다. 화면 사이에 공유한다. */
const KEY = "rpgv.reader.notices";
const listeners = new Set<() => void>();
let shown: boolean | null = null;

function load(): boolean {
  try { return localStorage.getItem(KEY) !== "0"; } catch { return true; }
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
function get(): boolean {
  if (shown === null) shown = load();
  return shown;
}

export function useNoticesShown(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, get);
  const set = useCallback((v: boolean) => {
    shown = v;
    try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* 저장소 사용 불가 */ }
    listeners.forEach((fn) => fn());
  }, []);
  return [on, set];
}

/** 숨긴 알림 종류(업적·획득·퀘스트·알림). 기본 없음, 브라우저에 기억한다. 화면 사이에 공유한다. */
const KINDS_KEY = "rpgv.reader.noticeKindsHidden";
const EMPTY: ReadonlySet<NoticeKind> = new Set();
let hiddenKinds: ReadonlySet<NoticeKind> | null = null;

/** 저장된 값 → 아는 종류만 */
export function parseHiddenKinds(raw: string | null): ReadonlySet<NoticeKind> {
  try {
    const v: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(v)) return EMPTY;
    const out = new Set<NoticeKind>();
    for (const x of v) if ((NOTICE_KINDS as readonly unknown[]).includes(x)) out.add(x as NoticeKind);
    return out;
  } catch {
    return EMPTY;
  }
}
function getKinds(): ReadonlySet<NoticeKind> {
  if (hiddenKinds === null) {
    try { hiddenKinds = parseHiddenKinds(localStorage.getItem(KINDS_KEY)); } catch { hiddenKinds = EMPTY; }
  }
  return hiddenKinds;
}

export function useHiddenNoticeKinds(): [ReadonlySet<NoticeKind>, (kind: NoticeKind, shown: boolean) => void] {
  const hidden = useSyncExternalStore(subscribe, getKinds);
  const set = useCallback((kind: NoticeKind, on: boolean) => {
    const next = new Set(getKinds());
    if (on) next.delete(kind); else next.add(kind);
    hiddenKinds = next;
    try { localStorage.setItem(KINDS_KEY, JSON.stringify([...next])); } catch { /* 저장소 사용 불가 */ }
    listeners.forEach((fn) => fn());
  }, []);
  return [hidden, set];
}
