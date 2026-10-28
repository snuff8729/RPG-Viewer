import { beforeAll, describe, expect, it } from "vitest";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { fixtureLive, fixtureRecords } from "../../../tests/helpers/fixtureLog";
import { buildIndex } from "../index/buildIndex";
import { loadGame } from "../loader/loadGame";
import type { GameData, GameIndex, MapEvent } from "../types";
import { computeCoverage } from "./coverage";
import { activePageIndex, conditionsKey, mapInteractables, mapNewCounts } from "./interactable";

let data: GameData, index: GameIndex;
beforeAll(async () => {
  const r = await loadGame(loadFixtureFolder("sample-mz"));
  if (!r.ok) throw new Error("load failed");
  data = r.data; index = buildIndex(data);
});
const ev = (mapId: number, eventId: number) => data.maps.get(mapId)!.events[eventId] as MapEvent;

describe("activePageIndex", () => {
  it("picks the last page whose conditions are met", () => {
    expect(activePageIndex(ev(2, 1), 2, data, fixtureLive())).toBe(1);
    expect(activePageIndex(ev(2, 1), 2, data, { ...fixtureLive(), switches: [] })).toBe(0);
    expect(activePageIndex(ev(2, 3), 2, data, fixtureLive())).toBe(0);
  });
  it("live null → -1; odd input never throws", () => {
    expect(activePageIndex(ev(2, 1), 2, data, null)).toBe(-1);
    expect(activePageIndex(null as unknown as MapEvent, 2, data, fixtureLive())).toBe(-1);
    expect(activePageIndex({ id: 9, name: "", x: 0, y: 0, pages: null } as unknown as MapEvent, 2, data, fixtureLive())).toBe(-1);
  });
  it("unknown/unmet self switch counts as unmet", () => {
    const p0 = ev(2, 1).pages[0];
    const e: MapEvent = { ...ev(2, 1), pages: [{ ...p0, conditions: { ...p0.conditions, selfSwitchValid: true, selfSwitchCh: "A" } }] };
    expect(activePageIndex(e, 2, data, fixtureLive())).toBe(-1);
    expect(activePageIndex(e, 2, data, { ...fixtureLive(), selfSwitches: ["2,1,A"] })).toBe(0);
  });
});

describe("mapInteractables", () => {
  it("full records: current pages, nothing new", () => {
    const cov = computeCoverage(fixtureRecords(), data);
    const list = mapInteractables(data, index, cov, fixtureLive(), 2);
    expect(list.map(i => [i.eventId, i.page, i.mark, i.isNew])).toEqual([[1, 1, "talk", false], [3, 0, "talk", false]]);
    expect(list[0].location).toEqual({ source: "map", mapId: 2, eventId: 1, page: 1 });
    const entry = index.pages.find(p =>
      p.location.source === "map" && p.location.mapId === 2 && p.location.eventId === 1 && p.location.page === 1)!;
    expect(list[0].title).toBe(entry.title);
  });
  it("partial records (seq ≤ 11): EV3 is new with one unseen line", () => {
    const cov = computeCoverage(fixtureRecords().filter(r => r.seq <= 11), data);
    const ev3 = mapInteractables(data, index, cov, fixtureLive(), 2).find(i => i.eventId === 3)!;
    expect(ev3.isNew).toBe(true);
    expect(ev3.unseen).toBe(1);
    expect(ev3.unpicked).toBe(0);
  });
  it("counts unseen outside choices and unpicked options on page 0", () => {
    const cov = computeCoverage(fixtureRecords().filter(r => r.seq <= 11), data);
    const live = { ...fixtureLive(), switches: [], events: [{ eventId: 1, page: 0 }, { eventId: 3, page: 0 }] };
    const ev1 = mapInteractables(data, index, cov, live, 2).find(i => i.eventId === 1)!;
    // 선택지 밖: cmd 0,3,5,8 봄 / 20(조건 분기 안)·27(scroll) 안 봄 → 2. 선택지: 0 고름, 1 안 고름 → 1
    expect(ev1.unseen).toBe(2);
    expect(ev1.unpicked).toBe(1);
    expect(ev1.isNew).toBe(true);
  });
  it("other map uses activePageIndex; null live → []", () => {
    const cov = computeCoverage([], data);
    const doors = mapInteractables(data, index, cov, fixtureLive(), 3);
    expect(doors.map(i => [i.eventId, i.page, i.mark, i.isNew])).toEqual([[1, 0, "none", false]]);
    expect(mapInteractables(data, index, cov, null, 2)).toEqual([]);
  });
});

