import { parsePluginsJs } from "../live/installer";

/**
 * 알림 문구 기록(플러그인 1.9.0+): 다른 플러그인이 화면에 잠깐 띄우는 문구(티커·코멘트·알림)를 기록하는 애드온.
 * 게임 쪽 기록 플러그인이 아래 함수가 있으면 감싸서 첫 인자(글)를 `notice` 기록으로 남긴다. 모두 예외를 던지지 않는다.
 */

/** 기록 플러그인이 알아서 감싸는 함수와 그 함수를 만드는 플러그인 이름(plugins.js) */
export const KNOWN_NOTICE_APIS: readonly { source: string; path: string; plugins: readonly string[] }[] = [
  { source: "ticker", path: "TickerManager.show", plugins: ["Ticker", "TickerSystem"] },
  { source: "livecomment", path: "LiveCommentContainer.prototype.show", plugins: ["LiveComment"] },
  { source: "notify", path: "Torigoya.NotifyMessage.Manager.notify", plugins: ["TorigoyaMZ_NotifyMessage"] },
];

const PATH_RE = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;
export const NOTICE_HOOKS_MAX = 20;
const PATH_MAX = 200;

/** 직접 추가할 함수 경로(`Global.path.to.fn`)로 쓸 수 있는가 */
export function isNoticeHookPath(v: unknown): v is string {
  return typeof v === "string" && v.length <= PATH_MAX && PATH_RE.test(v) && !v.split(".").includes("__proto__");
}

/** 저장된 값 → 쓸 수 있는 경로만(앞뒤 공백 제거, 중복 제거, 최대 20개) */
export function cleanNoticeHooks(v: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(v)) return out;
  for (const x of v) {
    const p = typeof x === "string" ? x.trim() : x;
    if (isNoticeHookPath(p) && !out.includes(p)) out.push(p);
    if (out.length >= NOTICE_HOOKS_MAX) break;
  }
  return out;
}

/** plugins.js에서 켜진 플러그인 중 알림 문구를 띄우는 것으로 아는 플러그인 이름들 */
export function noticePluginsOf(pluginsText: string | null | undefined): string[] {
  try {
    const entries = typeof pluginsText === "string" ? parsePluginsJs(pluginsText) ?? [] : [];
    const known = new Map<string, string>();
    for (const a of KNOWN_NOTICE_APIS) for (const p of a.plugins) known.set(p.toLowerCase(), p);
    const out: string[] = [];
    for (const e of entries) {
      if (!e || typeof e !== "object" || e.status !== true || typeof e.name !== "string") continue;
      const name = known.get(e.name.trim().toLowerCase());
      if (name && !out.includes(name)) out.push(name);
    }
    return out;
  } catch {
    return [];
  }
}

/** 기록의 source → 보일 이름 */
export function noticeSourceLabel(source: unknown): string {
  if (source === "ticker") return "티커";
  if (source === "livecomment") return "코멘트";
  if (source === "notify" || source === "info") return "알림";
  return typeof source === "string" && source ? source : "알림";
}
