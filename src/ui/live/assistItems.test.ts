import { describe, expect, it } from "vitest";
import { ASSIST_FAVORITE_IDS } from "@/core/live/favoritesFile";
import { ASSIST_ITEMS, assistFavoriteLabel, BACKUP_ITEMS, visibleAssistFavorites, withObjectParticle } from "./assistItems";

describe("assist favorites bar items", () => {
  it("every favorite id has a control and a label", () => {
    const ids = new Set<string>([...ASSIST_ITEMS, ...BACKUP_ITEMS].map((i) => i.id));
    for (const id of ASSIST_FAVORITE_IDS) {
      expect(ids.has(id)).toBe(true);
      expect(assistFavoriteLabel(id)).not.toBe(id);
    }
  });
  it("hides battle controls outside battle, keeps order", () => {
    expect(visibleAssistFavorites(["speed", "win", "hpFull", "escape"], false)).toEqual(["speed", "hpFull"]);
    expect(visibleAssistFavorites(["speed", "win", "hpFull", "escape"], true)).toEqual(["speed", "win", "hpFull", "escape"]);
  });
  it("can put battle controls first during battle", () => {
    expect(visibleAssistFavorites(["speed", "win", "hpFull", "enemyHpLow"], true, { battleFirst: true })).toEqual(["win", "enemyHpLow", "speed", "hpFull"]);
    expect(visibleAssistFavorites(["speed", "win"], false, { battleFirst: true })).toEqual(["speed"]);
  });
  it("drops hidden ids", () => {
    expect(visibleAssistFavorites(["backup", "speed", "restore"], false, { hidden: ["backup", "restore"] })).toEqual(["speed"]);
  });
  it("picks the object particle", () => {
    expect(withObjectParticle("F9")).toBe("F9를");
    expect(withObjectParticle("F10")).toBe("F10을");
  });
});
