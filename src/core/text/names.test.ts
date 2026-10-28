import { beforeAll, describe, expect, it } from "vitest";
import { loadGame } from "../loader/loadGame";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import type { GameData } from "../types";
import { actorName, armorName, itemName, switchName, variableName, weaponName } from "./names";

let data: GameData;
beforeAll(async () => {
  const r = await loadGame(loadFixtureFolder("sample-mz"));
  if (!r.ok) throw new Error("load failed");
  data = r.data;
});

describe("names", () => {
  it("named", () => {
    expect(variableName(data, 1)).toBe("호감도");
    expect(switchName(data, 1)).toBe("숲 개방");
    expect(itemName(data, 1)).toBe("낡은 열쇠");
    expect(actorName(data, 2)).toBe("촌장");
  });
  it("unnamed or missing gives #id", () => {
    expect(switchName(data, 2)).toBe("#2");
    expect(variableName(data, 99)).toBe("#99");
    expect(itemName(data, 999)).toBe("#999");
    expect(weaponName(data, 999)).toBe("#999");
    expect(armorName(data, 999)).toBe("#999");
    expect(actorName(data, 0)).toBe("#0");
    expect(actorName(data, -1)).toBe("#-1");
  });
});
