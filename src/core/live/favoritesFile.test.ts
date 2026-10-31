import { describe, expect, it } from "vitest";
import { emptyFavorites, parseFavorites, renameFavorite, serializeFavorites, toggleFavorite } from "./favorites";
import {
  applyFavoritesOps, ASSIST_FAVORITE_IDS, battleOnly, compactFavoritesOps, DEFAULT_ASSIST_FAVORITES, favoritesNeedWrite,
  favoritesPendingKey, isAssistFavoriteId, mergeFavorites, nextFavoritesT, OPS_COMPACT_AT, parseFavoritesFile, parseFavoritesOps, readFavoritesText,
  resolveFavorites, serializeFavoritesFile, type FavoritesOp,
} from "./favoritesFile";
import { livePaths } from "./installer";

describe("assist favorites ids / defaults", () => {
  it("has the default top-bar list, all valid ids", () => {
    expect(DEFAULT_ASSIST_FAVORITES).toEqual(["speed", "skipSeen", "autoFast", "win", "lose", "escape", "enemyHpFull", "enemyHpLow", "hpFull", "hpLow"]);
    for (const id of DEFAULT_ASSIST_FAVORITES) expect(ASSIST_FAVORITE_IDS).toContain(id);
    expect(isAssistFavoriteId("backup")).toBe(true);
    expect(isAssistFavoriteId("walkSpeed")).toBe(true);
    const saved = serializeFavoritesFile({ assist: ["speed", "walkSpeed"], cheat: null }, 3);
    expect(parseFavoritesFile(saved)?.assist).toEqual(["speed", "walkSpeed"]);
    expect(isAssistFavoriteId("autoSpeed")).toBe(false);
    expect(isAssistFavoriteId(null)).toBe(false);
  });

  it("marks battle-only controls", () => {
    expect(ASSIST_FAVORITE_IDS.filter(battleOnly)).toEqual(["win", "lose", "escape", "enemyHpFull", "enemyHpLow"]);
    expect(battleOnly("hpFull")).toBe(false);
  });

  it("uses defaults when the file has no assist section", () => {
    expect(resolveFavorites(null).assist).toEqual(DEFAULT_ASSIST_FAVORITES);
    expect(resolveFavorites({ assist: null, cheat: null, t: 1 }).assist).toEqual(DEFAULT_ASSIST_FAVORITES);
    expect(resolveFavorites({ assist: [], cheat: null, t: 1 }).assist).toEqual([]);
  });

  it("has the favorites path next to control.json", () => {
    expect(livePaths("www/data").favoritesFile).toBe("www/rpg-viewer/favorites.json");
    expect(livePaths("data").favoritesFile).toBe("rpg-viewer/favorites.json");
    expect(favoritesPendingKey("g")).toBe("rpgv.favoritesPending.g");
  });
});

describe("parse / serialize", () => {
  it("round-trips", () => {
    const cheat = renameFavorite(toggleFavorite(emptyFavorites(), "switch", 3), "variable", 2, "공격력");
    const text = serializeFavoritesFile({ assist: ["hpLow", "speed"], cheat }, 42);
    expect(JSON.parse(text)).toEqual({
      v: 1, assist: { items: ["hpLow", "speed"] },
      cheat: { switches: [{ id: 3 }], variables: [{ id: 2, nick: "공격력" }] }, t: 42,
    });
    expect(parseFavoritesFile(text)).toEqual({ assist: ["hpLow", "speed"], cheat, t: 42 });
  });

  it("leaves absent sections absent", () => {
    const text = serializeFavoritesFile({ assist: null, cheat: null }, 1);
    expect(JSON.parse(text)).toEqual({ v: 1, t: 1 });
    expect(parseFavoritesFile(text)).toEqual({ assist: null, cheat: null, t: 1 });
  });

  it("never throws on broken files", () => {
    for (const raw of [null, undefined, "", "  ", "{nope", "null", "[1]", "1", '"x"', JSON.stringify({ v: 2 }), JSON.stringify({ assist: { items: [] } })]) {
      expect(parseFavoritesFile(raw)).toBeNull();
    }
    const f = parseFavoritesFile(JSON.stringify({
      v: 1, assist: { items: ["speed", "nope", 3, "speed", "win"] },
      cheat: { switches: "x", variables: [5, { id: 2, nick: 7 }, { id: 2 }, { id: -1 }, null, { id: 3, nick: " 돈 " }] }, t: "x",
    }));
    expect(f).toEqual({ assist: ["speed", "win"], cheat: { switch: [], variable: [{ id: 5, nickname: "" }, { id: 2, nickname: "" }, { id: 3, nickname: "돈" }] }, t: 0 });
    expect(parseFavoritesFile(JSON.stringify({ v: 1, assist: [1], cheat: "x" }))).toEqual({ assist: null, cheat: null, t: 0 });
  });
});