describe("mapNewCounts", () => {
  it("counts new events per map, skipping maps without any", () => {
    const partial = computeCoverage(fixtureRecords().filter(r => r.seq <= 11), data);
    const counts = mapNewCounts(data, index, partial, fixtureLive());
    expect(counts.get(2)).toBe(2);
    expect(counts.has(3)).toBe(false);
    expect(mapNewCounts(data, index, computeCoverage(fixtureRecords(), data), fixtureLive()).size).toBe(0);
    expect(mapNewCounts(data, index, partial, null).size).toBe(0);
  });
});

describe("conditionsKey", () => {
  it("same page-condition fields → same key, regardless of position, order or identity", () => {
    const a = fixtureLive();
    const b = { ...fixtureLive(), x: a.x + 3, y: a.y + 1, t: a.t + 100, seq: a.seq + 5, gold: 99999, switches: [...a.switches].reverse() };
    expect(conditionsKey(b)).toBe(conditionsKey(a));
  });
  it("changes when any page-condition field changes", () => {
    const a = fixtureLive();
    const k = conditionsKey(a);
    expect(conditionsKey({ ...a, switches: [...a.switches, 999] })).not.toBe(k);
    expect(conditionsKey({ ...a, variables: { ...a.variables, 77: 1 } })).not.toBe(k);
    expect(conditionsKey({ ...a, selfSwitches: [...a.selfSwitches, "9,9,A"] })).not.toBe(k);
    expect(conditionsKey({ ...a, items: { ...a.items, 55: 1 } })).not.toBe(k);
    expect(conditionsKey({ ...a, weapons: { ...a.weapons, 55: 1 } })).not.toBe(k);
    expect(conditionsKey({ ...a, armors: { ...a.armors, 55: 1 } })).not.toBe(k);
    expect(conditionsKey({ ...a, party: [...a.party, 42] })).not.toBe(k);
    expect(conditionsKey({ ...a, mapId: a.mapId + 1 })).not.toBe(k);
    expect(conditionsKey({ ...a, events: [...a.events, { eventId: 99, page: 0 }] })).not.toBe(k);
  });
  it("null and odd input never throw", () => {
    expect(conditionsKey(null)).toBe("");
    expect(() => conditionsKey({ switches: "x", variables: null } as unknown as ReturnType<typeof fixtureLive>)).not.toThrow();
  });
});

describe("mapNewCounts cost (synthetic 400 maps × 120 events)", () => {
  it("second call with the same index is much cheaper than the first", () => {
    const m2 = data.maps.get(2)!;
    const maps = new Map(data.maps);
    const mapInfos = [...data.mapInfos];
    for (let id = 10; id < 410; id++) {
      const events: (MapEvent | null)[] = [null];
      for (let i = 1; i <= 120; i++) {
        const src = (m2.events[(i % 3) + 1] ?? m2.events[1]) as MapEvent;
        events.push({ ...structuredClone(src), id: i });
      }
      maps.set(id, { ...structuredClone(m2), events });
      mapInfos[id] = { ...data.mapInfos[2]!, id, name: `M${id}`, parentId: 0 };
    }
    const big = { ...data, maps, mapInfos } as GameData;
    const bigIndex = buildIndex(big);
    const cov = computeCoverage(fixtureRecords().filter(r => r.seq <= 11), big);
    const live = fixtureLive();
    let t = performance.now();
    const first = mapNewCounts(big, bigIndex, cov, live);
    const firstMs = performance.now() - t;
    t = performance.now();
    const second = mapNewCounts(big, bigIndex, cov, { ...live, x: live.x + 1 });
    const secondMs = performance.now() - t;
    console.log(`mapNewCounts 400×120: first ${firstMs.toFixed(1)}ms, second ${secondMs.toFixed(1)}ms (pages ${bigIndex.pages.length})`);
    expect(second).toEqual(first);
    expect(first.size).toBeGreaterThan(400);
    expect(secondMs).toBeLessThan(firstMs * 0.5);
  });
});
