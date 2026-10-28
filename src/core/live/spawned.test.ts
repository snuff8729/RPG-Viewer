import { describe, expect, it } from "vitest";
import { buildIndex } from "../index/buildIndex";
import type { EventCommand, EventPage, GameData, MapData, MapEvent, PageConditions } from "../types";
import { mapChecklist } from "./mapChecklist";
import { baseData, UNKNOWN_SPAWN_TITLE, withSpawnedEvents } from "./spawned";
import type { Coverage, LiveSnapshot } from "./types";
import { currentEvents, mapMarkers, mapNumbers } from "../../ui/live/mapEvents";
import { livePositions, withLivePositions } from "./positions";

const c = (code: number, parameters: any[] = [], indent = 0): EventCommand => ({ code, indent, parameters });
const noCond: PageConditions = {
  switch1Valid: false, switch1Id: 1, switch2Valid: false, switch2Id: 1,
  variableValid: false, variableId: 1, variableValue: 0,
  selfSwitchValid: false, selfSwitchCh: "A",
  itemValid: false, itemId: 1, actorValid: false, actorId: 1,
};
const page = (list: EventCommand[], o: Partial<EventPage> = {}): EventPage => ({
  conditions: noCond, trigger: 0, priorityType: 1, list: [...list, c(0)],
  image: { tileId: 0, characterName: "tg-cm02-chr-02", characterIndex: 0, direction: 2, pattern: 1 }, ...o,
});
const ev = (id: number, name: string, pages: EventPage[], o: Partial<MapEvent> = {}): MapEvent => ({ id, name, x: id, y: 1, pages, ...o });

// like map 96 of the 따거모드 game: two enemies, a mission event, an exit
const mission: MapData = {
  displayName: "", width: 20, height: 15,
  events: [
    null,
    ev(1, "Gebork001", [page([c(301, [0, 1, true, false])], { trigger: 2, moveType: 2 })]),
    ev(2, "<TE:ミッション敵全滅>", [page([c(101, ["", 0, 0, 2]), c(401, ["clear"])], { trigger: 4, image: undefined })]),
    null,
    ev(4, "Gebork001", [page([c(301, [0, 1, true, false])], { trigger: 2, moveType: 2 })]),
    ev(5, "exit", [page([c(201, [0, 2, 3, 3, 0, 0])], { trigger: 1 })]),
  ],
};
const templates: MapData = {
  displayName: "", width: 5, height: 5,
  events: [null, ev(1, "TplOrc", [page([c(301, [0, 2, false, false])], { trigger: 2 })])],
};
const data: GameData = {
  engine: "MZ", dataRoot: "data", imgRoot: "img",
  system: { gameTitle: "", currencyUnit: "G", switches: [], variables: [] },
  mapInfos: [null, { id: 1, name: "임무", parentId: 0, order: 1 }, { id: 2, name: "마을", parentId: 0, order: 2 }, { id: 3, name: "TPL", parentId: 0, order: 3 }],
  maps: new Map([[1, mission], [3, templates]]),
  templateMapId: 3,
  commonEvents: [null], troops: [null, { id: 1, name: "게보크", pages: [] }, { id: 2, name: "오크", pages: [] }],
  actors: [null], items: [null], weapons: [null], armors: [null], errors: [],
};
const index = buildIndex(data);
const coverage = (): Coverage => ({
  seen: new Set(), picks: new Map(), uncertainSeqs: new Set(), changedSeqs: new Set(), touched: new Set(), pluginRan: new Set(),
});
const liveEvents: LiveSnapshot["events"] = [
  { eventId: 1, page: -1, x: 1, y: 1 },
  { eventId: 2, page: 0, x: 2, y: 1 },
  { eventId: 4, page: -1, x: 4, y: 1 },
  { eventId: 5, page: 0, x: 5, y: 1 },
  { eventId: 6, page: 0, x: 10, y: 7, d: 2, spawn: { from: 1, tpl: false } },
  { eventId: 7, page: 0, x: 12, y: 3, spawn: { from: 4, tpl: false } },
  { eventId: 8, page: 0, x: 3, y: 9, spawn: { from: 1, tpl: true } },
  { eventId: 9, page: 0, x: 6, y: 6, spawn: { name: "Mystery" } },
];
const live = (events = liveEvents): LiveSnapshot => ({
  v: 1, t: 0, pluginVersion: "1.16.0", run: 1, branch: 1, seq: 0, mapId: 1, x: 0, y: 0, running: null,
  events, switches: [], variables: {}, selfSwitches: [], items: {}, weapons: {}, armors: {},
  gold: 0, party: [], choice: null, inBattle: false,
});

