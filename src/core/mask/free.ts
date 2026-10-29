// 사전으로 하는 일: 사람이 쓴 글(진단 보고서·문제 설명) 가리기, 토큰 되돌리기, 마지막 안전 검사.
import { hasCjkKana, hasKeyword, keywordHits } from "./detect";
import { maskRun, type MaskContext } from "./text";
import { TOKEN_PATTERN } from "./token";

/** 토큰 → 원래 글 사전을 빨리 찾게 정리한 것(첫 두 글자 → 긴 것부터) */
export interface FreeTextIndex { buckets: Map<string, [string, string][]> }

export function buildFreeTextIndex(dict: ReadonlyMap<string, string>): FreeTextIndex {
  const buckets = new Map<string, [string, string][]>();
  for (const [token, original] of dict) {
    if (typeof original !== "string" || original.length < 2) continue;
    const key = original.slice(0, 2);
    const list = buckets.get(key);
    if (list) list.push([original, token]); else buckets.set(key, [[original, token]]);
  }
  for (const list of buckets.values()) list.sort((a, b) => b[0].length - a[0].length);
  return { buckets };
}

const freeSensitive = (w: string) => hasKeyword(w) || hasCjkKana(w);

/** 낱말 안쪽(앞 글자가 한글·ASCII 글자/숫자)에서는 사전 글을 찾지 않는다 — "만들어요"의 "들어" 같은 것 */
const WORD_INNER = /[\p{Script=Hangul}A-Za-z0-9_]/u;
const KEEP_SPLIT = /[\s`*()[\]{}:;,.·—…/|"'!?<>=#~-]+/;

/** 이 글에 나오는 한국어 낱말들(토큰이 든 것은 뺀다). 가린 사본으로 만든 보고서에서 뽑으면 뷰어 자신의 문구다. */
export function keepWordsOf(text: string): string[] {
  if (typeof text !== "string") return [];
  const out = new Set<string>();
  for (const w of text.split(KEEP_SPLIT)) if (w !== "" && !w.includes("T_") && /\p{Script=Hangul}/u.test(w)) out.add(w);
  return [...out];
}

/**
 * 사람이 쓴 글을 가린다: 게임에서 나온 글 조각(두 글자 이상)이 낱말 첫머리에 보이면 긴 것부터 그 토큰으로 바꾸고,
 * 남은 낱말 목록·한자·가나 낱말도 토큰으로. 사용자가 쓴 한국어 낱말은 게임 글이 아니면 그대로 읽힌다.
 * keep: 이 낱말이 통째로 나오는 자리는 사전으로 바꾸지 않는다(뷰어 보고서 문구 등). 예외 없음.
 */
export function maskFreeText(text: string, index: FreeTextIndex, ctx?: MaskContext, keep: Iterable<string> = []): string {
  if (typeof text !== "string" || text === "") return text;
  try {
    const kept = new Uint8Array(text.length);
    for (const w of keep) {
      if (typeof w !== "string" || w === "") continue;
      for (let i = text.indexOf(w); i !== -1; i = text.indexOf(w, i + 1)) {
        const before = text[i - 1], after = text[i + w.length];
        if ((before === undefined || !WORD_INNER.test(before)) && (after === undefined || !WORD_INNER.test(after))) kept.fill(1, i, i + w.length);
      }
    }
    let out = "";
    for (let i = 0; i < text.length;) {
      const inner = i > 0 && WORD_INNER.test(text[i - 1]);
      const list = inner || kept[i] ? undefined : index.buckets.get(text.slice(i, i + 2));
      const hit = list?.find(([o]) => text.startsWith(o, i));
      if (hit) { out += hit[1]; i += hit[0].length; } else { out += text[i]; i++; }
    }
    return out.split(/(\r?\n)/).map((p, i) => (i % 2 === 1 ? p : maskRun(p, ctx, freeSensitive))).join("");
  } catch { return text; }
}

export interface UnmaskResult { text: string; replaced: number; unknown: string[] }

/** 토큰을 원래 글로 되돌린다. 사전에 없는 토큰은 그대로 두고 알린다. */
export function unmaskText(text: string, dict: ReadonlyMap<string, string>): UnmaskResult {
  if (typeof text !== "string") return { text, replaced: 0, unknown: [] };
  let replaced = 0;
  const unknown = new Set<string>();
  const out = text.replace(TOKEN_PATTERN, (t) => {
    const o = dict.get(t);
    if (o === undefined) { unknown.add(t); return t; }
    replaced++;
    return o;
  });
  return { text: out, replaced, unknown: [...unknown] };
}

export interface ScanHit { file: string; line: number }
export interface ScanResult { count: number; hits: ScanHit[] }

/** 마지막 안전 검사: 낱말 목록이 남았는지. 낱말은 돌려주지 않고 파일·줄만. */
export function scanText(text: string, file = ""): ScanHit[] {
  if (typeof text !== "string" || text === "") return [];
  const hits = keywordHits(text);
  if (hits.length === 0) return [];
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return hits.map(([at]) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= at) lo = mid; else hi = mid - 1; }
    return { file, line: lo + 1 };
  });
}

export function scanFiles(files: Iterable<{ path: string; text: string }>): ScanResult {
  const hits: ScanHit[] = [];
  for (const f of files) hits.push(...scanText(f.text, f.path));
  return { count: hits.length, hits };
}
