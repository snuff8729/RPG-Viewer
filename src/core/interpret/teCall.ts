import type { EventCommand, EventPage, GameData, Location, MapEvent } from "../types";

/**
 * TemplateEvent 플러그인(triacontane)의 호출 명령.
 * - 원래 이벤트 호출: MV 356 `TE固有イベント呼び出し [n]` / `TE_CALL_ORIGIN_EVENT [n]`, MZ 357 TemplateEvent CALL_ORIGIN_EVENT.
 * - 맵 이벤트 호출: MV 356 `TEマップイベント呼び出し [n] [id|이름]` / `TE_CALL_MAP_EVENT [n] [id|이름]`, MZ 357 CALL_MAP_EVENT.
 * page: 인자 원문 숫자(1부터, 없거나 숫자가 아니면 null). target: 맵 이벤트 id(숫자) 또는 이름(없으면 null = 실행 중 이벤트).
 */
export type TeCall =
  | { kind: "origin"; page: number | null }
  | { kind: "map"; page: number | null; target: number | string | null };

const ORIGIN_NAMES = new Set(["TE固有イベント呼び出し", "TE_CALL_ORIGIN_EVENT"]);
const MAP_NAMES = new Set(["TEマップイベント呼び出し", "TE_CALL_MAP_EVENT"]);
const MAX_DEPTH = 5;

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object";
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

function pageArg(v: unknown): number | null {
  const s = String(v ?? "").trim();
  return /^-?\d+$/.test(s) ? Number(s) : null;
}
function targetArg(v: unknown): number | string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return /^\d+$/.test(s) ? Number(s) : s;
}

/** 명령이 TemplateEvent 호출이면 그 내용, 아니면 null. 예외를 던지지 않는다. */
export function parseTeCall(cmd: unknown): TeCall | null {
  try {
    if (!isObj(cmd)) return null;
    const p = arr<unknown>(cmd.parameters);
    if (cmd.code === 356) {
      if (typeof p[0] !== "string") return null;
      const args = p[0].trim().split(/[\s　]+/);
      const name = (args[0] ?? "").toUpperCase();
      if (ORIGIN_NAMES.has(name) || ORIGIN_NAMES.has(args[0] ?? "")) return { kind: "origin", page: pageArg(args[1]) };
      if (MAP_NAMES.has(name) || MAP_NAMES.has(args[0] ?? "")) return { kind: "map", page: pageArg(args[1]), target: targetArg(args[2]) };
      return null;
    }
    if (cmd.code === 357) {
      if (p[0] !== "TemplateEvent" || typeof p[1] !== "string") return null;
      const a = isObj(p[3]) ? p[3] : {};
      const name = p[1].toUpperCase();
      if (name === "CALL_ORIGIN_EVENT") return { kind: "origin", page: pageArg(a.pageIndex) };
      if (name === "CALL_MAP_EVENT") return { kind: "map", page: pageArg(a.pageIndex), target: targetArg(a.eventId) };
    }
  } catch {
    /* 아님 */
  }
  return null;
}

/** 호출을 해석할 문맥: 실행 중 맵 이벤트와 그 (템플릿) 페이지. 원래 페이지에서 다시 부를 때도 page는 처음 템플릿 페이지. */
export interface CallCtx { data: GameData; mapId: number; event: MapEvent; page: number }
export interface ResolvedCall {
  list: EventCommand[];
  /** list의 위치(본 대사 키·기록 연결에 쓴다) */
  location: Location;
  /** `원래 이벤트 p2 실행` 같은 표시 글 */
  label: string;
}

/** 엔진 규칙: `pages[n - 1 || 현재 페이지] || pages[0]` (n 없음·1 → 현재 페이지). 페이지가 없으면 -1. */
function pickPage(pages: unknown[], n: number | null, current: number): number {
  const want = (n === null ? NaN : n - 1) || current;
  if (Number.isInteger(want) && want >= 0 && isObj(pages[want])) return want;
  return isObj(pages[0]) ? 0 : -1;
}

/** 호출 명령을 실제로 실행될 목록으로 푼다. 못 찾으면 null. 예외를 던지지 않는다. */
export function resolveTeCall(call: TeCall, ctx: CallCtx): ResolvedCall | null {
  try {
    if (!call || !ctx || !isObj(ctx.event)) return null;
    const ev = ctx.event;
    if (call.kind === "origin") {
      const orig = Array.isArray(ev.originalPages) ? ev.originalPages : null;
      const pages = arr<EventPage | null>(orig ?? ev.pages);
      const i = pickPage(pages, call.page, ctx.page);
      if (i < 0) return null;
      const location: Location = orig
        ? { source: "map", mapId: ctx.mapId, eventId: ev.id, page: ctx.page, origin: i }
        : { source: "map", mapId: ctx.mapId, eventId: ev.id, page: i };
      return { list: arr<EventCommand>(pages[i]!.list), location, label: `원래 이벤트 p${i + 1} 실행` };
    }
    const events = arr<MapEvent | null>(ctx.data?.maps?.get(ctx.mapId)?.events);
    let target: MapEvent | null | undefined;
    if (call.target === null || call.target === 0) target = ev;
    else if (typeof call.target === "number") target = events.find(e => isObj(e) && e.id === call.target);
    else target = events.find(e => isObj(e) && e.name === call.target);
    if (!isObj(target)) return null;
    const pages = arr<EventPage | null>(target.pages);
    const i = pickPage(pages, call.page, ctx.page);
    if (i < 0) return null;
    const name = typeof target.name === "string" && target.name ? target.name : `EV${target.id}`;
    return {
      list: arr<EventCommand>(pages[i]!.list),
      location: { source: "map", mapId: ctx.mapId, eventId: target.id, page: i },
      label: `이벤트 ${name} p${i + 1} 실행`,
    };
  } catch {
    return null;
  }
}

/**
 * list의 명령을 차례로 돌되, TemplateEvent 호출은 불린 목록의 명령으로 바꿔(재귀, 깊이 5, 같은 목록 재진입 금지) 돈다.
 * 호출 명령 자체는 넘기지 않는다(못 푼 호출은 그대로 넘긴다). ctx 없으면 그대로. 예외를 던지지 않는다.
 */
export function flattenCalls(list: unknown, ctx: CallCtx | null): EventCommand[] {
  const out: EventCommand[] = [];
  const go = (l: unknown, stack: unknown[]) => {
    for (const c of arr<EventCommand | null>(l)) {
      if (!isObj(c)) continue;
      const call = ctx ? parseTeCall(c) : null;
      const r = call && ctx && stack.length <= MAX_DEPTH ? resolveTeCall(call, ctx) : null;
      if (r && !stack.includes(r.list)) { go(r.list, [...stack, r.list]); continue; }
      out.push(c);
    }
  };
  try { go(list, [list]); } catch { /* 지금까지 */ }
  return out;
}

export const TE_MAX_DEPTH = MAX_DEPTH;
