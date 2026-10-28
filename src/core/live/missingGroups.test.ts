import { beforeAll, describe, expect, it } from "vitest";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { fixtureLive } from "../../../tests/helpers/fixtureLog";
import { buildIndex } from "../index/buildIndex";
import { loadGame } from "../loader/loadGame";
import type { GameData, GameIndex } from "../types";
import { computeCoverage } from "./coverage";
import { computeMissing } from "./missing";
import { groupMissing, reachableCount, viewGroups } from "./missingGroups";

let data: GameData, index: GameIndex;
beforeAll(async () => {
  const r = await loadGame(loadFixtureFolder("sample-mz"));
  if (!r.ok) throw new Error("load failed");
  data = r.data; index = buildIndex(data);
});

const ev1 = (page: number) => `map:2:1:${page}`;

describe("groupMissing", () => {
  it("current map group first, then common, troop", () => {
    const live = fixtureLive();
    const g = groupMissing(computeMissing(index, data, computeCoverage([], data), live), data, index, live);
    expect(g.map(x => [x.key, x.kind, x.name, x.current])).toEqual([
      ["map:2", "map", "촌장의 집", true],
      ["common", "common", "공통 이벤트", false],
      ["troop", "troop", "전투", false],
    ]);
    expect(g[0].mapId).toBe(2);
  });
  it("EV1 page0 is not the current page → active false, not reachable; page1 active", () => {
    const live = fixtureLive();
    const g = groupMissing(computeMissing(index, data, computeCoverage([], data), live), data, index, live);
    const evs = g[0].events;
    const p0 = evs.find(e => e.key === ev1(0))!;
    const p1 = evs.find(e => e.key === ev1(1))!;
    expect(p0.active).toBe(false);
    expect(p0.reachable).toBe(false);
    expect(p0.choiceCount).toBe(2);
    expect(p0.pageCount).toBe(1);
    expect(p1.active).toBe(true);
    expect(p1.reachable).toBe(true);
    // reachable 먼저
    expect(evs[evs.length - 1].key).toBe(ev1(0));
    expect(g[0].reachableEvents).toBe(evs.length - 1);
    expect(g[0].choiceCount).toBe(evs.reduce((s, e) => s + e.choiceCount, 0));
    // 공통/전투는 active null
    expect(g[1].events.every(e => e.active === null)).toBe(true);
  });
  it("unmet requirements make an event group unreachable even on its active page", () => {
    const live = fixtureLive();
    const m = computeMissing(index, data, computeCoverage([], data), live)
      .map(i => (i.entry.path === "촌장의 집 › 촌장 › p2"
        ? { ...i, requirements: [{ text: "x", status: "unmet" as const }], allMet: false } : i));
    const g = groupMissing(m, data, index, live);
    const p1 = g.find(x => x.key === "map:2")!.events.find(e => e.key === ev1(1))!;
    expect(p1.active).toBe(true);
    expect(p1.reachable).toBe(false);
  });
  it("reachable view drops inactive pages and common/troop groups", () => {
    const live = fixtureLive();
    const g = groupMissing(computeMissing(index, data, computeCoverage([], data), live), data, index, live);
    const r = viewGroups(g, "reachable", "");
    expect(r.map(x => x.key)).toEqual(["map:2"]);
    expect(r[0].events.some(e => e.key === ev1(0))).toBe(false);
    expect(r[0].events.some(e => e.key === ev1(1))).toBe(true);
    expect(reachableCount(g)).toBe(r[0].events.length);
    expect(viewGroups(g, "now", "").map(x => x.key)).toEqual(["map:2"]);
    expect(viewGroups(g, "now", "")[0].events).toHaveLength(g[0].events.length);
    expect(viewGroups(g, "all", "")).toEqual(g);
  });
  it("live null → active null, no current map", () => {
    const g = groupMissing(computeMissing(index, data, computeCoverage([], data), null), data, index, null);
    const map = g.find(x => x.key === "map:2")!;
    expect(map.current).toBe(false);
    expect(map.events.every(e => e.active === null)).toBe(true);
    expect(viewGroups(g, "now", "")).toEqual([]);
  });
  it("query filters by map name or event title/path, case-insensitive", () => {
    const live = fixtureLive();
    const g = groupMissing(computeMissing(index, data, computeCoverage([], data), live), data, index, live);
    const q = viewGroups(g, "all", "  촌장 ");
    expect(q.map(x => x.key)).toEqual(["map:2"]);
    expect(q[0].events).toHaveLength(g[0].events.length);
    const s = viewGroups(g, "all", "슬라임");
    expect(s.map(x => x.key)).toEqual(["troop"]);
    expect(viewGroups(g, "all", "없는이름")).toEqual([]);
  });
  it("never throws on odd input", () => {
    expect(() => groupMissing(null as never, data, index, null)).not.toThrow();
    expect(groupMissing([null as never], null as never, null as never, null)).toEqual([]);
  });
});
