import { beforeAll, describe, expect, it } from "vitest";
import { loadGame } from "../loader/loadGame";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import type { GameData } from "../types";
import { formatText } from "./escape";

let data: GameData;
beforeAll(async () => {
  const r = await loadGame(loadFixtureFolder("sample-mz"));
  if (!r.ok) throw new Error("load failed");
  data = r.data;
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
