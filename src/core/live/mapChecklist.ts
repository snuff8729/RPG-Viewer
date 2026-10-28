import { describePageConditions } from "../conditions/describe";
import { testToReq, type Req } from "../deps/graph";
import { locationKey } from "../index/locations";
import { walk } from "../interpret/interpret";
import type { GameData, GameIndex, Location, MapEvent, PageEntry } from "../types";
import { evaluate } from "./evaluate";
import { activePageIndex, pageEntries, pageNewCounts } from "./interactable";
import { repeatInfo, type RepeatInfo } from "./repeat";
import type { Coverage, LiveSnapshot } from "./types";

export type Section = "now" | "repeat" | "locked" | "done";
export interface LockedPage {
  page: number; location: Location; unseen: number; unpicked: number;
  /** 트리거 설명을 뺀 출현 조건. req는 의존 그래프 원자로 바꿀 수 있을 때만 */
  conditions: { text: string; met: boolean; req?: Req }[];
}
export interface ChecklistEvent {
  eventId: number; name: string; title: string; x: number; y: number;
  section: Section;
  /** 지금 활성 페이지(0부터), 없으면 -1 */
  activePage: number;
  location: Location | null;
  /** 활성 페이지가 자동 실행·병렬 처리 */
  auto: boolean;
  /** 활성 페이지의 안 본 대사·안 고른 선택지 */
  unseen: number; unpicked: number;
  repeat: RepeatInfo[];
  locked: LockedPage[];
}
export interface MapChecklist {
  mapId: number; mapName: string; width: number; height: number;
  player: { x: number; y: number };
  /** 구역 순서(now → repeat → locked → done), 같은 구역 안에서는 이벤트 id 순 */
  events: ChecklistEvent[];
  /** now + repeat + locked 이벤트 수 */
  remaining: number;
}

const SECTION_ORDER: Record<Section, number> = { now: 0, repeat: 1, locked: 2, done: 3 };
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object";
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** 볼거리가 있는 페이지: 대사·선택지 또는 그림·장소 이동 */
function hasContent(entry: PageEntry): boolean {
  if (entry.hasDialogue) return true;
  let found = false;
  try { walk(arr(entry.nodes), [], n => { if (n.kind === "picture" || n.kind === "transfer") found = true; }); } catch { /* 없음 */ }
  return found;
}

function lockedPage(ev: MapEvent, pi: number, mapId: number, entry: PageEntry, data: GameData, coverage: Coverage, live: LiveSnapshot): LockedPage | null {
  const { unseen, unpicked } = pageNewCounts(entry, coverage);
  if (unseen === 0 && unpicked === 0) return null;
  const pg = ev.pages[pi];
  const self = { mapId, eventId: ev.id };
  const conds = isObj(pg?.conditions) ? describePageConditions(pg.conditions, num(pg.trigger), data) : [];
  const conditions: LockedPage["conditions"] = [];
  for (const cd of conds) {
    if (!cd || cd.test?.kind === "trigger") continue;
    const item: LockedPage["conditions"][number] = { text: cd.text, met: evaluate(cd.test, live, self) === "met" };
    const req = testToReq(cd.test, self);
    if (req) item.req = req;
    conditions.push(item);
  }
  return { page: pi, location: entry.location, unseen, unpicked, conditions };
}

function checkEvent(
  ev: MapEvent, mapId: number, data: GameData, byKey: Map<string, PageEntry>, coverage: Coverage, live: LiveSnapshot,
  livePages: Map<number, number>,
): ChecklistEvent | null {
  const pages = arr<MapEvent["pages"][number] | null>(ev.pages);
  const entries = pages.map((_, pi) => byKey.get(locationKey({ source: "map", mapId, eventId: ev.id, page: pi })) ?? null);
  if (!entries.some(e => e && hasContent(e))) return null;

  const fromLive = livePages.get(ev.id);
  const activePage = fromLive !== undefined ? fromLive : activePageIndex(ev, mapId, data, live);
  const activeEntry = activePage >= 0 ? entries[activePage] ?? null : null;
  const trigger = num(pages[activePage]?.trigger);
  const active = !!activeEntry && isObj(pages[activePage]);
  const auto = active && (trigger === 3 || trigger === 4);
  const { unseen, unpicked } = activeEntry ? pageNewCounts(activeEntry, coverage) : { unseen: 0, unpicked: 0 };
  const repeat = active && trigger <= 4 ? repeatInfo(ev, mapId, data, live, activePage) : [];

  const locked: LockedPage[] = [];
  entries.forEach((entry, pi) => {
    if (pi === activePage || !entry || !entry.hasDialogue || !isObj(pages[pi])) return;
    const lp = lockedPage(ev, pi, mapId, entry, data, coverage, live);
    if (lp) locked.push(lp);
  });

  const section: Section = active && (unseen > 0 || unpicked > 0) ? "now"
    : repeat.length > 0 ? "repeat"
    : locked.length > 0 ? "locked"
    : "done";
  const anyEntry = activeEntry ?? entries.find(e => e) ?? null;
  return {
    eventId: ev.id, name: typeof ev.name === "string" ? ev.name : "", title: anyEntry?.title ?? (ev.name || `EV${ev.id}`),
    x: num(ev.x), y: num(ev.y), section, activePage,
    location: activeEntry ? activeEntry.location : null,
    auto, unseen, unpicked, repeat, locked,
  };
}

/**
 * 지금 있는 맵(live.mapId)의 체크리스트: 지금 할 수 있는 것·반복하면 달라지는 것·잠긴 것·다 본 것.
 * 활성 페이지는 live.events가 있으면 그것을, 없으면 activePageIndex로 계산한다.
 * live 없음·맵 없음 → null. 예외를 던지지 않는다.
 */
export function mapChecklist(data: GameData, index: GameIndex, coverage: Coverage, live: LiveSnapshot): MapChecklist | null {
  try {
    if (!isObj(live) || !isObj(data) || !(data.maps instanceof Map) || !isObj(coverage)) return null;
    const mapId = num(live.mapId);
    const map = data.maps.get(mapId);
    if (!isObj(map)) return null;
    const byKey = pageEntries(index);
    const livePages = new Map<number, number>();
    for (const e of arr<{ eventId: unknown; page: unknown } | null>(live.events)) {
      if (isObj(e) && typeof e.eventId === "number" && typeof e.page === "number") livePages.set(e.eventId, e.page);
    }
    const events: ChecklistEvent[] = [];
    for (const ev of arr<MapEvent | null>(map.events)) {
      try {
        if (!isObj(ev) || typeof ev.id !== "number" || !Array.isArray(ev.pages)) continue;
        const item = checkEvent(ev, mapId, data, byKey, coverage, live, livePages);
        if (item) events.push(item);
      } catch { /* 이상한 이벤트는 건너뛴다 */ }
    }
    events.sort((a, b) => SECTION_ORDER[a.section] - SECTION_ORDER[b.section] || a.eventId - b.eventId);
    const info = arr<{ name?: string } | null>(data.mapInfos)[mapId];
    return {
      mapId,
      mapName: (isObj(info) && info.name) || map.displayName || `맵 ${mapId}`,
      width: num(map.width), height: num(map.height),
      player: { x: num(live.x), y: num(live.y) },
      events,
      remaining: events.filter(e => e.section !== "done").length,
    };
  } catch {
    return null;
  }
}
