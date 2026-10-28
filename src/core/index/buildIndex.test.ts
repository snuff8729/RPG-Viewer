import { beforeAll, describe, expect, it } from "vitest";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { loadGame } from "../loader/loadGame";
import type { GameData, GameIndex } from "../types";
import { buildIndex } from "./buildIndex";
import { locationKey } from "./locations";

let data: GameData, mvData: GameData, idx: GameIndex;
beforeAll(async () => {
  const a = await loadGame(loadFixtureFolder("sample-mz"));
  const b = await loadGame(loadFixtureFolder("sample-mv"));
  if (!a.ok || !b.ok) throw new Error("load failed");
  data = a.data; mvData = b.data; idx = buildIndex(data);
});

describe("buildIndex", () => {
  it("orders pages and skips nulls", () => expect(idx.pages.map(p => p.path)).toEqual([
    "촌장의 집 › 촌장 › p1",
    "촌장의 집 › 촌장 › p2",
    "촌장의 집 › \"낡은 책이 꽂혀 있다. 숲의 전설에…\" › p1",
    "숲 입구 › 문 › p1",
    "공통 이벤트 › 밤의 장면",
    "전투 › 슬라임 › p1",
  ]));
  it("flags dialogue", () => expect(idx.pages.find(p => p.path.startsWith("숲 입구"))!.hasDialogue).toBe(false));
  it("searches nested text", () => {
    const hits = idx.search("고맙네");
    expect(hits).toHaveLength(1);
    expect(hits[0].entry.path).toBe("촌장의 집 › 촌장 › p1");
    expect(hits[0].nodePath).toEqual([5, 0, 0]);
  });
  it("uses speaker in title for EV### names", () => {
    expect(buildIndex(mvData).pages[0].title).toBe("레나 — \"MV 대사입니다.\"");
  });
  it("searches choice labels and speakers", () => {
    expect(idx.search("생각해볼게요")[0].text).toBe("생각해볼게요");
    expect(idx.search("촌장").length).toBeGreaterThan(0);
  });
  it("empty query", () => expect(idx.search("  ")).toEqual([]));
  it("xref switch 1", () => {
    const x = idx.xref({ type: "switch", id: 1 });
    expect(x.writes.map(p => p.path)).toEqual(["촌장의 집 › 촌장 › p1"]);
    expect(x.reads.map(p => p.path)).toEqual(["촌장의 집 › 촌장 › p2"]);
  });
  it("xref variable read in branch", () => expect(idx.xref({ type: "variable", id: 1 }).reads.map(p => p.path)).toEqual(["촌장의 집 › 촌장 › p1"]));
  it("callers", () => expect(idx.callers(1).map(p => p.path)).toEqual(["촌장의 집 › 촌장 › p1"]));
  it("locationKey", () => {
    expect(locationKey({ source: "map", mapId: 2, eventId: 1, page: 0 })).toBe("map:2:1:0");
    expect(locationKey({ source: "common", commonEventId: 1 })).toBe("common:1");
    expect(locationKey({ source: "troop", troopId: 1, page: 0 })).toBe("troop:1:0");
  });
});
