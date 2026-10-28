// 맵 사이 이동 그래프(장소 이동 201 — TemplateEvent 호출·공통 이벤트 안 포함)와 맵에서 맵으로 가는 길. 예외를 던지지 않는다.
import { testToReq, type Req } from "../deps/graph";
import { evaluate } from "../live/evaluate";
import { commonEventCallCount, MANY_CALLERS } from "../live/mapScan";
import type { LiveSnapshot } from "../live/types";
import { flattenCalls, type CallCtx } from "../interpret/teCall";
import type { ConditionTest, EventCommand, GameData, MapEvent, PageConditions } from "../types";

/** from 맵의 이벤트(eventId·page)가 to 맵으로 옮겨 준다. reqs: 그 페이지의 출현 조건 */
export interface TransferEdge { from: number; to: number; eventId: number; page: number; x: number; y: number; trigger: number; reqs: Req[] }
export interface TransferGraph { edges: Map<number, TransferEdge[]> }
/**
 * 맵에서 맵으로 가는 길. maps: 출발 맵부터 도착 맵까지(같은 맵이면 하나), firstExit: 출발 맵에서 쓸 출구 이벤트(같은 맵이면 null),
 * locked: 지금 조건으로는 막힌 출구를 지나야 한다(그래도 이어지는 길이라 보여 준다)
 */
