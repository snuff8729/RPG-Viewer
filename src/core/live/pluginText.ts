// 플러그인 명령(MV 356 / MZ 357)이 사람이 읽을 글(조사 문구·알림)인지, 변수·효과음 같은 기술 명령인지 가른다.
// 플러그인마다 명령 이름이 제각각이라 인자 내용(문장처럼 보이는 글이 있는가)으로 먼저 판단하고,
// 이름은 애매한 경우(띄어쓰기·문장 부호 없는 긴 글)에만 약한 힌트로 쓴다. 사용자가 명령마다 정한 값이 있으면 그것이 이긴다.
// 순수 함수, 예외를 던지지 않는다.

export type PluginClass = { kind: "text"; text: string; label?: string } | { kind: "tech" };
/** 명령별 사용자 설정: show = 항상 보이기, hide = 항상 숨기기 (없으면 자동) */
export type PluginOverride = "show" | "hide";
export type PluginOverrides = Readonly<Record<string, PluginOverride>>;

/** 기록(type "plugin")이나 이벤트 명령에서 뽑은 플러그인 명령 정보. 구버전 기록은 text만 있다. */
export interface PluginRecLike {
  code?: unknown;
  text?: unknown;
  /** MZ 플러그인 이름 */
  plugin?: unknown;
  /** 명령 이름(MV 첫 토큰, MZ 명령) */
  name?: unknown;
  /** MV: 나머지 토큰(문자열 배열), MZ: 인자 객체 */
  args?: unknown;
}

const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const tokens = (s: string): string[] => s.split(/[\s　]+/).filter(Boolean);

