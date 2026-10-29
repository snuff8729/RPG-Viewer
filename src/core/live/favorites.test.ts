import { describe, expect, it } from "vitest";
import {
  emptyFavorites, favoriteEntries, favoritesStorageKey, findFavorite, NICKNAME_MAX, parseFavorites, renameFavorite,
  searchWithNicknames, serializeFavorites, toggleFavorite,
} from "./favorites";

const names = ["", "所持金", "攻撃力", "", "好感度"];

describe("toggle / rename", () => {
  it("adds and removes per kind, keeping order", () => {
    let f = toggleFavorite(emptyFavorites(), "variable", 4);
    f = toggleFavorite(f, "variable", 2);
    f = toggleFavorite(f, "switch", 2);
    expect(f.variable.map((x) => x.id)).toEqual([4, 2]);
    expect(f.switch.map((x) => x.id)).toEqual([2]);
    f = toggleFavorite(f, "variable", 4);
    expect(f.variable.map((x) => x.id)).toEqual([2]);
    expect(toggleFavorite(f, "variable", 0)).toBe(f);
  });

  it("sets, trims, clears nicknames and adds when missing", () => {
    let f = renameFavorite(emptyFavorites(), "variable", 2, "  공격력 ");
    expect(findFavorite(f, "variable", 2)).toEqual({ id: 2, nickname: "공격력" });
    f = renameFavorite(f, "variable", 2, "");
    expect(findFavorite(f, "variable", 2)?.nickname).toBe("");
    expect(renameFavorite(f, "variable", 2, "x".repeat(100)).variable[0].nickname.length).toBe(NICKNAME_MAX);
  });
});

describe("storage", () => {
  it("round-trips", () => {
    const f = renameFavorite(toggleFavorite(emptyFavorites(), "switch", 3), "variable", 2, "공격력");
    expect(parseFavorites(serializeFavorites(f))).toEqual(f);
    expect(favoritesStorageKey("g1")).toBe("rpgv.cheatFavorites.g1");
  });

  it("survives broken or odd data", () => {
    expect(parseFavorites(null)).toEqual(emptyFavorites());
    expect(parseFavorites("{nope")).toEqual(emptyFavorites());
    expect(parseFavorites("[1,2]")).toEqual(emptyFavorites());
    expect(parseFavorites("null")).toEqual(emptyFavorites());
    const f = parseFavorites(JSON.stringify({
      switch: "x",
      variable: [5, { id: 2, nickname: 7 }, { id: 2 }, { id: -1 }, { id: 1.5 }, null, { id: 3, nickname: "돈" }],
    }));
    expect(f.switch).toEqual([]);
    expect(f.variable).toEqual([{ id: 5, nickname: "" }, { id: 2, nickname: "" }, { id: 3, nickname: "돈" }]);
  });
});

describe("entries / search", () => {
  const f = renameFavorite(renameFavorite(emptyFavorites(), "variable", 2, "공격력"), "variable", 4, "호감도");

  it("lists favorites with original names", () => {
    expect(favoriteEntries(f, "variable", names)).toEqual([
      { id: 2, name: "攻撃力", nickname: "공격력" }, { id: 4, name: "好感度", nickname: "호감도" },
    ]);
    expect(favoriteEntries(f, "variable", undefined)[0].name).toBe("");
  });

  it("finds by nickname first, then by original name/id without duplicates", () => {
    expect(searchWithNicknames(names, f, "variable", "공격").map((e) => e.id)).toEqual([2]);
    expect(searchWithNicknames(names, f, "variable", "2").map((e) => e.id)).toEqual([2]);
    expect(searchWithNicknames(names, f, "variable", "攻撃").map((e) => e.id)).toEqual([2]);
    expect(searchWithNicknames(names, f, "switch", "공격")).toEqual([]);
    expect(searchWithNicknames(names, f, "variable", "").map((e) => e.id)).toEqual([1, 2, 4, 3]);
  });
});
