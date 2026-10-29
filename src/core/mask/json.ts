// JSON 글(data/*.json, plugins.js, 기록)을 가린다. 문자열 값만 바꾸고 모양(줄·들여쓰기·순서)은 그대로 둔다.
// 문자열이 그 자체로 JSON(MZ 플러그인 매개변수)이면 안으로 들어가 같은 방법으로 가린 뒤 다시 문자열로 싼다.
import { maskString, type MaskContext } from "./text";

const JSON_STRING = /"(?:[^"\\\r\n]|\\.)*"/g;
const MAX_DEPTH = 12;

function maskValueString(v: string, ctx: MaskContext | undefined, depth: number): string {
  const t = v.trim();
  if (depth < MAX_DEPTH && ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]")))) {
    try {
      const parsed: unknown = JSON.parse(v);
      if (parsed !== null && typeof parsed === "object") return maskJsonTextAt(v, ctx, depth + 1);
    } catch { /* JSON이 아니면 그냥 글 */ }
  }
  return maskString(v, ctx);
}

function maskJsonTextAt(text: string, ctx: MaskContext | undefined, depth: number): string {
  return text.replace(JSON_STRING, (lit) => {
    let v: unknown;
    try { v = JSON.parse(lit); } catch { return lit; }
    if (typeof v !== "string") return lit;
    const m = maskValueString(v, ctx, depth);
    return m === v ? lit : JSON.stringify(m);
  });
}

/**
 * JSON(또는 JSON을 담은 JS) 글의 문자열을 가린다. 키도 같은 규칙을 거치지만 ASCII 키(name, note 등)는 그대로다 —
 * 일본어 매개변수 이름처럼 가릴 키만 바뀌고, 그 키를 읽는 플러그인 코드의 문자열과 같은 토큰이 된다. 예외 없음.
 */
export function maskJsonText(text: string, ctx?: MaskContext): string {
  if (typeof text !== "string") return text;
  try { return maskJsonTextAt(text, ctx, 0); } catch { return maskString(text, ctx); }
}

/** js/plugins.js(`var $plugins = [...]`). 플러그인 이름은 파일 이름 규칙과 같은 결과가 된다(확장자 없는 이름 = 같은 maskString). */
export function maskPluginsJs(text: string, ctx?: MaskContext): string {
  return maskJsonText(text, ctx);
}

/** 한 줄에 JSON 하나(log.jsonl). JSON이 아닌 줄은 글로 가린다. */
export function maskJsonLines(text: string, ctx?: MaskContext): string {
  if (typeof text !== "string") return text;
  return text.split("\n").map((line) => {
    const t = line.trim();
    if (t === "") return line;
    if (t.startsWith("{") || t.startsWith("[")) {
      try { JSON.parse(t); return maskJsonText(line, ctx); } catch { /* 아래로 */ }
    }
    return maskString(line, ctx);
  }).join("\n");
}
