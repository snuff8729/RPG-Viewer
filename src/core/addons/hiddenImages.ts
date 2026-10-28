/**
 * 읽기에서 숨길 그림(게임별, 그림 이름으로): 이름 그대로("Guageback") 또는 앞부분 + "*"("Guage*").
 * 대소문자는 가리지 않는다. 모두 예외를 던지지 않는다.
 */

export const HIDDEN_IMAGES_MAX = 300;
const PATTERN_MAX = 200;

/** 숨긴 그림 이름·패턴 하나를 고쳐 쓴다(앞뒤 공백 제거). 쓸 수 없으면 null("*"만·빈 것·너무 긴 것·가운데 "*") */
export function cleanHiddenPattern(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > PATTERN_MAX) return null;
  const star = s.indexOf("*");
  if (star >= 0 && star !== s.length - 1) return null;
  if (s === "*") return null;
  return s;
}

/** 숨긴 그림 목록(쓸 수 없는 것·같은 것(대소문자 무시)은 버린다, 최대 HIDDEN_IMAGES_MAX개) */
export function cleanHiddenImages(v: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(v)) return out;
  const seen = new Set<string>();
  for (const x of v) {
    if (out.length >= HIDDEN_IMAGES_MAX) break;
    const p = cleanHiddenPattern(x);
    if (!p) continue;
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/** 그림 이름이 패턴 하나에 맞는가 */
export function matchesHiddenPattern(name: string, pattern: string): boolean {
  if (typeof name !== "string" || typeof pattern !== "string" || !name || !pattern) return false;
  const n = name.toLowerCase(), p = pattern.toLowerCase();
  return p.endsWith("*") ? p.length > 1 && n.startsWith(p.slice(0, -1)) : n === p;
}

/** 숨긴 그림 목록 → 그림 이름이 숨긴 것인가. 목록이 비면 null. */
export function hiddenImageMatcher(patterns: readonly string[] | null | undefined): ((name: string) => boolean) | null {
  const list = cleanHiddenImages(patterns);
  if (list.length === 0) return null;
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const p of list) {
    const l = p.toLowerCase();
    if (l.endsWith("*")) prefixes.push(l.slice(0, -1)); else exact.add(l);
  }
  return (name: string) => {
    if (typeof name !== "string" || !name) return false;
    const n = name.toLowerCase();
    return exact.has(n) || prefixes.some(pre => n.startsWith(pre));
  };
}

/** 패턴(또는 이름)을 더한 숨긴 그림 목록. 새 `앞부분*`이 덮는, 이름 그대로 적은 것은 뺀다. 이미 있으면 그대로. */
export function withHidden(list: readonly string[] | null | undefined, pattern: string): string[] {
  const base = cleanHiddenImages(list);
  const p = cleanHiddenPattern(pattern);
  if (!p) return base;
  const rest = p.endsWith("*") ? base.filter(x => x.endsWith("*") || !matchesHiddenPattern(x, p)) : base;
  return rest.some(x => x.toLowerCase() === p.toLowerCase()) ? rest : [...rest, p];
}

/**
 * 비슷한 이름을 모두 숨길 패턴: 끝의 번호·괄호 부분을 뺀 이름 + "*"
 * ("Guage01" → "Guage*", "Guage (2)" → "Guage*", "Guageback" → "Guageback*"). 남는 게 없으면 이름 그대로.
 */
export function similarPattern(name: string): string {
  const n = typeof name === "string" ? name.trim() : "";
  if (!n) return "";
  let s = n;
  for (let prev = ""; prev !== s;) {
    prev = s;
    s = s.replace(/\s*[([][^()[\]]*[)\]]$/, "").replace(/[_\-\s.]*\d+$/, "");
  }
  s = s.replace(/[_\-\s.]+$/, "");
  return s && !s.endsWith("/") ? `${s}*` : n;
}
