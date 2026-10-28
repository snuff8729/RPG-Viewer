// 맵 이벤트를 데이터만으로 살핀다: 장소 이동(출구), 이 맵으로 들어오는 곳, 다른 이벤트가 부르는지. 예외를 던지지 않는다.
import { flattenCalls, parseTeCall, type CallCtx } from "../interpret/teCall";
import type { EventCommand, GameData, MapEvent } from "../types";
import { baseData } from "./spawned";

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object";
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** 게임 전체에서 이만큼 이상 불리는 공통 이벤트는 시스템 처리기(시작·끝·이동 전후 등)로 보고 출구 찾기에서 건너뛴다. */
export const MANY_CALLERS = 15;
/** 공통 이벤트를 따라 들어가는 깊이 */
const CE_DEPTH = 2;

interface GameScan {
  /** 공통 이벤트 id → 게임 전체 호출(117) 수 */
  ceCalls: Map<number, number>;
  /** 맵 id → 그 맵으로 바로 옮겨 오는 장소 이동(201, 직접 지정)의 도착 칸 */
  entries: Map<number, { x: number; y: number }[]>;
}
const scanCache = new WeakMap<GameData, GameScan>();

/** 게임의 모든 명령 목록(맵 이벤트 페이지·원래 페이지, 공통 이벤트, 적 그룹 페이지). */
function* allLists(data: GameData): Generator<unknown> {
  if (data.maps instanceof Map) {
    for (const map of data.maps.values()) {
      for (const ev of arr<MapEvent | null>(map?.events)) {
        if (!isObj(ev)) continue;
        for (const pg of arr<{ list?: unknown } | null>(ev.pages)) if (isObj(pg)) yield pg.list;
        for (const pg of arr<{ list?: unknown } | null>(ev.originalPages)) if (isObj(pg)) yield pg.list;
      }
    }
  }
  for (const ce of arr<{ list?: unknown } | null>(data.commonEvents)) if (isObj(ce)) yield ce.list;
  for (const tr of arr<{ pages?: unknown } | null>(data.troops)) {
    if (isObj(tr)) for (const pg of arr<{ list?: unknown } | null>(tr.pages)) if (isObj(pg)) yield pg.list;
  }
}

function gameScan(given: GameData): GameScan {
  // 생성 이벤트를 넣은 데이터(withSpawnedEvents)도 원래 데이터로 한 번만 훑는다
  const data = baseData(given);
  const hit = scanCache.get(data);
  if (hit) return hit;
  const scan: GameScan = { ceCalls: new Map(), entries: new Map() };
  try {
    for (const list of allLists(data)) {
      for (const c of arr<EventCommand | null>(list)) {
        if (!isObj(c)) continue;
        const p = arr<unknown>(c.parameters);
        if (c.code === 117) { const id = num(p[0]); scan.ceCalls.set(id, (scan.ceCalls.get(id) ?? 0) + 1); }
        else if (c.code === 201 && num(p[0]) === 0) {
          const m = num(p[1]);
          const list2 = scan.entries.get(m) ?? [];
          list2.push({ x: num(p[2]), y: num(p[3]) });
          scan.entries.set(m, list2);
        }
      }
    }
  } catch { /* 지금까지 */ }
  scanCache.set(data, scan);
  return scan;
}

/** 공통 이벤트가 게임 전체에서 불리는 곳 수. */
export function commonEventCallCount(data: GameData, id: number): number {
  try { return gameScan(data).ceCalls.get(id) ?? 0; } catch { return 0; }
}

/** 이 맵으로 바로 옮겨 오는 장소 이동의 도착 칸들과 새 게임 시작 칸(이 맵이면). */
export function entryPoints(data: GameData, mapId: number): { x: number; y: number }[] {
  try {
    const out = [...(gameScan(data).entries.get(mapId) ?? [])];
    const sys = data.system as unknown as Record<string, unknown> | undefined;
    if (isObj(sys) && sys.startMapId === mapId) out.push({ x: num(sys.startX), y: num(sys.startY) });
    return out;
  } catch {
    return [];
  }
}

/** 장소 이동 대상. mapId null = 변수로 지정(어디인지 데이터로는 모름) */
export interface TransferTarget { mapId: number | null }

/**
 * 명령 목록이 장소 이동(201)을 하는가: 목록 안, TemplateEvent 호출로 불린 목록, 공통 이벤트(117, 깊이 2까지,
 * 게임 전체에서 MANY_CALLERS 곳 이상 불리는 공통 이벤트는 건너뜀). 처음 찾은 이동, 없으면 null.
 */
