import { describePageConditions } from "../conditions/describe";
import { testToReq, type Req } from "../deps/graph";
import { locationKey } from "../index/locations";
import { walk } from "../interpret/interpret";
import { flattenCalls } from "../interpret/teCall";
import { armorName, itemName, variableName, weaponName } from "../text/names";
import type { EventCommand, GameData, GameIndex, Location, MapEvent, PageEntry } from "../types";
import { evaluate } from "./evaluate";
import { activePageIndex, pageEntries, pageNewCounts } from "./interactable";
import { repeatInfo, type RepeatInfo } from "./repeat";
import type { Coverage, LiveSnapshot } from "./types";

/**
 * 지금 할 수 있는 것으로 나눈다(잠긴 페이지가 있어도 지금 할 수 있으면 그쪽 구역).
 * now: 지금 상호작용 + 안 본 대사·선택지 / item: 지금 상호작용 + 얻는 것 / repeat: 반복하면 달라짐 /
 * talk: 그 밖에 지금 조사·대화 가능 / locked: 지금은 못 하고 새 내용이 잠김 / done: 나머지
 */
export type Section = "now" | "item" | "repeat" | "talk" | "locked" | "done";
export interface LockedPage {
  page: number; location: Location; unseen: number; unpicked: number;
  /** 트리거 설명을 뺀 출현 조건. req는 의존 그래프 원자로 바꿀 수 있을 때만 */
  conditions: { text: string; met: boolean; req?: Req }[];
  /** 조건은 다 됐지만 더 뒤(번호가 큰) 활성 페이지가 먼저 나와 지금은 안 나온다 */
  shadowed?: true;
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
  /** 지금 상호작용 가능: 활성 페이지가 결정 키·접촉 트리거(0/1/2)이고 명령이 있다 */
  interactable: boolean;
  /** 활성 페이지에서 얻는 것(`아이템 [x] ×n`, `골드 +n`). 지금 상호작용 가능할 때만 */
  gains: string[];
  /** 활성 페이지의 첫 플러그인 명령 글(최대 60자). 지금 상호작용 가능할 때만 */
  pluginHint?: string;
  /** locked 중 이야기 진행 조건(자동 실행·병렬 페이지이거나 그래픽이 없는 이벤트). 맵에 그리지 않고 남은 수에 안 센다 */
  story: boolean;
}
export interface MapChecklist {
  mapId: number; mapName: string; width: number; height: number;
  player: { x: number; y: number };
  /** 구역 순서(now → item → repeat → talk → locked → 이야기 진행 조건 → done), 같은 구역 안에서는 이벤트 id 순 */
  events: ChecklistEvent[];
  /** now + item + repeat + locked(이야기 진행 조건 제외) 이벤트 수 */
  remaining: number;
}

const SECTION_ORDER: Record<Section, number> = { now: 0, item: 1, repeat: 2, talk: 3, locked: 4, done: 6 };
const rank = (e: ChecklistEvent): number => (e.section === "locked" && e.story ? 5 : SECTION_ORDER[e.section]);
const HINT_MAX = 60;
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

const realCommands = (list: unknown): EventCommand[] =>
  arr<EventCommand | null>(list).filter((c): c is EventCommand => isObj(c) && typeof c.code === "number" && c.code !== 0);

const hasGraphic = (pg: unknown): boolean =>
  isObj(pg) && isObj(pg.image) && (num(pg.image.tileId) > 0 || (typeof pg.image.characterName === "string" && pg.image.characterName !== ""));

function amountText(data: GameData, type: unknown, operand: unknown): string {
  return num(type) === 1 ? `(변수 [${variableName(data, num(operand))}])` : String(num(operand));
}

/** 페이지 명령 중 얻는 것: 아이템·무기·방어구 증가(126/127/128), 골드 증가(125). */
function gainsOf(list: EventCommand[], data: GameData): string[] {
  const out: string[] = [];
  for (const cmd of list) {
    const p = arr<unknown>(cmd.parameters);
    if (cmd.code === 125 && num(p[0]) === 0) out.push(`골드 +${amountText(data, p[1], p[2])}`);
    else if ((cmd.code === 126 || cmd.code === 127 || cmd.code === 128) && num(p[1]) === 0) {
      const id = num(p[0]);
      const [kind, name] = cmd.code === 126 ? ["아이템", itemName(data, id)]
        : cmd.code === 127 ? ["무기", weaponName(data, id)]
        : ["방어구", armorName(data, id)];
      out.push(`${kind} [${name}] ×${amountText(data, p[2], p[3])}`);
    }
  }
  return out;
}

/** 첫 플러그인 명령(MV 356의 글, MZ 357의 설명 글 또는 플러그인·명령 이름)의 글. */
function pluginHintOf(list: EventCommand[]): string | undefined {
  for (const cmd of list) {
    const p = arr<unknown>(cmd.parameters);
    let text = "";
    if (cmd.code === 356) text = typeof p[0] === "string" ? p[0] : "";
    else if (cmd.code === 357) {
      text = typeof p[2] === "string" && p[2].trim() ? p[2] : [p[0], p[1]].filter(v => typeof v === "string" && v).join(" ");
    }
    text = text.trim();
    if (text) return text.length > HINT_MAX ? `${text.slice(0, HINT_MAX)}…` : text;
  }
  return undefined;
}

