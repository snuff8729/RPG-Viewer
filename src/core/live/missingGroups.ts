import { locationKey } from "../index/locations";
import type { GameData, GameIndex, MapEvent, PageEntry } from "../types";
import { activePageIndex } from "./interactable";
import type { LiveSnapshot, MissingItem } from "./types";

export type MissingView = "now" | "reachable" | "all";

export interface MissingEventGroup {
  /** locationKey(entry.location) */
  key: string;
  entry: PageEntry;
  /** 맵 이벤트: 이 페이지가 지금 그 이벤트의 현재 페이지인지(live 없으면 null). 공통/전투: null */
  active: boolean | null;
  items: MissingItem[];
  choiceCount: number; pageCount: number;
  /** active !== false && 항목 중 unmet 요구 조건이 없는 것이 하나라도 있음 */
  reachable: boolean;
}

export interface MissingGroup {
  /** "map:{id}" | "common" | "troop" */
  key: string;
  kind: "map" | "common" | "troop";
  mapId?: number; name: string; current: boolean;
  events: MissingEventGroup[];
  choiceCount: number; pageCount: number; reachableEvents: number;
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object";

/** index → (페이지 항목 → index.pages 순서) */
const orderCache = new WeakMap<object, Map<PageEntry, number>>();
function pageOrder(index: GameIndex): Map<PageEntry, number> {
  const hit = isObj(index) ? orderCache.get(index) : undefined;
  if (hit) return hit;
  const m = new Map<PageEntry, number>();
  arr<PageEntry | null>(index?.pages).forEach((p, i) => { if (isObj(p)) m.set(p, i); });
  if (isObj(index)) orderCache.set(index, m);
  return m;
}

/**
 * 못 본 것 항목을 맵(→ 공통 이벤트 → 전투) → 이벤트 페이지로 묶는다.
 * 현재 페이지는 이벤트당 한 번만 구한다(현재 맵: live.events, 다른 맵: activePageIndex). 예외를 던지지 않는다.
 */
export function groupMissing(items: MissingItem[], data: GameData, index: GameIndex, live: LiveSnapshot | null): MissingGroup[] {
  try {
    const order = pageOrder(index);
    const livePages = new Map<number, number>();
    if (live) {
      for (const e of arr<{ eventId: number; page: number } | null>(live.events)) {
        if (isObj(e) && typeof e.eventId === "number" && typeof e.page === "number") livePages.set(e.eventId, e.page);
      }
    }
    const currentPage = new Map<string, number>();   // "mapId:eventId" → 현재 페이지(-1 = 없음)
    const curPageOf = (mapId: number, eventId: number): number => {
      const k = `${mapId}:${eventId}`;
      const hit = currentPage.get(k);
      if (hit !== undefined) return hit;
      let p = -1;
      try {
        if (live && live.mapId === mapId) p = livePages.get(eventId) ?? -1;
        else {
          const ev = arr<MapEvent | null>(data?.maps?.get(mapId)?.events)[eventId];
          p = isObj(ev) ? activePageIndex(ev, mapId, data, live) : -1;
        }
      } catch { p = -1; }
      currentPage.set(k, p);
      return p;
    };

    const groups = new Map<string, MissingGroup>();
    const events = new Map<string, MissingEventGroup>();
    for (const it of arr<MissingItem | null>(items)) {
      try {
        if (!isObj(it) || !isObj(it.entry) || !isObj(it.entry.location)) continue;
        const loc = it.entry.location;
        const ekey = locationKey(loc);
        let eg = events.get(ekey);
        if (!eg) {
          let gkey: string, kind: MissingGroup["kind"], name: string, mapId: number | undefined;
          let active: boolean | null = null;
          if (loc.source === "map") {
            mapId = loc.mapId; gkey = `map:${mapId}`; kind = "map";
            name = String(arr<{ name?: unknown } | null>(data?.mapInfos)[mapId]?.name ?? `맵 ${mapId}`);
            if (live) active = curPageOf(loc.mapId, loc.eventId) === loc.page;
          } else if (loc.source === "common") {
            gkey = "common"; kind = "common"; name = "공통 이벤트";
          } else {
            gkey = "troop"; kind = "troop"; name = "전투";
          }
          let g = groups.get(gkey);
          if (!g) {
            g = { key: gkey, kind, name, current: kind === "map" && !!live && live.mapId === mapId,
              events: [], choiceCount: 0, pageCount: 0, reachableEvents: 0 };
            if (mapId !== undefined) g.mapId = mapId;
            groups.set(gkey, g);
          }
          eg = { key: ekey, entry: it.entry, active, items: [], choiceCount: 0, pageCount: 0, reachable: false };
          events.set(ekey, eg);
          g.events.push(eg);
        }
        eg.items.push(it);
        if (it.kind === "choice") eg.choiceCount++; else eg.pageCount++;
        if (eg.active !== false && !eg.reachable && !arr<{ status: string } | null>(it.requirements).some(r => r?.status === "unmet")) {
          eg.reachable = true;
        }
      } catch {
        /* 이상한 항목은 건너뛴다 */
      }
    }

    const mapOrder = (id: number | undefined) => {
      const o = arr<{ order?: unknown } | null>(data?.mapInfos)[id ?? -1]?.order;
      return typeof o === "number" ? o : Number.MAX_SAFE_INTEGER;
    };
    const ord = (e: MissingEventGroup) => order.get(e.entry) ?? Number.MAX_SAFE_INTEGER;
    const out = [...groups.values()];
    for (const g of out) {
      g.events.sort((a, b) => Number(b.reachable) - Number(a.reachable) || ord(a) - ord(b));
      for (const e of g.events) {
        g.choiceCount += e.choiceCount; g.pageCount += e.pageCount;
        if (e.reachable) g.reachableEvents++;
      }
    }
    const kindRank = { map: 0, common: 1, troop: 2 } as const;
    out.sort((a, b) =>
      kindRank[a.kind] - kindRank[b.kind]
      || Number(b.current) - Number(a.current)
      || b.reachableEvents - a.reachableEvents
      || mapOrder(a.mapId) - mapOrder(b.mapId)
      || (a.mapId ?? 0) - (b.mapId ?? 0));
    return out;
  } catch {
    return [];
  }
}

const includes = (s: unknown, q: string) => String(s ?? "").toLowerCase().includes(q);

/** 보기·검색어로 거른다. 예외를 던지지 않는다. */
export function viewGroups(groups: MissingGroup[], view: MissingView, query: string): MissingGroup[] {
  try {
    let gs = arr<MissingGroup>(groups);
    if (view === "now") gs = gs.filter(g => g.current);
    else if (view === "reachable") {
      // 공통 이벤트·전투는 조건 판정이 불완전하므로 뺀다
      gs = gs.filter(g => g.kind === "map").flatMap(g => {
        const events = g.events.filter(e => e.reachable);
        return events.length === 0 ? [] : [events.length === g.events.length ? g : { ...g, events }];
      });
    }
    const q = String(query ?? "").trim().toLowerCase();
    if (!q) return gs;
    return gs.flatMap(g => {
      if (includes(g.name, q)) return [g];
      const events = g.events.filter(e => includes(e.entry?.title, q) || includes(e.entry?.path, q));
      return events.length === 0 ? [] : [{ ...g, events }];
    });
  } catch {
    return [];
  }
}

/** "갈 수 있는 것" 보기의 이벤트 그룹 수(맵 이벤트만). */
export function reachableCount(groups: MissingGroup[]): number {
  return viewGroups(groups, "reachable", "").reduce((s, g) => s + g.events.length, 0);
}