describe("runtime-spawned events (bridge 1.16.0)", () => {
  it("clones the source event (same map or template map) at the spawned id and live position", () => {
    const d = withSpawnedEvents(data, live());
    expect(d).not.toBe(data);
    expect(baseData(d)).toBe(data);
    const evs = d.maps.get(1)!.events;
    expect(evs[6]).toMatchObject({ id: 6, name: "Gebork001", x: 10, y: 7, spawned: { from: 1, template: false } });
    expect(evs[6]!.pages).toBe(mission.events[1]!.pages);
    expect(evs[7]).toMatchObject({ id: 7, x: 12, y: 3, spawned: { from: 4, template: false } });
    expect(evs[8]).toMatchObject({ id: 8, name: "TplOrc", spawned: { from: 1, template: true } });
    expect(evs[9]).toEqual({ id: 9, name: "Mystery", x: 6, y: 6, pages: [], spawned: { from: null, template: false } });
    expect(evs[3]).toBeNull();
    // the map data itself is untouched; same spawn set -> same object, even after the enemies moved
    expect(mission.events).toHaveLength(6);
    const moved = liveEvents.map(e => (e.eventId === 6 ? { ...e, x: 11 } : e));
    expect(withSpawnedEvents(data, live(moved))).toBe(d);
    expect(withSpawnedEvents(data, live(liveEvents.slice(0, 4)))).toBe(data);
  });

  it("spawned enemies are listed as enemies, numbered after the map data events, with markers at live positions", () => {
    const m = mapChecklist(data, index, coverage(), live())!;
    const ids = m.events.map(e => e.eventId);
    // erased originals (page -1) are gone, the copies are there
    expect(ids).not.toContain(1);
    expect(ids).not.toContain(4);
    const enemies = m.events.filter(e => e.section === "enemy");
    expect(enemies.map(e => e.eventId)).toEqual([6, 7, 8]);
    expect(enemies[0]).toMatchObject({ title: "Gebork001", x: 10, y: 7, enemy: { troops: ["게보크"], now: true } });
    expect(enemies[2].enemy?.troops).toEqual(["오크"]);
    const numbers = mapNumbers(m.events);
    // data events 1 (erased), 4 (erased), 5 (exit) have numbers 1..3; spawned ones come after by id
    expect(numbers.get(5)).toBe(3);
    expect([numbers.get(6), numbers.get(7), numbers.get(8)]).toEqual([4, 5, 6]);
    const unknown = m.events.find(e => e.eventId === 9)!;
    expect(unknown).toMatchObject({ title: UNKNOWN_SPAWN_TITLE, section: "done", x: 6, y: 6, story: false });
    expect(unknown.number).toBeUndefined();
    const markers = mapMarkers(withLivePositions(m.events, livePositions(liveEvents)), false);
    expect(markers.filter(e => e.eventId >= 6).map(e => [e.eventId, e.x, e.y])).toEqual(
      expect.arrayContaining([[6, 10, 7], [7, 12, 3], [8, 3, 9], [9, 6, 6]]),
    );
  });

  it("draws spawned events on the map with their source page", () => {
    const map = withSpawnedEvents(data, live()).maps.get(1);
    const cur = currentEvents(map, liveEvents);
    const six = cur.find(e => e.id === 6)!;
    expect(six).toMatchObject({ x: 10, y: 7, d: 2 });
    expect(six.page.image?.characterName).toBe("tg-cm02-chr-02");
    expect(cur.some(e => e.id === 9)).toBe(false); // no page: marker only
  });

  it("old bridges (no spawn field): events missing from the map data become unknown markers; nothing to do otherwise", () => {
    const d = withSpawnedEvents(data, live([{ eventId: 1, page: 0 }, { eventId: 12, page: 0, x: 3, y: 3 }]));
    expect(d.maps.get(1)!.events[12]).toMatchObject({ spawned: { from: null } });
    expect(withSpawnedEvents(data, live([{ eventId: 1, page: 0 }]))).toBe(data);
    // template spawn without a template map: unknown
    const noTpl = withSpawnedEvents({ ...data, templateMapId: undefined }, live([{ eventId: 8, page: 0, x: 1, y: 1, spawn: { from: 1, tpl: true } }]));
    expect(noTpl.maps.get(1)!.events[8]).toMatchObject({ spawned: { from: null } });
    expect(withSpawnedEvents(data, null)).toBe(data);
  });
});