function lockedPage(
  ev: MapEvent, pi: number, mapId: number, entry: PageEntry, data: GameData, coverage: Coverage, live: LiveSnapshot, activePage: number,
): LockedPage | null {
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
  const lp: LockedPage = { page: pi, location: entry.location, unseen, unpicked, conditions };
  if (activePage > pi && conditions.every(cd => cd.met)) lp.shadowed = true;
  return lp;
}

function checkEvent(
  ev: MapEvent, mapId: number, data: GameData, byKey: Map<string, PageEntry>, coverage: Coverage, live: LiveSnapshot,
  livePages: Map<number, number>,
): ChecklistEvent | null {
  const pages = arr<MapEvent["pages"][number] | null>(ev.pages);
  const entries = pages.map((_, pi) => byKey.get(locationKey({ source: "map", mapId, eventId: ev.id, page: pi })) ?? null);

  const fromLive = livePages.get(ev.id);
  const activePage = fromLive !== undefined ? fromLive : activePageIndex(ev, mapId, data, live);
  const activePg = activePage >= 0 ? pages[activePage] : undefined;
  const activeEntry = activePage >= 0 ? entries[activePage] ?? null : null;
  const trigger = num(activePg?.trigger);
  const commands = isObj(activePg) ? realCommands(activePg.list) : [];
  const interactable = isObj(activePg) && trigger <= 2 && commands.length > 0;
  // TemplateEvent 호출(원래 이벤트 페이지 등)은 불린 목록의 명령으로 펼쳐 얻는 것·플러그인 명령을 찾는다.
  const runCommands = interactable ? realCommands(flattenCalls(activePg.list, { data, mapId, event: ev, page: activePage })) : [];
  if (!interactable && !entries.some(e => e && hasContent(e))) return null;

  const active = !!activeEntry && isObj(activePg);
  const auto = active && (trigger === 3 || trigger === 4);
  const { unseen, unpicked } = activeEntry ? pageNewCounts(activeEntry, coverage) : { unseen: 0, unpicked: 0 };
  const repeat = active && trigger <= 4 ? repeatInfo(ev, mapId, data, live, activePage) : [];
  const gains = interactable ? gainsOf(runCommands, data) : [];
  const pluginHint = interactable ? pluginHintOf(runCommands) : undefined;

  const locked: LockedPage[] = [];
  entries.forEach((entry, pi) => {
    if (pi === activePage || !entry || !entry.hasDialogue || !isObj(pages[pi])) return;
    const lp = lockedPage(ev, pi, mapId, entry, data, coverage, live, activePage);
    if (lp) locked.push(lp);
  });
  // 자동 실행·병렬 활성 페이지의 새 내용은 지금 할 수 있는 게 아니라 이야기 진행을 기다리는 것
  const autoNew = auto && (unseen > 0 || unpicked > 0);

  const section: Section = interactable && (unseen > 0 || unpicked > 0) ? "now"
    : interactable && gains.length > 0 ? "item"
    : repeat.length > 0 ? "repeat"
    : interactable ? "talk"
    : locked.length > 0 || autoNew ? "locked"
    : "done";
  const autoTrigger = (pi: number) => { const t = num(pages[pi]?.trigger); return t === 3 || t === 4; };
  const story = section === "locked" && (!pages.some(hasGraphic) || locked.every(lp => autoTrigger(lp.page)));
  const anyEntry = activeEntry ?? entries.find(e => e) ?? null;
  const item: ChecklistEvent = {
    eventId: ev.id, name: typeof ev.name === "string" ? ev.name : "", title: anyEntry?.title ?? (ev.name || `EV${ev.id}`),
    x: num(ev.x), y: num(ev.y), section, activePage,
    location: activeEntry ? activeEntry.location : null,
    auto, unseen, unpicked, repeat, locked, interactable, gains, story,
  };
  if (pluginHint) item.pluginHint = pluginHint;
  return item;
}

/**
 * 지금 있는 맵(live.mapId)의 체크리스트: 새 대화·얻을 것·반복하면 달라지는 것·조사할 수 있는 것·잠긴 것·다 본 것.
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
    events.sort((a, b) => rank(a) - rank(b) || a.eventId - b.eventId);
    const info = arr<{ name?: string } | null>(data.mapInfos)[mapId];
    return {
      mapId,
      mapName: (isObj(info) && info.name) || map.displayName || `맵 ${mapId}`,
      width: num(map.width), height: num(map.height),
      player: { x: num(live.x), y: num(live.y) },
      events,
      remaining: events.filter(e => (e.section !== "talk" && e.section !== "done" && !e.story)).length,
    };
  } catch {
    return null;
  }
}
