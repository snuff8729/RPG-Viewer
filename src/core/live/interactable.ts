import { describePageConditions } from "../conditions/describe";
import { locationKey } from "../index/locations";
import type { Condition, GameData, GameIndex, Location, MapEvent, PageEntry, ScriptNode } from "../types";
import { pickKey, seenKey } from "./coverage";
import { evaluate } from "./evaluate";
import type { Coverage, LiveSnapshot } from "./types";
import { baseData } from "./spawned";

export interface Interactable {
  eventId: number; page: number; title: string; location: Location;
  mark: "talk" | "auto" | "none";
  unseen: number; unpicked: number; isNew: boolean;
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object";

// ── 캐시: 색인·데이터·커버리지는 바뀔 때 새 객체가 되므로 객체 자체를 키로 쓴다 ──
/** index → 위치 키별 페이지 */
const entriesCache = new WeakMap<object, Map<string, PageEntry>>();
/** data → (페이지 객체 → 출현 조건) */
const condCache = new WeakMap<object, WeakMap<object, Condition[]>>();
/** coverage → (페이지 항목 → 새것 수) */
const countCache = new WeakMap<object, WeakMap<object, NewCounts>>();

function pageConditions(pg: { conditions: any; trigger: any }, data: GameData): Condition[] {
  const base = baseData(data);
  let byPage = isObj(base) ? condCache.get(base) : undefined;
  if (!byPage && isObj(base)) { byPage = new WeakMap(); condCache.set(base, byPage); }
  const hit = byPage?.get(pg);
  if (hit) return hit;
  const conds = describePageConditions(pg.conditions, pg.trigger, data);
  byPage?.set(pg, conds);
  return conds;
}

const sortedNums = (v: unknown): number[] =>
  arr<unknown>(v).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
const sortedStrs = (v: unknown): string[] => arr<unknown>(v).map(String).sort();
const sortedRecord = (v: unknown): [string, unknown][] =>
  isObj(v) ? Object.keys(v).sort().map(k => [k, v[k]] as [string, unknown]) : [];

/**
 * 출현 조건·활성 페이지에 영향을 주는 live 필드만으로 만든 키(스위치·변수·셀프 스위치·
 * 아이템·무기·방어구·파티 + 현재 맵 id와 그 맵의 이벤트 페이지). 위치·시각·골드 등은 무시한다.
 * 같은 키면 mapNewCounts / mapInteractables 결과가 같다(같은 data·index·coverage에서). 예외를 던지지 않는다.
 */
export function conditionsKey(live: LiveSnapshot | null | undefined): string {
  try {
    if (!isObj(live)) return "";
    const events = arr<{ eventId: unknown; page: unknown } | null>(live.events)
      .filter(isObj).map(e => [e!.eventId, e!.page] as [unknown, unknown])
      .sort((a, b) => Number(a[0]) - Number(b[0]));
    return JSON.stringify([
      live.mapId ?? null, events,
      sortedNums(live.switches), sortedRecord(live.variables), sortedStrs(live.selfSwitches),
      sortedRecord(live.items), sortedRecord(live.weapons), sortedRecord(live.armors), sortedNums(live.party),
    ]);
  } catch {
    return "";
  }
}

/**
 * RPG Maker 규칙: 마지막 페이지부터, 트리거를 뺀 출현 조건이 모두 met인 첫 페이지.
 * unknown은 미충족. live 없음·해당 없음 → -1. 예외를 던지지 않는다.
 */
export function activePageIndex(ev: MapEvent, mapId: number, data: GameData, live: LiveSnapshot | null): number {
  try {
    if (!live || !isObj(ev)) return -1;
    const pages = arr<MapEvent["pages"][number] | null>(ev.pages);
    const ctx = { mapId, eventId: ev.id };
    for (let i = pages.length - 1; i >= 0; i--) {
      const pg = pages[i];
      if (!isObj(pg) || !isObj(pg.conditions)) continue;
      const conds = pageConditions(pg as { conditions: any; trigger: any }, data);
      if (conds.every(c => c?.test?.kind === "trigger" || evaluate(c?.test, live, ctx) === "met")) return i;
    }
  } catch {
    /* 해당 없음 */
  }
  return -1;
}

/** 기존 nowEvents와 같은 표시 규칙. */
function markOf(entry: PageEntry, trigger: unknown): Interactable["mark"] {
  if (!entry.hasDialogue || typeof trigger !== "number") return "none";
  return trigger <= 2 ? "talk" : trigger <= 4 ? "auto" : "none";
}

/**
 * 페이지 항목의 안 본 대사 수(기본은 선택지 밖만, opts.inChoices면 갈래 안도)·안 고른 선택지 항목 수·대사 노드 수.
 * 기본 모드는 coverage·항목별로 기억한다. 예외를 던지지 않는다.
 */
export function pageNewCounts(entry: PageEntry, cov: Coverage, opts: NewCountOptions = {}): NewCounts {
  try {
    if (!isObj(entry) || !isObj(cov)) return { unseen: 0, unpicked: 0, dialogue: 0 };
    return opts.inChoices === true ? countNew(entry, cov, opts) : countNewCached(entry, cov);
  } catch {
    return { unseen: 0, unpicked: 0, dialogue: 0 };
  }
}

/** countNew(기본 모드)를 coverage·페이지 항목별로 기억한다. */
function countNewCached(entry: PageEntry, cov: Coverage): NewCounts {
  let byEntry = countCache.get(cov);
  if (!byEntry) { byEntry = new WeakMap(); countCache.set(cov, byEntry); }
  const hit = byEntry.get(entry);
  if (hit) return hit;
  const counts = countNew(entry, cov, {});
  byEntry.set(entry, counts);
  return counts;
}

export interface NewCountOptions {
  /** true면 선택지 갈래 안의 안 본 대사도 unseen에 센다(기본: 선택지 밖만). */
  inChoices?: boolean;
}
export interface NewCounts {
  unseen: number; unpicked: number;
  /** 대사·스크롤·선택지 노드 수(갈래 안 포함) */
  dialogue: number;
}

/**
 * 페이지를 한 번 훑어 안 본 대사 수(기본은 선택지 밖만, opts.inChoices면 갈래 안도),
 * 안 고른 선택지 항목 수(취소 갈래 포함), 대사·선택지 노드 수를 센다. 예외를 던지지 않는다(이상하면 지금까지 센 것).
 */
function countNew(entry: PageEntry, cov: Coverage, opts: NewCountOptions): NewCounts {
  let unseen = 0, unpicked = 0, dialogue = 0;
  const deep = opts.inChoices === true;
  /** loc: 노드 cmd가 가리키는 목록 위치(TemplateEvent 호출 안은 불린 목록) */
  const visit = (nodes: unknown, inChoice: boolean, loc: Location) => {
    for (const n of arr<ScriptNode | null>(nodes)) {
      if (!isObj(n)) continue;
      switch (n.kind) {
        case "message": case "scroll":
          dialogue++;
          if ((deep || !inChoice) && !cov.seen.has(seenKey(loc, n.cmd))) unseen++;
          break;
        case "choices": {
          dialogue++;
          const picked = new Set(arr<{ picked: number } | null>(cov.picks.get(pickKey(loc, n.cmd))).map(p => p?.picked));
          arr<{ body: ScriptNode[] } | null>(n.branches).forEach((b, bi) => {
            if (!isObj(b)) return;
            if (!picked.has(bi)) unpicked++;
            visit(b.body, true, loc);
          });
          if (n.cancelBranch) {
            if (!picked.has(-2)) unpicked++;
            visit(n.cancelBranch, true, loc);
          }
          break;
        }
        case "conditional":
          visit(n.then, inChoice, loc);
          if (n.else) visit(n.else, inChoice, loc);
          break;
        case "loop":
          visit(n.body, inChoice, loc);
          break;
        case "call":
          if (isObj(n.location)) visit(n.nodes, inChoice, n.location);
          break;
      }
    }
  };
  try {
    if (isObj(entry) && isObj(cov) && cov.seen instanceof Set && cov.picks instanceof Map) visit(entry.nodes, false, entry.location);
  } catch {
    /* 지금까지 센 것 */
  }
  return { unseen, unpicked, dialogue };
}

/** 위치 키 → 페이지 항목. index별로 한 번만 만든다. */
export function pageEntries(index: GameIndex): Map<string, PageEntry> {
  const cached = isObj(index) ? entriesCache.get(index) : undefined;
  if (cached) return cached;
  const byKey = new Map<string, PageEntry>();
  for (const p of arr<PageEntry | null>(index?.pages)) {
    try { if (isObj(p) && isObj(p.location)) byKey.set(locationKey(p.location), p); } catch { /* 건너뜀 */ }
  }
  if (isObj(index)) entriesCache.set(index, byKey);
  return byKey;
}

function interactablesOn(
  data: GameData, byKey: Map<string, PageEntry>, coverage: Coverage, live: LiveSnapshot, mapId: number,
): Interactable[] {
  const out: Interactable[] = [];
  const events = arr<MapEvent | null>(data.maps?.get(mapId)?.events);
  let livePages: Map<number, number> | null = null;
  if (live.mapId === mapId) {
    livePages = new Map();
    for (const e of arr<{ eventId: number; page: number } | null>(live.events)) {
      if (isObj(e) && typeof e.eventId === "number" && typeof e.page === "number") livePages.set(e.eventId, e.page);
    }
  }
  for (const ev of events) {
    try {
      if (!isObj(ev) || typeof ev.id !== "number") continue;
      const page = livePages ? livePages.get(ev.id) ?? -1 : activePageIndex(ev, mapId, data, live);
      if (page < 0) continue;
      const location: Location = { source: "map", mapId, eventId: ev.id, page };
      const entry = byKey.get(locationKey(location));
      if (!entry) continue;
      const mark = markOf(entry, ev.pages?.[page]?.trigger);
      const { unseen, unpicked } = countNewCached(entry, coverage);
      out.push({
        eventId: ev.id, page, title: entry.title, location, mark, unseen, unpicked,
        isNew: mark !== "none" && (unseen > 0 || unpicked > 0),
      });
    } catch {
      /* 이상한 이벤트는 건너뛴다 */
    }
  }
  return out;
}

/** 맵의 지금 활성 페이지 이벤트들(페이지 없는 이벤트 제외). live 없음 → []. 예외를 던지지 않는다. */
export function mapInteractables(
  data: GameData, index: GameIndex, coverage: Coverage, live: LiveSnapshot | null, mapId: number,
): Interactable[] {
  try {
    if (!live || !isObj(coverage)) return [];
    return interactablesOn(data, pageEntries(index), coverage, live, mapId);
  } catch {
    return [];
  }
}

/** 로드된 모든 맵(템플릿 맵 제외)의 새것(isNew) 이벤트 수. 0인 맵은 넣지 않는다. live 없음 → 빈 Map. 예외를 던지지 않는다. */
export function mapNewCounts(
  data: GameData, index: GameIndex, coverage: Coverage, live: LiveSnapshot | null,
): Map<number, number> {
  const out = new Map<number, number>();
  try {
    if (!live || !isObj(coverage) || !(data?.maps instanceof Map)) return out;
    const byKey = pageEntries(index);
    for (const mapId of data.maps.keys()) {
      if (mapId === data.templateMapId) continue;   // 템플릿 맵은 실제로 가는 곳이 아니다
      const n = interactablesOn(data, byKey, coverage, live, mapId).filter(i => i.isNew).length;
      if (n > 0) out.set(mapId, n);
    }
  } catch {
    /* 지금까지 센 것 */
  }
  return out;
}
