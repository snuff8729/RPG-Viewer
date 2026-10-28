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

describe("buildIndex robustness", () => {
  const msg = (text: string) => [
    { code: 101, indent: 0, parameters: ["", 0, 0, 2] },
    { code: 401, indent: 0, parameters: [text] },
    { code: 0, indent: 0, parameters: [] },
  ];
  const okPage = (text: string) => ({ conditions: data.maps.get(2)!.events[1]!.pages[0].conditions, trigger: 0, list: msg(text) });
  function broken(): GameData {
    const maps = new Map(data.maps);
    maps.set(2, {
      displayName: "",
      events: [
        null,
        { id: 1, name: "noPages", x: 0, y: 0 } as any,
        { id: 2, name: "emptyPages", x: 0, y: 0, pages: [] },
        { id: 3, name: "mixed", x: 0, y: 0, pages: [null, { trigger: 0, list: msg("조건 없음") }, okPage("정상 페이지"), { conditions: null, trigger: 0 }] } as any,
        { id: 4, name: "badList", x: 0, y: 0, pages: [{ conditions: {}, trigger: 0, list: "nope" }] } as any,
      ],
    });
    return {
      ...data, maps,
      troops: [null, { id: 1, name: "noPages" } as any, { id: 2, name: "nullPage", pages: [null, { span: 0, list: msg("전투 대사") }] } as any],
    };
  }
  it("never throws on malformed events/pages/troops", () => expect(() => buildIndex(broken())).not.toThrow());
  it("still indexes the valid pages", () => {
    const i = buildIndex(broken());
    expect(i.search("조건 없음").map(h => h.entry.path)).toEqual(["촌장의 집 › mixed › p2"]);
    expect(i.search("정상 페이지").map(h => h.entry.path)).toEqual(["촌장의 집 › mixed › p3"]);
    expect(i.search("전투 대사").map(h => h.entry.path)).toEqual(["전투 › nullPage › p2"]);
    expect(i.pages.some(p => p.path === "공통 이벤트 › 밤의 장면")).toBe(true);
    expect(i.pages.some(p => p.path.startsWith("촌장의 집 › noPages"))).toBe(false);
    expect(i.pages.some(p => p.path.startsWith("촌장의 집 › emptyPages"))).toBe(false);
  });
});
