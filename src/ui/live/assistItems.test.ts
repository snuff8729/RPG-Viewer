import { describe, expect, it } from "vitest";
import { ASSIST_FAVORITE_IDS } from "@/core/live/favoritesFile";
import { ASSIST_ITEMS, assistFavoriteLabel, assistFavoriteShortLabel, BACKUP_ITEMS, battleBarLabel, BATTLE_BAR_ITEMS, commandBlockReason, pinnable, quickBarItems, withObjectParticle } from "./assistItems";

describe("assist favorites bar items", () => {
  it("every favorite id has a control and a label", () => {
    const ids = new Set<string>([...ASSIST_ITEMS, ...BACKUP_ITEMS].map((i) => i.id));
    for (const id of ASSIST_FAVORITE_IDS) {
      expect(ids.has(id)).toBe(true);
      expect(assistFavoriteLabel(id)).not.toBe(id);
      expect(assistFavoriteShortLabel(id)).not.toBe(id);
      expect(assistFavoriteShortLabel(id).length).toBeLessThanOrEqual(assistFavoriteLabel(id).length);
    }
  });
  it("uses short names in the bar", () => {
    expect(ASSIST_FAVORITE_IDS).toContain("walkSpeed");
    expect(assistFavoriteLabel("walkSpeed")).toBe("이동 속도");
    expect(assistFavoriteShortLabel("walkSpeed")).toBe("이동 속도");
    expect(assistFavoriteShortLabel("skipSeen")).toBe("넘기기");
    expect(assistFavoriteShortLabel("enemyHpFull")).toBe("적 HP 100%");
    expect(assistFavoriteShortLabel("restore")).toBe("복원");
  });
  it("keeps battle controls off the normal bar, keeps order", () => {
    expect(quickBarItems(["walkSpeed", "win", "speed"])).toEqual(["walkSpeed", "speed"]);
    expect(quickBarItems(["speed", "win", "hpFull", "escape"])).toEqual(["speed", "hpFull"]);
    expect(pinnable("win")).toBe(false);
    expect(pinnable("hpFull")).toBe(true);
  });
  it("drops hidden ids", () => {
    expect(quickBarItems(["backup", "speed", "restore"], { hidden: ["backup", "restore"] })).toEqual(["speed"]);
  });
  it("battle bar order and labels", () => {
    expect([...BATTLE_BAR_ITEMS]).toEqual(["win", "escape", "lose", "enemyHpLow", "enemyHpFull", "hpFull"]);
    expect(battleBarLabel("hpFull")).toBe("내 체력 100%");
    expect(battleBarLabel("enemyHpLow")).toBe("적 체력 1%");
  });
  it("explains why a command is unavailable", () => {
    const g = { supported: true, inBattle: false, canEscape: true, hpSupported: true, saveSupported: true, enemyHpSupported: true };
    expect(commandBlockReason("win", g)).toBe("전투 중에만 쓸 수 있어요");
    expect(commandBlockReason("win", { ...g, inBattle: true })).toBeNull();
    expect(commandBlockReason("escape", { ...g, inBattle: true, canEscape: false })).toBe("이 전투는 도망칠 수 없어요");
    expect(commandBlockReason("enemyHpLow", { ...g, inBattle: true, enemyHpSupported: false })).toContain("1.23.0");
    expect(commandBlockReason("hpFull", g)).toBeNull();
    expect(commandBlockReason("quickSave", { ...g, supported: false })).toContain("1.1.0");
  });
  it("picks the object particle", () => {
    expect(withObjectParticle("F9")).toBe("F9를");
    expect(withObjectParticle("F10")).toBe("F10을");
  });
});
