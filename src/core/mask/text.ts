// 게임 글 한 줄(문자열)을 가린다. 제어 문자(\C[2] 등)·줄바꿈은 그대로 두고, 그 사이 글 조각에서
// ASCII가 아닌 글자나 낱말 목록이 든 낱말만 토큰으로 바꾼다. 영어 식별자·숫자·경로는 남겨 흐름을 따라갈 수 있게 한다.
import { hasKeyword, hasNonAsciiLetter } from "./detect";
import { tokenOf } from "./token";

export interface MaskContext {
  /** 토큰 → 원래 글(가리기 한 번 돌리면 쌓인다. 되돌리기·자유 글 가리기에 쓴다) */
  dict: Map<string, string>;
  /** 바꾼 횟수 */
  replaced: number;
  /** 같은 토큰에 다른 글이 걸린 횟수(해시 충돌) */
  collisions: number;
  /** 문법을 못 읽어 줄 단위로 가린 JS 파일 수 */
  jsFallbacks: number;
  cache: Map<string, { out: string; n: number }>;
}

export function createMaskContext(): MaskContext {
  return { dict: new Map(), replaced: 0, collisions: 0, jsFallbacks: 0, cache: new Map() };
}

/** RPG Maker 제어 문자: \C[2] \N[1] \V[3] \{ \. \| \! \> \< \^ \$ \\, 플러그인식 \XXX[...] \XXX<...> — 그리고 줄바꿈 */
const SEGMENT = /(\\[A-Za-z]+(?:\[[^\]\r\n]*\]|<[^>\r\n]*>)?|\\[{}$.|!><^\\]|\r?\n)/;
const ESCAPE_PARTS = /^(\\[A-Za-z]+)(?:([[<])(.*)([\]>]))?$/s;
/**
 * 글 조각을 낱말로 나누는 자리: 공백과 구조를 나타내는 ASCII 기호(노트 태그 <Price: 100>, 경로 a/b 등).
 * 역슬래시·따옴표도 넣어 토큰이 그런 글자를 품지 않게 한다 — 되돌릴 때 JSON/JS 문자열 안에 그대로 넣어도 안전하다.
 */
const WORD_SEP = /([\s\p{Cc}<>[\](){}:;,=|"'`/\\!$*#]+)/u;

export type Sensitive = (word: string) => boolean;
export const defaultSensitive: Sensitive = (w) => hasNonAsciiLetter(w) || hasKeyword(w);

/** 글 조각 → 토큰(사전에 적는다) */
export function tokenFor(ctx: MaskContext | undefined, text: string): string {
  const t = tokenOf(text);
  if (ctx) {
    const prev = ctx.dict.get(t);
    if (prev === undefined) ctx.dict.set(t, text);
    else if (prev !== text) ctx.collisions++;
    ctx.replaced++;
  }
  return t;
}

/**
 * 제어 문자가 없는 글 조각: 낱말로 나눠 가릴 낱말을 토큰으로. 공백으로만 이어진 가릴 낱말들은
 * 한 토큰으로 묶는다(한국어 문장 등). 묶는 공백은 보통 공백·전각 공백뿐(탭·CR은 문자열에서 이스케이프되므로 토큰 밖).
 * 앞뒤 공백·기호는 남는다.
 */
export function maskRun(run: string, ctx?: MaskContext, sensitive: Sensitive = defaultSensitive): string {
  if (run === "") return run;
  const parts = run.split(WORD_SEP);
  if (!parts.some((p, i) => i % 2 === 0 && p !== "" && sensitive(p))) return run;
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (i % 2 === 1 || p === "" || !sensitive(p)) { out += p; continue; }
    let group = p, j = i;
    while (j + 2 < parts.length && /^[ 　]+$/.test(parts[j + 1]) && parts[j + 2] !== "" && sensitive(parts[j + 2])) {
      group += parts[j + 1] + parts[j + 2];
      j += 2;
    }
    out += tokenFor(ctx, group);
    i = j;
  }
  return out;
}

function maskEscape(code: string, ctx?: MaskContext): string {
  const m = ESCAPE_PARTS.exec(code);
  if (!m) return code;
  const [, name, open, arg, close] = m;
  const head = hasKeyword(name.slice(1)) ? "\\" + tokenFor(ctx, name.slice(1)) : name;
  return open === undefined ? head : head + open + maskRun(arg, ctx) + close;
}

/** 게임 문자열 하나를 가린다(예외 없음). 같은 글이면 언제나 같은 결과. */
export function maskString(s: string, ctx?: MaskContext): string {
  if (typeof s !== "string" || s === "") return s;
  const cached = ctx?.cache.get(s);
  if (cached && ctx) { ctx.replaced += cached.n; return cached.out; }
  const before = ctx?.replaced ?? 0;
  let out = "";
  try {
    const parts = s.split(SEGMENT);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (i % 2 === 0) out += maskRun(p, ctx);
      else out += p.startsWith("\\") ? maskEscape(p, ctx) : p;
    }
  } catch { out = s; }
  if (ctx && s.length <= 4000) ctx.cache.set(s, { out, n: ctx.replaced - before });
  return out;
}

/** 파일 경로: 폴더 이름과 확장자를 뺀 이름을 같은 규칙으로 가리고, 폴더 구조·확장자는 남긴다. */
export function maskFileName(path: string, ctx?: MaskContext): string {
  if (typeof path !== "string" || path === "") return path;
  const segs = path.split("/");
  return segs.map((seg, i) => {
    if (seg === "" || seg === "." || seg === "..") return seg;
    if (i < segs.length - 1) return maskString(seg, ctx);
    const dot = seg.lastIndexOf(".");
    return dot > 0 ? maskString(seg.slice(0, dot), ctx) + seg.slice(dot) : maskString(seg, ctx);
  }).join("/");
}
