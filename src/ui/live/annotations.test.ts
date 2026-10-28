import { beforeAll, describe, expect, it } from "vitest";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { fixtureLive } from "../../../tests/helpers/fixtureLog";
import { buildIndex } from "@/core/index/buildIndex";
import { loadGame } from "@/core/loader/loadGame";
import type { GameData, GameIndex } from "@/core/types";
import { conditionIcon, nowEvents } from "./annotations";

let data: GameData, index: GameIndex;
beforeAll(async () => {
  const r = await loadGame(loadFixtureFolder("sample-mz"));
  if (!r.ok) throw new Error("load failed");
  data = r.data; index = buildIndex(data);
});

describe("annotations", () => {
  it("nowEvents: live events on the current map", () => {
    const r = nowEvents(data, index, fixtureLive());
    expect(r.map((e) => [e.eventId, e.page, e.mark])).toEqual([[1, 1, "talk"], [3, 0, "talk"]]);
    expect(r[0].location).toMatchObject({ source: "map", eventId: 1, page: 1 });
  });
  it("nowEvents: null live -> empty", () => {
    expect(nowEvents(data, index, null)).toEqual([]);
  });
  it("conditionIcon", () => {
    expect(conditionIcon("met")).toBe("✓");
    expect(conditionIcon("unmet")).toBe("✗");
    expect(conditionIcon("unknown")).toBe("?");
  });
});
