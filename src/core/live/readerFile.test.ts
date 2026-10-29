import { describe, expect, it } from "vitest";
import {
  applyReaderOps, compactReaderOps, legacyHideRules, mergeReaderFile, nextReaderT, parseReaderFile, parseReaderOps, READER_OPS_COMPACT_AT,
  readerNeedsWrite, readerPendingKey, resolveReader, serializeReaderFile, type Bookmark, type HideRule, type ReaderOp,
} from "./readerFile";
import { readFavoritesText } from "./favoritesFile";
import { livePaths } from "./installer";
import type { GameFolder } from "../fs/folder";

const bm = (id: string, seq: number, name = "이름"): Bookmark => ({ id, branch: 1, seq, name, t: 5 });
const exact = (id: string, text: string): HideRule => ({ id, kind: "exact", text, t: 1 });

describe("reader.json path", () => {
  it("lives next to favorites.json", () => {
    expect(livePaths("www/data").readerFile).toBe("www/rpg-viewer/reader.json");
    expect(livePaths("data").readerFile).toBe("rpg-viewer/reader.json");
    expect(readerPendingKey("g")).toBe("rpgv.readerPending.g");
  });
});

describe("parse / serialize", () => {
  it("round-trips", () => {
    const s = { bookmarks: [bm("a", 10, "레이: 안녕")], hide: [exact("h", "골드 획득"), { id: "d", kind: "digits", pattern: "골드 # 획득", t: 2 } as HideRule, { id: "t", kind: "type", type: "battle", t: 3 } as HideRule], chapterVar: 12 };
    const text = serializeReaderFile(s, 42);
    expect(JSON.parse(text)).toMatchObject({ v: 1, t: 42, chapterVar: 12 });
    expect(parseReaderFile(text)).toEqual({ ...s, t: 42 });
  });

  it("treats a missing hide section as absent (legacy rules apply)", () => {
    const f = parseReaderFile(JSON.stringify({ v: 1, bookmarks: [], t: 1 }));
    expect(f).toEqual({ bookmarks: [], hide: null, chapterVar: null, t: 1 });
    const legacy = legacyHideRules({});
    expect(resolveReader(f, legacy).hide).toEqual(legacy);
    expect(resolveReader({ bookmarks: [], hide: [], chapterVar: null, t: 1 }, legacy).hide).toEqual([]);
  });

  it("never throws on broken files and drops bad entries", () => {
    for (const raw of [null, undefined, "", " ", "{x", "null", "[]", "3", JSON.stringify({ v: 2 })]) expect(parseReaderFile(raw)).toBeNull();
    const f = parseReaderFile(JSON.stringify({
      v: 1,
      bookmarks: [null, { id: "a", branch: 1, seq: 3, name: "  긴   이름 " }, { id: "a", branch: 1, seq: 4 }, { id: "b", branch: -1, seq: 1 }, { id: "", branch: 1, seq: 1 }],
      hide: [{ id: "x", kind: "exact", text: "" }, { id: "y", kind: "type", type: "battle" }, { id: "z", kind: "type", type: "battle" }, { id: "w", kind: "nope" }],
      chapterVar: -3, t: "x",
    }));
    expect(f).toEqual({ bookmarks: [{ id: "a", branch: 1, seq: 3, name: "긴 이름", t: 0 }], hide: [{ id: "y", kind: "type", type: "battle", t: 0 }], chapterVar: null, t: 0 });
  });
});

describe("ops", () => {
  const base = resolveReader(null);

  it("adds, renames, removes bookmarks idempotently", () => {
    const ops: ReaderOp[] = [{ op: "bookmark", bookmark: bm("a", 1) }, { op: "bookmark", bookmark: bm("a", 1) }, { op: "bookmark", bookmark: bm("b", 2) }, { op: "rename", id: "a", name: "새 이름" }];
    const s = applyReaderOps(base, ops);
    expect(s.bookmarks.map((b) => [b.id, b.name])).toEqual([["a", "새 이름"], ["b", "이름"]]);
    expect(applyReaderOps(s, [{ op: "unbookmark", id: "a" }, { op: "unbookmark", id: "a" }]).bookmarks.map((b) => b.id)).toEqual(["b"]);
    // 빈 이름으로는 바꾸지 않는다
    expect(applyReaderOps(s, [{ op: "rename", id: "b", name: "   " }]).bookmarks[1].name).toBe("이름");
  });

  it("does not add a second rule for the same thing", () => {
    const s = applyReaderOps(base, [{ op: "hide", rule: exact("1", "a") }, { op: "hide", rule: exact("2", "a") }, { op: "hide", rule: exact("3", "b") }]);
    expect(s.hide.map((r) => r.id)).toEqual(["1", "3"]);
    expect(applyReaderOps(s, [{ op: "unhide", id: "1" }]).hide.map((r) => r.id)).toEqual(["3"]);
  });

  it("sets the chapter variable", () => {
    expect(applyReaderOps(base, [{ op: "chapterVar", id: 7 }]).chapterVar).toBe(7);
    expect(applyReaderOps(base, [{ op: "chapterVar", id: 7 }, { op: "chapterVar", id: null }]).chapterVar).toBeNull();
  });

  it("parses stored ops and drops bad ones", () => {
    const ops: ReaderOp[] = [{ op: "bookmark", bookmark: bm("a", 1) }, { op: "hide", rule: exact("h", "x") }, { op: "chapterVar", id: null }, { op: "unhide", id: "h" }];
    expect(parseReaderOps(JSON.stringify([...ops, { op: "bookmark" }, { op: "chapterVar", id: -1 }, 3, null]))).toEqual(ops);
    for (const raw of [null, "", "{", "{}"]) expect(parseReaderOps(raw)).toEqual([]);
  });

  it("compacts long op lists into whole lists", () => {
    const ops: ReaderOp[] = [];
    for (let i = 0; i <= READER_OPS_COMPACT_AT; i++) ops.push({ op: "bookmark", bookmark: bm(`b${i}`, i) });
    ops.push({ op: "hide", rule: exact("h", "x") });
    const state = applyReaderOps(base, ops);
    const c = compactReaderOps(ops, state);
    expect(c.map((o) => o.op)).toEqual(["bookmarkSet", "hideSet"]);
    expect(applyReaderOps(base, c)).toEqual(state);
  });
});