export function findTransfer(list: unknown, ctx: CallCtx | null, data: GameData): TransferTarget | null {
  const go = (l: unknown, cx: CallCtx | null, depth: number, stack: number[]): TransferTarget | null => {
    for (const c of flattenCalls(l, cx)) {
      if (!isObj(c)) continue;
      const p = arr<unknown>(c.parameters);
      if (c.code === 201) return { mapId: num(p[0]) === 0 ? num(p[1]) : null };
      if (c.code === 117 && depth < CE_DEPTH) {
        const id = num(p[0]);
        if (stack.includes(id) || commonEventCallCount(data, id) >= MANY_CALLERS) continue;
        const ce = arr<{ list?: unknown } | null>(data.commonEvents)[id];
        if (!isObj(ce)) continue;
        const r = go(ce.list, null, depth + 1, [...stack, id]);
        if (r) return r;
      }
    }
    return null;
  };
  try { return go(list, ctx, 0, []); } catch { return null; }
}

/** 문자열 안에 word가 낱말로(앞뒤가 글자·숫자·_가 아님)있는가 */
function hasWord(text: string, word: string): boolean {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${esc}($|[^\\p{L}\\p{N}_])`, "u").test(text);
}

/** 명령이 맵 이벤트 target(id·이름)을 부르거나 가리키는가: TemplateEvent 맵 이벤트 호출, 스크립트·플러그인 글의 `event(id)`·이름. */
function refersTo(c: EventCommand, target: MapEvent): boolean {
  const call = parseTeCall(c);
  const name = typeof target.name === "string" ? target.name.trim() : "";
  if (call) return call.kind === "map" && (call.target === target.id || (name !== "" && call.target === name));
  const p = arr<unknown>(c.parameters);
  let text = "";
  if (c.code === 355 || c.code === 655 || c.code === 356) text = typeof p[0] === "string" ? p[0] : "";
  else if (c.code === 357) { try { text = JSON.stringify(p); } catch { text = ""; } }
  if (!text) return false;
  if (new RegExp(`\\bevent\\(\\s*${target.id}\\s*\\)`).test(text)) return true;
  if (name.length < 2) return false;
  // 스크립트는 따옴표 안 이름, 플러그인 명령은 이벤트를 말하는 명령(event·イベント·이벤트)의 낱말 이름만(조사 글 속 우연한 낱말 제외)
  if (c.code === 355 || c.code === 655) return text.includes(`"${name}"`) || text.includes(`'${name}'`);
  return /event|イベント|이벤트/i.test(text) && hasWord(text, name);
}

/**
 * 이 맵의 다른 이벤트(와 그 이벤트가 부르는 공통 이벤트)가 ev를 부르거나 가리키면 그 이름(이벤트 이름, 없으면 `EV#`,
 * 공통 이벤트면 그 이름). 없으면 null.
 */
export function calledBy(data: GameData, mapId: number, ev: MapEvent): string | null {
  try {
    const map = data.maps?.get(mapId);
    const ces = new Map<number, string>();
    for (const other of arr<MapEvent | null>(map?.events)) {
      if (!isObj(other) || other.id === ev.id) continue;
      const otherName = typeof other.name === "string" && other.name ? other.name : `EV${other.id}`;
      for (const pg of [...arr<{ list?: unknown } | null>(other.pages), ...arr<{ list?: unknown } | null>(other.originalPages)]) {
        if (!isObj(pg)) continue;
        for (const c of arr<EventCommand | null>(pg.list)) {
          if (!isObj(c)) continue;
          if (refersTo(c, ev)) return otherName;
          if (c.code === 117) {
            const id = num(arr<unknown>(c.parameters)[0]);
            if (commonEventCallCount(data, id) < MANY_CALLERS) ces.set(id, otherName);
          }
        }
      }
    }
    for (const id of ces.keys()) {
      const ce = arr<{ name?: unknown; list?: unknown } | null>(data.commonEvents)[id];
      if (!isObj(ce)) continue;
      if (arr<EventCommand | null>(ce.list).some(c => isObj(c) && refersTo(c, ev))) {
        return typeof ce.name === "string" && ce.name ? ce.name : `공통 이벤트 ${id}`;
      }
    }
  } catch { /* 없음 */ }
  return null;
}
