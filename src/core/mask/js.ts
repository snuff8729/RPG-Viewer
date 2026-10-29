// 플러그인 JS(js/plugins/*.js)를 가린다: 주석·문자열·템플릿·정규식 안의 글과, 가릴 글자가 든 식별자만 바꾸고
// 나머지 코드는 그대로. 줄 수는 원본과 똑같이 맞춘다(에이전트가 줄 번호로 가리킬 수 있게).
// 문법을 못 읽으면 파일 전체를 줄 단위로 가린다(이때도 줄 수는 같다).
import { tokenizer, tokTypes as tt, type Options } from "acorn";
import { defaultSensitive, maskString, tokenFor, type MaskContext } from "./text";

const LINE_BREAK = /\r\n?|\n|\u2028|\u2029/g;
export const countLines = (s: string): number => (s.match(LINE_BREAK)?.length ?? 0) + 1;

function escapeString(s: string, q: string): string {
  return s.replace(/[\\\n\r\u2028\u2029'"]/g, (c) => {
    if (c === "\\") return "\\\\";
    if (c === "\n") return "\\n";
    if (c === "\r") return "\\r";
    if (c === "\u2028") return "\\u2028";
    if (c === "\u2029") return "\\u2029";
    return c === q ? "\\" + c : c;
  });
}

function escapeTemplate(s: string): string {
  return s.replace(/\\|`|\$\{|\n|\r/g, (c) => (c === "\n" ? "\\n" : c === "\r" ? "\\r" : "\\" + c));
}

/** 식별자는 통째로 한 토큰(문자열 속 같은 낱말과 같은 토큰) */
function sensitiveName(name: string, ctx?: MaskContext): string | null {
  return defaultSensitive(name) ? tokenFor(ctx, name) : null;
}

/** 줄 단위 가리기(문법을 못 읽을 때). 줄바꿈은 낱말 구분자라 줄 수가 그대로다. */
export function maskJsLines(src: string, ctx?: MaskContext): string {
  return maskString(src, ctx);
}

export interface JsMaskResult { text: string; fallback: boolean }

/** 플러그인 JS 본문을 가린다(예외 없음). */
export function maskJsSource(src: string, ctx?: MaskContext): JsMaskResult {
  if (typeof src !== "string" || src === "") return { text: src, fallback: false };
  const before = ctx ? { replaced: ctx.replaced } : null;
  const edits: [number, number, string][] = [];
  try {
    const opts: Options = {
      ecmaVersion: "latest", sourceType: "script", allowHashBang: true, allowReturnOutsideFunction: true,
      allowImportExportEverywhere: true, allowAwaitOutsideFunction: true, allowReserved: true,
      onComment: (block, text, start, end) => {
        const m = maskString(text, ctx);
        if (m !== text) edits.push([start + 2, block ? end - 2 : end, m]);
      },
    };
    for (const tok of tokenizer(src, opts)) {
      const raw = src.slice(tok.start, tok.end);
      const value: unknown = (tok as unknown as { value?: unknown }).value;
      if (tok.type === tt.string && typeof value === "string") {
        const m = maskString(value, ctx);
        if (m === value) continue;
        const q = raw[0] === "'" ? "'" : '"';
        const breaks = raw.match(LINE_BREAK)?.length ?? 0;
        edits.push([tok.start, tok.end, q + escapeString(m, q) + (raw.includes("\r\n") ? "\\\r\n" : "\\\n").repeat(breaks) + q]);
      } else if (tok.type === tt.template || tok.type === tt.invalidTemplate) {
        if (typeof value !== "string") {
          const m = maskString(raw, ctx);
          if (m !== raw) edits.push([tok.start, tok.end, m]);
          continue;
        }
        const m = maskString(value, ctx);
        if (m === value) continue;
        const breaks = raw.match(LINE_BREAK)?.length ?? 0;
        edits.push([tok.start, tok.end, escapeTemplate(m) + (raw.includes("\r\n") ? "\r\n" : "\n").repeat(breaks)]);
      } else if (tok.type === tt.regexp) {
        const close = raw.lastIndexOf("/");
        if (close <= 0) continue;
        const body = raw.slice(1, close), m = maskString(body, ctx);
        if (m !== body) edits.push([tok.start, tok.end, "/" + m + raw.slice(close)]);
      } else if ((tok.type === tt.name || tok.type === tt.privateId) && typeof value === "string") {
        const t = sensitiveName(value, ctx);
        if (t !== null) edits.push([tok.start, tok.end, (raw.startsWith("#") ? "#" : "") + t]);
      }
    }
    edits.sort((a, b) => a[0] - b[0]);
    const pieces: string[] = [];
    let at = 0;
    for (const [s, e, r] of edits) {
      if (s < at) continue;
      pieces.push(src.slice(at, s), r);
      at = e;
    }
    pieces.push(src.slice(at));
    const out = pieces.join("");
    if (countLines(out) === countLines(src)) return { text: out, fallback: false };
  } catch { /* 줄 단위로 */ }
  if (ctx && before) ctx.replaced = before.replaced;
  if (ctx) ctx.jsFallbacks++;
  return { text: maskJsLines(src, ctx), fallback: true };
}