describe("ops", () => {
  it("applies idempotently", () => {
    const ops: FavoritesOp[] = [
      { op: "assist", id: "speed", on: false }, { op: "assist", id: "backup", on: true },
      { op: "cheat", kind: "variable", id: 7, on: true }, { op: "nick", kind: "variable", id: 7, nick: "돈" },
      { op: "nick", kind: "switch", id: 2, nick: "문" },
    ];
    const once = applyFavoritesOps(resolveFavorites(null), ops);
    expect(applyFavoritesOps(once, ops)).toEqual(once);
    expect(once.assist).toEqual([...DEFAULT_ASSIST_FAVORITES.filter((x) => x !== "speed"), "backup"]);
    expect(once.cheat).toEqual({ switch: [{ id: 2, nickname: "문" }], variable: [{ id: 7, nickname: "돈" }] });
    const off = applyFavoritesOps(once, [{ op: "cheat", kind: "variable", id: 7, on: false }, { op: "assistOrder", items: ["hpLow", "win"] }]);
    expect(off.cheat.variable).toEqual([]);
    expect(off.assist).toEqual(["hpLow", "win"]);
  });

  it("parses stored ops defensively", () => {
    const ops: FavoritesOp[] = [
      { op: "assist", id: "win", on: true }, { op: "assistOrder", items: ["win"] }, { op: "cheat", kind: "switch", id: 1, on: true },
      { op: "nick", kind: "variable", id: 2, nick: "x" }, { op: "cheatSet", favorites: renameFavorite(emptyFavorites(), "variable", 4, "y") },
    ];
    expect(parseFavoritesOps(JSON.stringify(ops))).toEqual(ops);
    expect(parseFavoritesOps("{bad")).toEqual([]);
    expect(parseFavoritesOps(null)).toEqual([]);
    expect(parseFavoritesOps(JSON.stringify([{ op: "assist", id: "nope", on: true }, { op: "cheat", kind: "x", id: 1, on: true }, 3, null]))).toEqual([]);
  });

  it("compacts long op lists into whole-list ops with the same result", () => {
    const ops: FavoritesOp[] = [];
    for (let i = 0; i <= OPS_COMPACT_AT; i++) ops.push({ op: "cheat", kind: "variable", id: (i % 7) + 1, on: i % 3 !== 0 });
    ops.push({ op: "assist", id: "speed", on: false });
    const state = applyFavoritesOps(resolveFavorites(null), ops);
    const c = compactFavoritesOps(ops, state);
    expect(c.length).toBe(2);
    expect(applyFavoritesOps(resolveFavorites(null), c)).toEqual(state);
    expect(compactFavoritesOps(ops.slice(0, 3), state)).toEqual(ops.slice(0, 3));
  });
});

