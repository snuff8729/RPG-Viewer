import { beforeAll, describe, expect, it } from "vitest";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { fixtureLive, fixtureRecords } from "../../../tests/helpers/fixtureLog";
import { buildIndex } from "../index/buildIndex";
import { loadGame } from "../loader/loadGame";
import type { GameData, GameIndex, MapEvent } from "../types";
import { computeCoverage } from "./coverage";
import { activePageIndex, mapInteractables, mapNewCounts } from "./interactable";

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
