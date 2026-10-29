// 가릴 글인지 판단: 낱말 목록(keywords.ts) 찾기와 ASCII가 아닌 글자 찾기. 찾은 낱말은 돌려주지 않고 위치만 준다.
import { MASK_VOCABULARY } from "./keywords";

const isAsciiWord = (w: string) => /^[a-z_-]+$/i.test(w);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ASCII_WORDS = MASK_VOCABULARY.filter(isAsciiWord).map((w) => w.toLowerCase());
const OTHER_WORDS = MASK_VOCABULARY.filter((w) => !isAsciiWord(w));
/** 경계를 안 보는 빠른 거름망 — 걸리면 그때 자세히 본다 */
const PREFILTER = new RegExp([...MASK_VOCABULARY].sort((a, b) => b.length - a.length).map(escapeRe).join("|"), "i");

const isLetter = (c: string | undefined) => c !== undefined && /[A-Za-z]/.test(c);
const isLower = (c: string) => c >= "a" && c <= "z";
const isUpper = (c: string) => c >= "A" && c <= "Z";

/** ASCII 낱말의 경계: 글자가 아닌 것(숫자·`_`·`-`·공백 등), 또는 camelCase 경계(소문자→대문자) */
function asciiBoundaryOk(s: string, i: number, j: number): boolean {
  const before = i === 0 || !isLetter(s[i - 1]) || (isLower(s[i - 1]) && isUpper(s[i]));
  const after = j >= s.length || !isLetter(s[j]) || (isLower(s[j - 1]) && isUpper(s[j]));
  return before && after;
}

/** 낱말이 걸린 위치들 [시작, 끝). first면 하나 찾고 멈춘다. */
export function keywordHits(text: string, first = false): [number, number][] {
  const out: [number, number][] = [];
  if (typeof text !== "string" || text === "" || !PREFILTER.test(text)) return out;
  const lower = text.toLowerCase();
  // toLowerCase가 길이를 바꾸는 글자가 있으면 원문 기준으로 대소문자 무시 비교
  const same = lower.length === text.length;
  for (const w of ASCII_WORDS) {
    if (same) {
      for (let i = lower.indexOf(w); i !== -1; i = lower.indexOf(w, i + 1)) {
        if (asciiBoundaryOk(text, i, i + w.length)) { out.push([i, i + w.length]); if (first) return out; }
      }
    } else {
      const re = new RegExp(escapeRe(w), "gi");
      for (let m = re.exec(text); m; m = re.exec(text)) {
        if (asciiBoundaryOk(text, m.index, m.index + w.length)) { out.push([m.index, m.index + w.length]); if (first) return out; }
        re.lastIndex = m.index + 1;
      }
    }
  }
  for (const w of OTHER_WORDS) {
    for (let i = text.indexOf(w); i !== -1; i = text.indexOf(w, i + 1)) {
      out.push([i, i + w.length]);
      if (first) return out;
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

export function hasKeyword(text: string): boolean {
  return keywordHits(text, true).length > 0;
}

/** ASCII가 아닌 글자(한자·가나·한글·악센트 라틴 등). 기호(…, ♪)는 셈하지 않는다. */
export function hasNonAsciiLetter(text: string): boolean {
  return /(?=\P{ASCII})[\p{L}\p{N}]/u.test(text);
}

/** 한자·가나(일본어/중국어 글). 보고서 같은 한국어 글에서 사전에 없는 게임 글을 더 가릴 때 쓴다. */
export function hasCjkKana(text: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}々ー]/u.test(text);
}