/** 한글·가나·한자 글자 */
const CJK = /[\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu;
const hasCjk = (s: string): boolean => /[\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(s);
/** 문장 부호(동아시아 + 라틴) */
const SENTENCE_PUNCT = /[。．！？!?…、，「」『』～♪]|[.,](?=\s|$)/;
/** 시스템 이름에 흔한 끝말(공백 없는 한 덩어리일 때만 본다) */
const SYSTEM_SUFFIX = /(呼び出し|呼出し?|リセット|チェック|判定|初期化|設定|処理|実行|開始|終了|更新|変数|スイッチ|フラグ)$/;
/** 기술 명령에 흔한 이름(약한 힌트) */
const TECH_NAME_I = /call|light|tone|wait|var|switch|sound|pic|fade|flash|shake|weather|face/i;
const TECH_NAME_CASE = /Id$|SE|BGM|BGS|ME$/;
/** 제어 문자(\C[2], \V[1], \N[1], \. 등) */
const ESCAPES = /\\[A-Za-z]+\[[^\]]*\]|\\[A-Za-z{}|.!<>^$]/g;
const FILE_LIKE = /^[^\s]+\.(png|jpe?g|webp|ogg|m4a|wav|mp3|json|js|txt|rpgmvp|rpgmvo|png_)$/i;
const IDENT_OR_NUM = /^(?:[-+]?\d+(?:\.\d+)?|[A-Za-z_$][\w$.-]*)$/;
const BRACKETED = /^[[【［(（<〈].*?[\]】］)）>〉]/;

/** 이름이 기술 명령처럼 보이는가(약한 힌트) */
export function techLikeName(name: string): boolean {
  return TECH_NAME_I.test(name) || TECH_NAME_CASE.test(name) || SYSTEM_SUFFIX.test(name);
}

/**
 * 한 덩어리 글이 사람이 읽을 문장처럼 보이는가.
 * - 한글·가나·한자 2자 이상 + (단어 사이 띄어쓰기 또는 문장 부호) → 문장
 * - 띄어쓰기·문장 부호 없이 6자 이상 → 이름 힌트가 기술 명령이 아니고, 대괄호 시스템 이름·시스템 끝말이 아니면 문장
 * - 라틴 글자만: 2단어 이상 + 문장 부호 → 문장
 * 숫자·식별자·파일 이름만이면 아니다.
 */
export function looksLikeText(raw: string, techHint = false): boolean {
  const s = raw.replace(ESCAPES, "").trim();
  if (!s) return false;
  if (!/\p{L}/u.test(s)) return false;
  if (/^[{[]\s*["{[\]}]/.test(s)) return false; // JSON
  const toks = tokens(s);
  if (toks.every(t => IDENT_OR_NUM.test(t) || FILE_LIKE.test(t))) {
    // 라틴 문장은 식별자처럼 생긴 단어로만 이뤄질 수 있으니 문장 부호가 끝에 붙은 경우는 아래에서 다시 본다
    if (!/[A-Za-z]{2,}[.!?…](?:\s|$)/.test(s)) return false;
  }
  const cjk = (s.match(CJK) ?? []).length;
  const spaced = toks.length >= 2;
  const punct = SENTENCE_PUNCT.test(s);
  if (cjk >= 2) {
    if (spaced || punct) return true;
    if (cjk < 6 || techHint) return false;
    if (BRACKETED.test(s) || SYSTEM_SUFFIX.test(s) || FILE_LIKE.test(s)) return false;
    return true;
  }
  if (cjk === 1) return spaced && punct;
  // 라틴 글자만
  if (s.includes("/") || s.includes("\\")) return false;
  const words = toks.filter(t => /[A-Za-z]{2,}/.test(t)).length;
  return words >= 2 && /[A-Za-z][.!?…,](?:\s|$)/.test(s);
}

/** 앞쪽의 식별자·숫자 토큰(Search, 1 등)을 뒤에 한글·가나·한자 글이 있을 때만 떼어 낸다. */
function stripLeading(toks: string[]): string[] {
  let i = 0;
  while (i < toks.length - 1 && IDENT_OR_NUM.test(toks[i]) && hasCjk(toks.slice(i + 1).join(" "))) i++;
  return toks.slice(i);
}

/** MZ 인자 객체 안의 문자열 값(구조체·목록 JSON 문자열은 한두 단계 펼친다). 힌트 키(text·message 등)가 먼저. */
function argStrings(v: unknown, depth = 0, out: { key: string; value: string }[] = [], key = ""): { key: string; value: string }[] {
  if (depth > 3 || out.length > 50) return out;
  if (typeof v === "string") {
    const t = v.trim();
    if (/^[{[]/.test(t)) {
      try { return argStrings(JSON.parse(t) as unknown, depth + 1, out, key); } catch { /* 그냥 글 */ }
    }
    if (t) out.push({ key, value: t });
  } else if (Array.isArray(v)) {
    for (const x of v) argStrings(x, depth + 1, out, key);
  } else if (isObj(v)) {
    for (const k of Object.keys(v)) argStrings(v[k], depth + 1, out, k);
  }
  return out;
}

const HINT_KEY = /text|message|msg|name|desc|note|label|title|content|string/i;

interface Parsed { code: number; plugin: string; name: string; args: string[] | Record<string, unknown> | null; raw: string }

function parse(rec: PluginRecLike): Parsed {
  const code = rec.code === 357 ? 357 : 356;
  const raw = str(rec.text).trim();
  let plugin = str(rec.plugin), name = str(rec.name);
  let args: Parsed["args"] = null;
  if (code === 357) {
    if (isObj(rec.args)) args = rec.args;
    if (!name && !plugin) { // 구버전: "플러그인 명령 인자들"
      const t = tokens(raw);
      plugin = t[0] ?? ""; name = t[1] ?? "";
      args = t.slice(2);
    }
  } else {
    if (Array.isArray(rec.args)) args = rec.args.map(str);
    if (!name) {
      const t = tokens(raw);
      name = t[0] ?? "";
      args = t.slice(1);
    }
  }
  return { code, plugin, name, args, raw };
}

/** 명령별 설정 키: MV는 명령 이름, MZ는 `플러그인/명령`. */
export function pluginKey(rec: PluginRecLike): string {
  try {
    const p = parse(rec);
    return p.code === 357 && p.plugin ? `${p.plugin}/${p.name}` : p.name;
  } catch { return ""; }
}

/** 설정 없이 내용으로만 고른 글(없으면 null) */
function autoText(p: Parsed): string | null {
  const hint = techLikeName(p.name) || (p.code === 357 && techLikeName(p.plugin) && !p.name);
  if (Array.isArray(p.args)) {
    const rest = stripLeading(tokens(p.args.join(" ")));
    const text = rest.join(" ");
    return looksLikeText(text, hint) ? text : null;
  }
  if (p.args) {
    const vals = argStrings(p.args).sort((a, b) => Number(HINT_KEY.test(b.key)) - Number(HINT_KEY.test(a.key)));
    const texts = vals.filter(v => looksLikeText(v.value, hint && !HINT_KEY.test(v.key))).map(v => v.value);
    return texts.length > 0 ? texts.join(" ") : null;
  }
  return null;
}

/**
 * 플러그인 명령 기록을 글(보일 것)과 기술 명령(숨길 것)으로 가른다. overrides에 그 명령(pluginKey)의 설정이 있으면 그것이 이긴다:
 * show면 글로(내용에서 고른 글, 없으면 이름 뒤 인자, 그것도 없으면 원문), hide면 기술 명령으로.
 */
export function classifyPluginRecord(rec: PluginRecLike, overrides?: PluginOverrides | null): PluginClass {
  try {
    const p = parse(isObj(rec) ? rec : {});
    const key = p.code === 357 && p.plugin ? `${p.plugin}/${p.name}` : p.name;
    const o = overrides && key && Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : undefined;
    if (o === "hide") return { kind: "tech" };
    const text = autoText(p);
    if (text !== null) return { kind: "text", text };
    if (o === "show") {
      const rest = Array.isArray(p.args) ? p.args.join(" ").trim()
        : p.args ? argStrings(p.args).map(v => v.value).join(" ") : "";
      return { kind: "text", text: rest || p.raw || key };
    }
    return { kind: "tech" };
  } catch {
    return { kind: "tech" };
  }
}

/** 이벤트 명령(356/357)을 기록과 같은 모양으로. 플러그인 명령이 아니면 null. */
export function pluginRecOfCommand(cmd: { code?: unknown; parameters?: unknown } | null | undefined): PluginRecLike | null {
  if (!cmd || (cmd.code !== 356 && cmd.code !== 357)) return null;
  const p = Array.isArray(cmd.parameters) ? cmd.parameters : [];
  if (cmd.code === 356) return { code: 356, text: str(p[0]).trim() };
  return { code: 357, plugin: str(p[0]), name: str(p[1]), args: isObj(p[3]) ? p[3] : {}, text: [str(p[0]), str(p[1])].join(" ").trim() };
}
