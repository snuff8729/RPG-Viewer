import type { ReaderItem } from "./reader";
import type { HideRule, HideRuleInput } from "./readerFile";

/**
 * 읽기 화면의 숨김 규칙 맞추기(core/live/readerFile의 HideRule). 숨김은 보기만 바꾸고 기록은 건드리지 않는다.
 * - exact: 공백을 정리한 글이 완전히 같은 줄
 * - digits: 숫자 덩어리를 #으로 바꾼 글이 같은 줄(`골드 120 획득` ↔ `골드 35 획득`)
 * - type: 줄 종류(lineTypesOf). 대사·스크롤 글에는 종류가 없다(이야기 글이 통째로 사라지지 않게).
 * 모든 함수는 예외를 던지지 않는다.
 */

/** 공백 덩어리를 한 칸으로, 앞뒤 공백 없이 */
export const normalizeLine = (s: string): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

/** 숫자 덩어리(반각·전각)를 #으로 */
export const digitsPattern = (s: string): string => normalizeLine(s).replace(/[0-9０-９]+(?:[.,][0-9０-９]+)*/g, "#");

/** 숨김 글 규칙을 걸 수 있는 줄의 글(대사·스크롤 글·알림·전투 로그·플러그인 명령). 없으면 null. */
export function lineTextOf(item: ReaderItem): string | null {
  try {
    switch (item.kind) {
      case "message": case "scroll": return item.lines.join("\n");
      case "notice": return item.text;
      case "battlelog": return item.text;
      case "plugin": return item.tech ? item.raw : item.text;
      default: return null;
    }
  } catch {
    return null;
  }
}

/** 줄 종류(`이 종류 모두 숨기기`): 앞의 것일수록 좁은 종류 */
export function lineTypesOf(item: ReaderItem): string[] {
  try {
    switch (item.kind) {
      case "plugin": {
        const out: string[] = [];
        if (item.name) out.push(`plugin:${item.name}`);
        if (item.tech) out.push("plugin-tech");
        return out;
      }
      case "notice": return [`notice-kind:${item.noticeKind}`, `notice-source:${item.source}`, "notice"];
      case "battle": return ["battle"];
      case "battlelog": return ["battlelog"];
      default: return [];
    }
  } catch {
    return [];
  }
}

/** 줄의 정리한 글·숫자 무늬(항목 객체마다 한 번 — 이어 만들 때 앞 항목은 같은 객체라 다시 만들지 않는다) */
const textCache = new WeakMap<ReaderItem, { exact: string; digits: string } | null>();

export function lineKeysOf(item: ReaderItem): { exact: string; digits: string } | null {
  try {
    const hit = textCache.get(item);
    if (hit !== undefined) return hit;
    const text = lineTextOf(item);
    const exact = text === null ? "" : normalizeLine(text);
    const v = exact === "" ? null : { exact, digits: digitsPattern(text ?? "") };
    textCache.set(item, v);
    return v;
  } catch {
    return null;
  }
}

/** 맞추기 쉽게 바꾼 규칙들. 같은 규칙 목록이면 같은 객체를 쓰면 이어 계산이 이어진다. */
export interface CompiledHide {
  rules: readonly HideRule[];
  exact: Map<string, number>;
  digits: Map<string, number>;
  types: Map<string, number>;
}

export const NO_HIDE: CompiledHide = { rules: [], exact: new Map(), digits: new Map(), types: new Map() };

export function compileHideRules(rules: readonly HideRule[] | null | undefined): CompiledHide {
  const c: CompiledHide = { rules: Array.isArray(rules) ? rules : [], exact: new Map(), digits: new Map(), types: new Map() };
  try {
    c.rules.forEach((r, i) => {
      if (!r) return;
      const m = r.kind === "exact" ? c.exact : r.kind === "digits" ? c.digits : r.kind === "type" ? c.types : null;
      const key = r.kind === "exact" ? normalizeLine(r.text) : r.kind === "digits" ? r.pattern : r.kind === "type" ? r.type : "";
      if (m && key && !m.has(key)) m.set(key, i);
    });
  } catch { /* 맞춘 것까지 */ }
  return c;
}

/** 줄을 숨기는 규칙 번호(여럿이면 목록에서 앞의 것), 없으면 -1 */
export function matchHide(item: ReaderItem, c: CompiledHide): number {
  try {
    if (!item || c.rules.length === 0) return -1;
    let best = -1;
    const take = (i: number | undefined) => { if (i !== undefined && (best < 0 || i < best)) best = i; };
    if (c.types.size > 0) for (const t of lineTypesOf(item)) take(c.types.get(t));
    if (c.exact.size > 0 || c.digits.size > 0) {
      const k = lineKeysOf(item);
      if (k) { take(c.exact.get(k.exact)); take(c.digits.get(k.digits)); }
    }
    return best;
  } catch {
    return -1;
  }
}

/** 줄 메뉴에서 고를 수 있는 숨김(규칙 모양과 메뉴 글) */
export interface HideChoice { rule: HideRuleInput; label: string }

/** 줄 하나에 걸 수 있는 숨김들: 이 문장 / 숫자만 다른 문장(숫자가 있을 때만) / 이 종류(대사·스크롤 글 제외) */
export function hideChoicesOf(item: ReaderItem, typeLabel: (type: string) => string): HideChoice[] {
  const out: HideChoice[] = [];
  try {
    const k = lineKeysOf(item);
    if (k) {
      out.push({ rule: { kind: "exact", text: k.exact }, label: "이 문장 숨기기" });
      if (k.digits !== k.exact) out.push({ rule: { kind: "digits", pattern: k.digits }, label: "숫자만 다른 문장도 숨기기" });
    }
    for (const type of lineTypesOf(item)) out.push({ rule: { kind: "type", type }, label: `${typeLabel(type)} 모두 숨기기` });
  } catch { /* 고른 것까지 */ }
  return out;
}

/** 규칙마다 숨긴 줄 수(ruleOf: 항목마다 숨긴 규칙 번호, -1 = 보임) */
export function countByRule(ruleOf: readonly number[], n: number): number[] {
  const out = new Array<number>(Math.max(0, n)).fill(0);
  for (const r of ruleOf) if (r >= 0 && r < out.length) out[r]++;
  return out;
}
