import { describePageConditions } from "../conditions/describe";
import { locationKey } from "../index/locations";
import type { GameData, GameIndex, Location, MapEvent, PageEntry, ScriptNode } from "../types";
import { pickKey, seenKey } from "./coverage";
import { evaluate } from "./evaluate";
import type { Coverage, LiveSnapshot } from "./types";

export interface Interactable {
  eventId: number; page: number; title: string; location: Location;
  mark: "talk" | "auto" | "none";
  unseen: number; unpicked: number; isNew: boolean;
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object";

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
      const conds = describePageConditions(pg.conditions, pg.trigger, data);
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

/** 페이지를 한 번 훑어 선택지 밖 안 본 대사 수와 안 고른 선택지 항목 수를 센다. */
function countNew(entry: PageEntry, cov: Coverage): { unseen: number; unpicked: number } {
  let unseen = 0, unpicked = 0;
  const visit = (nodes: unknown, inChoice: boolean) => {
    for (const n of arr<ScriptNode | null>(nodes)) {
      if (!isObj(n)) continue;
      switch (n.kind) {
        case "message": case "scroll":
          if (!inChoice && !cov.seen.has(seenKey(entry.location, n.cmd))) unseen++;
          break;
        case "choices": {
          const picked = new Set(arr<{ picked: number } | null>(cov.picks.get(pickKey(entry.location, n.cmd))).map(p => p?.picked));
          arr<{ body: ScriptNode[] } | null>(n.branches).forEach((b, bi) => {
            if (!isObj(b)) return;
            if (!picked.has(bi)) unpicked++;
            visit(b.body, true);
          });
          if (n.cancelBranch) {
            if (!picked.has(-2)) unpicked++;
            visit(n.cancelBranch, true);
          }
          break;
        }
        case "conditional":
          visit(n.then, inChoice);
          if (n.else) visit(n.else, inChoice);
          break;
        case "loop":
          visit(n.body, inChoice);
          break;
      }
    }
  };
  visit(entry.nodes, false);
  return { unseen, unpicked };
}

function pageEntries(index: GameIndex): Map<string, PageEntry> {
  const byKey = new Map<string, PageEntry>();
  for (const p of arr<PageEntry | null>(index?.pages)) {
    try { if (isObj(p) && isObj(p.location)) byKey.set(locationKey(p.location), p); } catch { /* 건너뜀 */ }
  }
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
      const { unseen, unpicked } = countNew(entry, coverage);
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

/** 로드된 모든 맵의 새것(isNew) 이벤트 수. 0인 맵은 넣지 않는다. live 없음 → 빈 Map. 예외를 던지지 않는다. */
export function mapNewCounts(
  data: GameData, index: GameIndex, coverage: Coverage, live: LiveSnapshot | null,
): Map<number, number> {
  const out = new Map<number, number>();
  try {
    if (!live || !isObj(coverage) || !(data?.maps instanceof Map)) return out;
    const byKey = pageEntries(index);
    for (const mapId of data.maps.keys()) {
      const n = interactablesOn(data, byKey, coverage, live, mapId).filter(i => i.isNew).length;
      if (n > 0) out.set(mapId, n);
    }
  } catch {
    /* 지금까지 센 것 */
  }
  return out;
}
