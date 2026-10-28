import { beforeAll, describe, expect, it } from "vitest";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { fixtureRecords } from "../../../tests/helpers/fixtureLog";
import { loadGame } from "../loader/loadGame";
import type { GameData } from "../types";
import { computeCoverage, pageList, pickKey, seenKey } from "./coverage";
import type { LogRecord } from "./types";

let data: GameData;
beforeAll(async () => {
  const r = await loadGame(loadFixtureFolder("sample-mz"));
  if (!r.ok) throw new Error("load failed");
  data = r.data;
});

describe("computeCoverage", () => {
  it("coverage from fixture", () => {
    const c = computeCoverage(fixtureRecords(), data);
    expect([...c.seen].sort()).toEqual(["common:1#0", "map:2:1:0#0", "map:2:1:0#12", "map:2:1:0#3", "map:2:1:0#5", "map:2:1:0#8", "map:2:1:1#0", "map:2:3:0#0"]);
    const picks = c.picks.get("map:2:1:0#10")!;
    expect(picks.map(p => [p.picked, p.branch])).toEqual([[0, 1], [1, 2]]);
    expect(picks[0].aftermath).toEqual(['촌장: "고맙네!"', "스위치 숲 개방 → ON", "🚪 숲 입구 이동"]);
    expect(picks[1]).toMatchObject({ run: 1, seq: 30, aftermath: ['(내레이션): "밤이 깊었다."'] });
    expect(c.uncertainSeqs.size).toBe(0);
  });
  it("excludes mismatched records", () => {
    const recs = fixtureRecords().map(r => r.seq === 10 ? { ...r, text: "다른 대사" } as LogRecord : r);
    const c = computeCoverage(recs, data);
    expect(c.seen.has("map:2:1:0#12")).toBe(false); expect(c.uncertainSeqs.has(10)).toBe(true);
  });
  it("excludes wrong command codes and unknown locations", () => {
    const recs = fixtureRecords().map(r => {
      if (r.seq === 9) return { ...r, cmd: 11 } as LogRecord;                                            // 402, not 102
      if (r.seq === 2) return { ...r, src: { source: "map", mapId: 9, eventId: 1, page: 0 } } as LogRecord; // no such map
      if (r.seq === 3) return { ...r, src: null } as LogRecord;
      return r;
    });
    const c = computeCoverage(recs, data);
    expect([...c.uncertainSeqs].sort((a, b) => a - b)).toEqual([2, 3, 9]);
    expect(c.picks.get("map:2:1:0#10")!.map(p => p.picked)).toEqual([1]);
    expect(c.seen.has("map:2:1:0#0")).toBe(false);
  });
  it("never throws on odd input", () => {
    const odd = [null, 1, {}, { type: "message", seq: 1 }, { type: "choice", src: { source: "troop", troopId: 99, page: 0 }, cmd: 0, seq: 2 }] as unknown as LogRecord[];
    expect(() => computeCoverage(odd, data)).not.toThrow();
    expect(() => computeCoverage(fixtureRecords(), { ...data, maps: new Map(), commonEvents: [], troops: [] } as GameData)).not.toThrow();
  });
});

describe("helpers", () => {
  it("keys and pageList", () => {
    expect(seenKey({ source: "map", mapId: 2, eventId: 1, page: 0 }, 3)).toBe("map:2:1:0#3");
    expect(pickKey({ source: "troop", troopId: 1, page: 0 }, 0)).toBe("troop:1:0#0");
    expect(pageList(data, { source: "common", commonEventId: 1 })![0].code).toBe(101);
    expect(pageList(data, { source: "troop", troopId: 1, page: 0 })).not.toBeNull();
    expect(pageList(data, { source: "map", mapId: 2, eventId: 1, page: 9 })).toBeNull();
    expect(pageList(data, { source: "map", mapId: 2, eventId: 99, page: 0 })).toBeNull();
  });
});
