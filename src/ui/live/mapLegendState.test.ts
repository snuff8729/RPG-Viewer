import { describe, expect, it } from "vitest";
import type { ChecklistEvent } from "@/core/live/mapChecklist";
import { UNKNOWN_SPAWN_TITLE } from "@/core/live/spawned";
import { legendKeyOf, parseLegendHidden, visibleByLegend } from "./mapLegendState";
import { mapMarkers } from "./mapEvents";

const e = (eventId: number, section: ChecklistEvent["section"], story = false, title = "t") => ({ eventId, section, story, title }) as ChecklistEvent;

describe("map legend toggles", () => {
  it("defaults: only 잠김 is off; broken or foreign values fall back / are dropped", () => {
    expect([...parseLegendHidden(null)]).toEqual(["locked"]);
    expect([...parseLegendHidden("nope")]).toEqual(["locked"]);
    expect([...parseLegendHidden(JSON.stringify(["enemy", "bogus", "player"]))]).toEqual(["enemy", "player"]);
    expect([...parseLegendHidden("[]")]).toEqual([]);
  });

  it("each event belongs to one legend item; unknown spawns have their own", () => {
    expect(legendKeyOf(e(1, "enemy"))).toBe("enemy");
    expect(legendKeyOf(e(2, "done", false, UNKNOWN_SPAWN_TITLE))).toBe("spawn");
    expect(legendKeyOf(e(3, "locked", true))).toBeNull();
  });

  it("hidden items leave the map and the lists; story rows stay in the list", () => {
    const listed = [e(1, "now"), e(2, "enemy"), e(3, "locked"), e(4, "done", false, UNKNOWN_SPAWN_TITLE), e(5, "item", true)];
    const hidden = new Set(["enemy", "spawn"] as const);
    expect(mapMarkers(listed, hidden).map(x => x.eventId)).toEqual([1, 3]);
    expect(mapMarkers(listed, parseLegendHidden(null)).map(x => x.eventId)).toEqual([1, 2, 4]);
    expect(visibleByLegend(listed, hidden).map(x => x.eventId)).toEqual([1, 3, 5]);
    expect(visibleByLegend(listed, new Set())).toBe(listed);
  });
});
