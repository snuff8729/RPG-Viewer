import { beforeAll, describe, expect, it } from "vitest";
import { loadGame } from "../loader/loadGame";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import type { GameData } from "../types";
import { formatRich, formatText } from "./escape";
import { DEFAULT_TEXT_PALETTE } from "../assets/textPalette";

let data: GameData;
beforeAll(async () => {
  const r = await loadGame(loadFixtureFolder("sample-mz"));
  if (!r.ok) throw new Error("load failed");
  data = r.data;
});

describe("formatRich", () => {
  const mz = (fontSize?: number): GameData => ({ ...data, engine: "MZ", system: { ...data.system, advanced: { fontSize } } });

  it("uses palette indices 1–31 and resets index 0 to the app foreground", () => {
    const palette = Array.from({ length: 32 }, (_, i) => `#${i.toString(16).padStart(6, "0")}`);
    expect(formatRich("plain\\C[1]one\\C[31]last\\C[0]reset", data, { palette })).toEqual([
      { text: "plain" }, { text: "one", color: palette[1] }, { text: "last", color: palette[31] }, { text: "reset" },
    ]);
    expect(formatRich("\\C[2]fallback", data)).toEqual([{ text: "fallback", color: DEFAULT_TEXT_PALETTE[2] }]);
  });

  it("accepts hex colours and case-insensitive plugin codes", () => {
    expect(formatRich("\\c[#abc]a\\C[#12AbEF]b\\hc[ff0022]c\\HC[#def]d", data)).toEqual([
      { text: "a", color: "#abc" }, { text: "b", color: "#12AbEF" }, { text: "c", color: "#ff0022" }, { text: "d", color: "#def" },
    ]);
  });

  it("keeps the current colour for malformed or out-of-range codes", () => {
    const raw = "\\C[#abc]a\\C[32]b\\C[-1]c\\C[1.5]d\\C[nope]e\\C[#12]f\\HC[gggggg]g\\C[]h\\C<>i";
    expect(formatRich(raw, data)).toEqual([{ text: "abcdefghi", color: "#abc" }]);
    expect(formatRich("\\C[2]a\\C[1]b", data, { palette: ["#ffffff"] })).toEqual([{ text: "ab" }]);
  });

  it("changes font size by 12px relative to MV and MZ defaults", () => {
    for (const [engine, defaultPx] of [["MV", 28], ["MZ", 26]] as const) {
      const game = { ...data, engine, system: { ...data.system, advanced: undefined } };
      expect(formatRich("a\\{b\\}c\\}d", game)).toEqual([
        { text: "a" }, { text: "b", size: (defaultPx + 12) / defaultPx }, { text: "c" }, { text: "d", size: 0.6 },
      ]);
    }
  });

  it("uses MZ advanced.fontSize and absolute FS sizes", () => {
    expect(formatRich("a\\{b\\fs[ 40 ]c\\FS[20]d", mz(20))).toEqual([
      { text: "a" }, { text: "b", size: 1.6 }, { text: "c", size: 2 }, { text: "d" },
    ]);
    expect(formatRich("\\{a", { ...mz(40), engine: "MV" })).toEqual([{ text: "a", size: 40 / 28 }]);
  });

  it("guards brace size changes at engine limits before applying the display clamp", () => {
    expect(formatRich("\\FS[96]\\{a\\{b", mz(100))).toEqual([{ text: "ab", size: 1.08 }]);
    expect(formatRich("\\FS[24]\\}a\\}b", mz(10))).toEqual([{ text: "ab", size: 1.2 }]);
    expect(formatRich("\\FS[97]\\{a", mz(100))).toEqual([{ text: "a", size: 0.97 }]);
    expect(formatRich("\\FS[23]\\}a", mz(20))).toEqual([{ text: "a", size: 1.15 }]);
  });

  it("clamps displayed scales and ignores invalid FS values", () => {
    expect(formatRich("\\FS[9999]big\\FS[0]small\\FS[-1]x\\FS[wat]y\\FS[3.5]z", mz())).toEqual([
      { text: "big", size: 2.5 }, { text: "smallxyz", size: 0.6 },
    ]);
    expect(formatRich(`${"\\{".repeat(30)}big`, mz())).toEqual([{ text: "big", size: 2.5 }]);
    expect(formatRich(`${"\\}".repeat(30)}small`, mz())).toEqual([{ text: "small", size: 0.6 }]);
    for (const fontSize of [0, -1, NaN, Infinity]) {
      expect(formatRich("\\FS[26]a", mz(fontSize))).toEqual([{ text: "a" }]);
    }
  });

  it("preserves style across newlines and resets it for every message", () => {
    expect(formatRich("\\C[#abc]\\{first\n\nlast", mz())).toEqual([{ text: "first\n\nlast", color: "#abc", size: 38 / 26 }]);
    expect(formatRich("next", mz())).toEqual([{ text: "next" }]);
    expect(formatRich("\\C[2]\\FS[40]", mz())).toEqual([]);
    expect(formatRich("", mz())).toEqual([]);
  });

  it.each([
    "\\N[1] \\N[99] \\n[1] \\N[\\V[1]] \\N[custom]",
    "\\V[1] \\V[7] \\V[\\N[1]] \\P[2] 10\\G \\\\ \\N \\V \\P[bad]",
    "a\\I[2]b\\MSGCore<x>c\\.\\|\\!\\>\\<\\^\\$\\{d\\}e",
    "\\C[2]colour\\C[0] \\HC[abcdef]hex \\FS[40]size\nnext",
    "literal \\\\C[2] and \\\\{ and \\? and trailing\\",
    "\\N[\\C[2]name] \\V[\\FS[20]label]",
  ])("has exactly the same substitutions and stripped text as formatText: %s", raw => {
    expect(formatRich(raw, data).map(s => s.text).join("")).toBe(formatText(raw, data));
  });

  it("does not reinterpret escape codes inside substituted actor names", () => {
    const game = { ...data, actors: [null, { ...data.actors[1]!, name: "\\C[2]actor" }] };
    expect(formatRich("\\C[#abc]\\N[1]", game)).toEqual([{ text: "\\C[2]actor", color: "#abc" }]);
  });
});

describe("formatText", () => {
  it("replaces actor names", () => expect(formatText("왔구나, \\N[1].", data)).toBe("왔구나, 레나."));
  it("shows variables by name", () => expect(formatText("\\V[1]만큼", data)).toBe("[변수: 호감도]만큼"));
  it("falls back to #id for unnamed", () => expect(formatText("\\V[7]", data)).toBe("[변수: #7]"));
  it("strips color and wait codes", () => expect(formatText("\\C[2]보상\\C[0]\\.\\|!", data)).toBe("보상!"));
  it("strips unknown plugin codes", () => expect(formatText("a\\FS[20]b\\MSGCore<x>c", data)).toBe("abc"));
  it("handles currency, party, backslash", () => expect(formatText("10\\G \\P[2] \\\\", data)).toBe("10G [파티원 2] \\"));
  it("is case-insensitive", () => expect(formatText("\\n[1]", data)).toBe("레나"));
  it("unknown actor gives #id", () => expect(formatText("\\N[99]", data)).toBe("#99"));
  it("strips symbol codes", () => expect(formatText("a\\{b\\}c\\>d\\<e\\^f\\$g", data)).toBe("abcdefg"));
  it("nested \\V in \\N arg becomes variable placeholder", () => expect(formatText("\\N[\\V[1]]", data)).toBe("[변수: 호감도]"));
  it("never throws on trailing backslash", () => expect(formatText("abc\\", data)).toBe("abc"));
});