export interface MapPath {
  maps: number[]; names: string[];
  firstExit: { eventId: number; page: number; x: number; y: number } | null;
  locked: boolean;
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object";
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const CE_DEPTH = 2;

function pageReqs(c: PageConditions | null | undefined, self: { mapId: number; eventId: number }): Req[] {
  if (!isObj(c)) return [];
  const tests: ConditionTest[] = [];
  if (c.switch1Valid) tests.push({ kind: "switch", id: num(c.switch1Id), on: true });
  if (c.switch2Valid) tests.push({ kind: "switch", id: num(c.switch2Id), on: true });
  if (c.variableValid) tests.push({ kind: "variable", id: num(c.variableId), op: ">=", value: num(c.variableValue) });
  if (c.selfSwitchValid) tests.push({ kind: "selfSwitch", letter: String(c.selfSwitchCh), on: true });
  if (c.itemValid) tests.push({ kind: "item", id: num(c.itemId) });
  if (c.actorValid) tests.push({ kind: "actorInParty", id: num(c.actorId) });
  return tests.map(t => testToReq(t, self)).filter((r): r is Req => r !== null);
}

/** 목록(TemplateEvent 호출·공통 이벤트 깊이 2까지)이 옮겨 주는 맵들(직접 지정만) */
function destinations(list: unknown, ctx: CallCtx | null, data: GameData): Set<number> {
  const out = new Set<number>();
  const go = (l: unknown, cx: CallCtx | null, depth: number, stack: number[]) => {
    for (const c of flattenCalls(l, cx)) {
      if (!isObj(c)) continue;
      const p = arr<unknown>((c as EventCommand).parameters);
      if (c.code === 201 && num(p[0]) === 0) out.add(num(p[1]));
      else if (c.code === 117 && depth < CE_DEPTH) {
        const id = num(p[0]);
        if (stack.includes(id) || commonEventCallCount(data, id) >= MANY_CALLERS) continue;
        const ce = arr<{ list?: unknown } | null>(data.commonEvents)[id];
        if (isObj(ce)) go(ce.list, null, depth + 1, [...stack, id]);
      }
    }
  };
  try { go(list, ctx, 0, []); } catch { /* 지금까지 */ }
  return out;
}

const graphCache = new WeakMap<GameData, TransferGraph>();

/** 맵 이동 그래프. 데이터마다 한 번 만든다(템플릿 맵 제외). */
export function transferGraph(data: GameData): TransferGraph {
  const hit = graphCache.get(data);
  if (hit) return hit;
  const g: TransferGraph = { edges: new Map() };
  try {
    if (data.maps instanceof Map) {
      for (const [mapId, m] of data.maps) {
        if (mapId === data.templateMapId || !isObj(m)) continue;
        const list: TransferEdge[] = [];
        for (const ev of arr<MapEvent | null>(m.events)) {
          if (!isObj(ev) || typeof ev.id !== "number") continue;
          arr<MapEvent["pages"][number] | null>(ev.pages).forEach((pg, pi) => {
            if (!isObj(pg)) return;
            const self = { mapId, eventId: ev.id };
            const dests = destinations(pg.list, { data, mapId, event: ev, page: pi }, data);
            if (dests.size === 0) return;
            const reqs = pageReqs(pg.conditions, self);
            for (const to of dests) {
              if (to === mapId || to <= 0) continue;
              list.push({ from: mapId, to, eventId: ev.id, page: pi, x: num(ev.x), y: num(ev.y), trigger: num(pg.trigger), reqs });
            }
          });
        }
        if (list.length) g.edges.set(mapId, list);
      }
    }
  } catch { /* 지금까지 */ }
  graphCache.set(data, g);
  return g;
}

/** 출구가 지금 열려 있는가: 출현 조건이 모두 맞고, 지금 맵이면 그 페이지가 지금 활성 페이지 */
function edgeOpen(e: TransferEdge, live: LiveSnapshot): boolean {
  if (live.mapId === e.from && Array.isArray(live.events)) {
    const hit = live.events.find(x => isObj(x) && x.eventId === e.eventId);
    if (hit) return hit.page === e.page;
  }
  return e.reqs.every(r => {
    const a = r.atom;
    return evaluate(r.test, live, a.kind === "selfSwitch" ? { mapId: a.mapId, eventId: a.eventId } : {}) === "met";
  });
}

function mapNameOf(data: GameData, id: number): string {
  const info = arr<{ name?: string } | null>(data.mapInfos)[id];
  return (isObj(info) && info.name) || data.maps?.get(id)?.displayName || `맵 ${id}`;
}

function bfs(g: TransferGraph, from: number, to: number, ok: (e: TransferEdge) => boolean): TransferEdge[] | null {
  const prev = new Map<number, TransferEdge | null>([[from, null]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (cur === to) break;
    for (const e of g.edges.get(cur) ?? []) {
      if (prev.has(e.to) || !ok(e)) continue;
      prev.set(e.to, e);
      queue.push(e.to);
    }
  }
  if (!prev.has(to)) return null;
  const path: TransferEdge[] = [];
  for (let e = prev.get(to); e; e = prev.get(e.from)) path.push(e);
  return path.reverse();
}

const LOCKED_COST = 1000;

/** 닫힌 출구를 가장 적게, 그다음 가장 짧게 지나는 길(Dijkstra, 맵 수가 적어 선형 탐색) */
function fewestLocked(g: TransferGraph, from: number, to: number, open: (e: TransferEdge) => boolean): TransferEdge[] | null {
  const dist = new Map<number, number>([[from, 0]]);
  const prev = new Map<number, TransferEdge>();
  const done = new Set<number>();
  const frontier = new Set<number>([from]);
  while (frontier.size) {
    let cur = -1, best = Infinity;
    for (const n of frontier) { const d = dist.get(n)!; if (d < best) { best = d; cur = n; } }
    frontier.delete(cur);
    done.add(cur);
    if (cur === to) break;
    for (const e of g.edges.get(cur) ?? []) {
      if (done.has(e.to)) continue;
      const nd = best + (open(e) ? 1 : LOCKED_COST);
      if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, e); frontier.add(e.to); }
    }
  }
  if (!prev.has(to)) return null;
  const path: TransferEdge[] = [];
  for (let e = prev.get(to); e; e = e.from === from ? undefined : prev.get(e.from)) path.push(e);
  return path.reverse();
}

/**
 * from 맵에서 to 맵으로 가는 가장 짧은 길: 지금 열린 출구만으로 먼저, 없으면 닫힌 출구도 써서(locked).
 * 이어지지 않으면 null. 예외를 던지지 않는다.
 */
export function mapPath(data: GameData, live: LiveSnapshot, from: number, to: number): MapPath | null {
  try {
    if (from === to) return { maps: [from], names: [mapNameOf(data, from)], firstExit: null, locked: false };
    const g = transferGraph(data);
    let locked = false;
    let path = bfs(g, from, to, e => edgeOpen(e, live));
    if (!path) { path = fewestLocked(g, from, to, e => edgeOpen(e, live)); locked = true; }
    if (!path || path.length === 0) return null;
    const maps = [from, ...path.map(e => e.to)];
    const f = path[0];
    return { maps, names: maps.map(m => mapNameOf(data, m)), firstExit: { eventId: f.eventId, page: f.page, x: f.x, y: f.y }, locked };
  } catch {
    return null;
  }
}