describe("merge (read-before-write)", () => {
  it("puts this viewer's changes on top of the disk file", () => {
    const disk = parseReaderFile(serializeReaderFile({ bookmarks: [bm("other", 9)], hide: [exact("o", "남의 규칙")], chapterVar: 3 }, 10));
    const merged = mergeReaderFile(disk, [{ op: "bookmark", bookmark: bm("mine", 1) }, { op: "hide", rule: exact("m", "내 규칙") }]);
    expect(merged.bookmarks.map((b) => b.id)).toEqual(["other", "mine"]);
    expect(merged.hide.map((r) => r.id)).toEqual(["o", "m"]);
    expect(merged.chapterVar).toBe(3);
    expect(nextReaderT(disk, 5)).toBe(11);
    expect(nextReaderT(null, 5)).toBe(5);
  });

  it("writes legacy rules with the first file", () => {
    const legacy = legacyHideRules({ battlesShown: false });
    expect(readerNeedsWrite(null, [], legacy)).toBe(false);
    expect(readerNeedsWrite(null, [{ op: "chapterVar", id: 4 }], legacy)).toBe(true);
    expect(mergeReaderFile(null, [{ op: "chapterVar", id: 4 }], legacy).hide).toEqual(legacy);
    // 디스크에 규칙 칸이 있으면 예전 설정은 쓰지 않는다
    const disk = parseReaderFile(serializeReaderFile({ bookmarks: [], hide: [], chapterVar: null }, 1));
    expect(mergeReaderFile(disk, [{ op: "chapterVar", id: 4 }], legacy).hide).toEqual([]);
    // 이미 디스크와 같으면 쓰지 않는다
    expect(readerNeedsWrite(disk, [{ op: "chapterVar", id: null }], legacy)).toBe(false);
  });

  it("tells a missing file apart from a failed read (never overwrite after a failed read)", async () => {
    const strict = (r: ArrayBuffer | null | Error) => ({ readBinaryStrict: async () => { if (r instanceof Error) throw r; return r; } }) as unknown as GameFolder;
    expect(await readFavoritesText(strict(null), "p")).toEqual({ state: "missing" });
    expect(await readFavoritesText(strict(new Error("net")), "p")).toEqual({ state: "failed" });
    expect(await readFavoritesText(strict(new TextEncoder().encode("{}").buffer as ArrayBuffer), "p")).toEqual({ state: "ok", text: "{}" });
    // readText만 있으면 null은 없음인지 실패인지 모른다 → failed
    expect(await readFavoritesText({ readText: async () => null } as unknown as GameFolder, "p")).toEqual({ state: "failed" });
  });
});

describe("legacy display settings → hide rules", () => {
  const types = (l: Parameters<typeof legacyHideRules>[0]) => legacyHideRules(l).map((r) => (r.kind === "type" ? r.type : r.kind));

  it("keeps hiding what is hidden today (technical plugin commands by default)", () => {
    expect(types({})).toEqual(["plugin-tech"]);
    expect(types(null)).toEqual(["plugin-tech"]);
    expect(types({ showAllPlugins: true, battlesShown: true, noticesShown: true })).toEqual([]);
  });

  it("moves battle / notice switches, notice kinds and per-command hides", () => {
    expect(types({ showAllPlugins: true, battlesShown: false, noticesShown: false, hiddenNoticeKinds: ["gain"] })).toEqual(["battle", "notice"]);
    expect(types({ hiddenNoticeKinds: ["gain", "quest"], hiddenPlugins: ["ShowTip", "ShowTip"] }))
      .toEqual(["plugin-tech", "plugin:ShowTip", "notice-kind:gain", "notice-kind:quest"]);
    // 같은 예전 설정이면 같은 id(여러 화면에서 옮겨도 겹치지 않는다)
    expect(legacyHideRules({ battlesShown: false }).map((r) => r.id)).toEqual(["legacy-plugin-tech", "legacy-battle"]);
  });
});