describe("merge (read-modify-write)", () => {
  const disk = parseFavoritesFile(serializeFavoritesFile({
    assist: ["speed", "win"], cheat: renameFavorite(emptyFavorites(), "variable", 3, "돈"),
  }, 100))!;

  it("keeps another viewer's changes and adds only ours", () => {
    // 이 뷰어: 변수 9를 넣고 hpFull을 올렸다. 그 사이 다른 뷰어가 디스크에 변수 3(별명 돈)과 win을 넣었다.
    const m = mergeFavorites(disk, [{ op: "cheat", kind: "variable", id: 9, on: true }, { op: "assist", id: "hpFull", on: true }]);
    expect(m.assist).toEqual(["speed", "win", "hpFull"]);
    expect(m.cheat?.variable).toEqual([{ id: 3, nickname: "돈" }, { id: 9, nickname: "" }]);
  });

  it("writes only when content changes, with a later t", () => {
    expect(favoritesNeedWrite(disk, [])).toBe(false);
    expect(favoritesNeedWrite(disk, [{ op: "assist", id: "win", on: true }])).toBe(false);
    expect(favoritesNeedWrite(disk, [{ op: "assist", id: "win", on: false }])).toBe(true);
    expect(nextFavoritesT(disk, 50)).toBe(101);
    expect(nextFavoritesT(null, 50)).toBe(50);
    expect(favoritesNeedWrite(null, [])).toBe(false);
  });

  it("does not freeze default assist favorites into the file unless changed", () => {
    const m = mergeFavorites(null, [{ op: "cheat", kind: "switch", id: 1, on: true }]);
    expect(m.assist).toBeNull();
    expect(m.cheat?.switch).toEqual([{ id: 1, nickname: "" }]);
    const a = mergeFavorites(null, [{ op: "assist", id: "speed", on: false }]);
    expect(a.assist).toEqual(DEFAULT_ASSIST_FAVORITES.filter((x) => x !== "speed"));
    expect(a.cheat).toBeNull();
  });

  it("treats a broken file as absent", () => {
    expect(mergeFavorites(parseFavoritesFile("{broken"), [{ op: "assist", id: "backup", on: true }]).assist).toEqual([...DEFAULT_ASSIST_FAVORITES, "backup"]);
  });
});

describe("migration from localStorage cheat favorites", () => {
  const legacy = parseFavorites(serializeFavorites(renameFavorite(toggleFavorite(emptyFavorites(), "switch", 4), "variable", 2, "공격력")));

  it("shows and writes the old favorites when the file has no cheat section", () => {
    expect(resolveFavorites(null, legacy).cheat).toEqual(legacy);
    expect(favoritesNeedWrite(null, [], legacy)).toBe(true);
    const m = mergeFavorites(null, [], legacy);
    expect(m).toEqual({ assist: null, cheat: legacy });
    const onlyAssist = parseFavoritesFile(serializeFavoritesFile({ assist: ["win"], cheat: null }, 5));
    expect(mergeFavorites(onlyAssist, [], legacy)).toEqual({ assist: ["win"], cheat: legacy });
  });

  it("imports only once: an existing cheat section wins", () => {
    const written = parseFavoritesFile(serializeFavoritesFile({ assist: null, cheat: emptyFavorites() }, 5));
    expect(resolveFavorites(written, legacy).cheat).toEqual(emptyFavorites());
    expect(favoritesNeedWrite(written, [], legacy)).toBe(false);
  });

  it("does nothing for empty old favorites", () => {
    expect(favoritesNeedWrite(null, [], emptyFavorites())).toBe(false);
    expect(favoritesNeedWrite(null, [], null)).toBe(false);
  });
});

describe("readFavoritesText (missing vs failed)", () => {
  const base = { readBinary: async () => null, list: async () => [] };
  const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

  it("uses the strict read: null = missing, throw = failed", async () => {
    expect(await readFavoritesText({ ...base, readText: async () => null, readBinaryStrict: async () => enc('{"v":1}') }, "p")).toEqual({ state: "ok", text: '{"v":1}' });
    expect(await readFavoritesText({ ...base, readText: async () => null, readBinaryStrict: async () => null }, "p")).toEqual({ state: "missing" });
    expect(await readFavoritesText({ ...base, readText: async () => "x", readBinaryStrict: async () => { throw new Error("net"); } }, "p")).toEqual({ state: "failed" });
  });

  it("without a strict read, null is uncertain (failed), not missing", async () => {
    expect(await readFavoritesText({ ...base, readText: async () => null }, "p")).toEqual({ state: "failed" });
    expect(await readFavoritesText({ ...base, readText: async () => "t" }, "p")).toEqual({ state: "ok", text: "t" });
    expect(await readFavoritesText({ ...base, readText: async () => { throw new Error("x"); } }, "p")).toEqual({ state: "failed" });
  });
});
