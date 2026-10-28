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
  // 1.19.0
  { source: "toast", path: "jQuery.toaster", plugins: ["AXY_Toast"] },
  { source: "achievement", path: "Torigoya.Achievement.Manager.notify", plugins: ["Torigoya_Achievement"] },
  { source: "achievement", path: "Torigoya.Achievement2.manager.unlock", plugins: ["TorigoyaMZ_Achievement2"] },
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
  if (source === "toast") return "토스트 알림";
  if (source === "achievement") return "업적";
  if (source === "html") return "화면 위 글(HTML)";
  if (source === "livecomment") return "코멘트";
  if (source === "notify" || source === "info") return "알림";
  return typeof source === "string" && source ? source : "알림";
}

/** 알림 문구 종류(읽기에서 아이콘·거르기): 업적, 획득(경험치·돈·아이템·레벨), 퀘스트, 그 밖의 알림 */
export type NoticeKind = "achievement" | "gain" | "quest" | "info";
export const NOTICE_KINDS: readonly NoticeKind[] = ["achievement", "gain", "quest", "info"];
export const NOTICE_KIND_LABELS: Record<NoticeKind, string> = { achievement: "업적", gain: "획득", quest: "퀘스트", info: "알림" };

const ACHIEVEMENT_RE = /업적|実績|成就|achievement|trophy|トロフィー/i;
const QUEST_RE = /퀘스트|クエスト|任务|任務|quest|mission|미션|의뢰/i;
const MONEY_EXP_RE = /\bexp\b|경험치|経験値|经验|\bgold\b|골드|ゴールド|金币|金钱|金幣|\d\s*G\b|\bG\s*\+?\d/i;
const GAIN_RE = /획득|얻었|입수|入手|獲得|获得|得到|obtained|gained|\bgot\b|레벨|レベル|等级|level\s*up/i;

/** 돈·경험치 이야기인가(획득 아이콘을 동전으로) */
export function isMoneyOrExp(text: unknown): boolean {
  return typeof text === "string" && MONEY_EXP_RE.test(text);
}

/**
 * 알림 문구 종류. 기록의 kind(1.19.0: 획득·퀘스트 함수 안에서 뜬 것) → source(업적 등) → 글 모양 순서로 정한다. 예외를 던지지 않는다.
 */
export function classifyNotice(source: unknown, text: unknown, kind?: unknown): NoticeKind {
  if (kind === "gain" || kind === "quest" || kind === "achievement") return kind;
  if (source === "achievement") return "achievement";
  if (source === "quest") return "quest";
  if (source === "gain") return "gain";
  const t = typeof text === "string" ? text : "";
  if (ACHIEVEMENT_RE.test(t)) return "achievement";
  if (QUEST_RE.test(t)) return "quest";
  if (MONEY_EXP_RE.test(t) || GAIN_RE.test(t)) return "gain";
  return "info";
}

/** notice 기록의 종류 */
export function noticeRecordKind(r: { source?: unknown; text?: unknown; raw?: unknown; kind?: unknown } | null | undefined): NoticeKind {
  if (!r || typeof r !== "object") return "info";
  return classifyNotice(r.source, typeof r.text === "string" && r.text ? r.text : r.raw, r.kind);
}

/** 알림 문구 숨기기: true = 모두, 집합 = 그 종류만, false·없음 = 보인다 */
export type NoticeHide = boolean | ReadonlySet<NoticeKind> | undefined;
export function isNoticeHidden(r: Parameters<typeof noticeRecordKind>[0], hide: NoticeHide): boolean {
  if (hide === true) return true;
  if (!hide || hide.size === 0) return false;
  return hide.has(noticeRecordKind(r));
}
