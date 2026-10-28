import type { LoadError, Location, MapInfo, PageEntry } from "@/core/types";

/** 한 이벤트(맵 이벤트·공통 이벤트·전투)의 페이지 묶음 */
export interface EventItem { key: string; title: string; first: Location; pages: PageEntry[] }

/** 찾아보기 화면의 맵 하나. 트리 순서(부모 → 자식)로 펼쳐 놓은 것 */
export interface MapNode {
  info: MapInfo;
  /** 상위 맵 이름(가장 바깥부터) */
  parents: string[];
  events: EventItem[];
  errors: string[];
}

export interface ExplorerTree { maps: MapNode[]; common: EventItem[]; troops: EventItem[] }

export function groupBy(pages: PageEntry[], keyOf: (l: Location) => string | null): EventItem[] {
  const m = new Map<string, EventItem>();
  for (const p of pages) {
    const key = keyOf(p.location);
    if (key === null) continue;
    const g = m.get(key);
    if (g) g.pages.push(p);
    else m.set(key, { key, title: p.title, first: p.location, pages: [p] });
  }
  return [...m.values()];
}

/** 이벤트를 열 때의 첫 페이지 */
export function firstPage(loc: Location): Location {
  return loc.source === "common" ? loc : { ...loc, page: 0 };
}

/**
 * 맵 트리를 깊이 우선 순서로 펼친다. 보이는 이벤트나 오류가 있는 맵만 남긴다.
 * showEmpty가 꺼져 있으면 대사 있는 페이지가 하나도 없는 이벤트는 뺀다.
 */
export function buildExplorerTree(
  pages: PageEntry[], mapInfos: (MapInfo | null)[], errors: LoadError[], showEmpty: boolean,
): ExplorerTree {
  const visible = (it: EventItem) => showEmpty || it.pages.some((p) => p.hasDialogue);
  const mapEvents = new Map<number, EventItem[]>();
  for (const it of groupBy(pages, (l) => (l.source === "map" ? `${l.mapId}:${l.eventId}` : null))) {
    if (it.first.source !== "map" || !visible(it)) continue;
    const list = mapEvents.get(it.first.mapId) ?? [];
    list.push(it);
    mapEvents.set(it.first.mapId, list);
  }
  const infos = mapInfos.filter((m): m is MapInfo => !!m);
  const ids = new Set(infos.map((m) => m.id));
  const children = new Map<number, MapInfo[]>();
  for (const m of infos) {
    const parent = ids.has(m.parentId) && m.parentId !== m.id ? m.parentId : 0;
    const l = children.get(parent) ?? [];
    l.push(m);
    children.set(parent, l);
  }
  for (const l of children.values()) l.sort((a, b) => a.order - b.order || a.id - b.id);
  const errorsByMap = new Map<number, string[]>();
  for (const e of errors) {
    if (e.mapId === undefined) continue;
    const l = errorsByMap.get(e.mapId) ?? [];
    l.push(`${e.file}: ${e.message}`);
    errorsByMap.set(e.mapId, l);
  }

  const maps: MapNode[] = [];
  const seen = new Set<number>();
  const visit = (m: MapInfo, parents: string[]) => {
    if (seen.has(m.id)) return;
    seen.add(m.id);
    const events = mapEvents.get(m.id) ?? [];
    const errs = errorsByMap.get(m.id) ?? [];
    if (events.length > 0 || errs.length > 0) maps.push({ info: m, parents, events, errors: errs });
    for (const c of children.get(m.id) ?? []) visit(c, [...parents, m.name]);
  };
  for (const m of children.get(0) ?? []) visit(m, []);

  const common = groupBy(pages, (l) => (l.source === "common" ? String(l.commonEventId) : null)).filter(visible);
  const troops = groupBy(pages, (l) => (l.source === "troop" ? String(l.troopId) : null)).filter(visible);
  return { maps, common, troops };
}

const has = (s: string, q: string) => s.toLowerCase().includes(q);
const eventMatches = (it: EventItem, q: string) => has(it.title, q) || it.pages.some((p) => has(p.title, q));

/** 이벤트·페이지 제목으로 거른다. 맵 이름이 맞으면 그 맵의 이벤트를 모두 남긴다. */
export function filterExplorerTree(tree: ExplorerTree, query: string): ExplorerTree {
  const q = query.trim().toLowerCase();
  if (!q) return tree;
  const maps = tree.maps.flatMap((m) => {
    if (has(m.info.name, q)) return [m];
    const events = m.events.filter((e) => eventMatches(e, q));
    return events.length === 0 ? [] : [{ ...m, events }];
  });
  return {
    maps,
    common: tree.common.filter((e) => eventMatches(e, q)),
    troops: tree.troops.filter((e) => eventMatches(e, q)),
  };
}
