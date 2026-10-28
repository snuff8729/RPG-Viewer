import { describe, expect, it } from "vitest";
import type { GameIndex, Location, PageEntry, ScriptNode } from "../types";
import { controlJson, DEFAULT_ASSIST, normalizeAssist, seenSets, versionAtLeast } from "./assist";
import { pageNewCounts } from "./interactable";
import type { Coverage, PickInfo } from "./types";

const page = (location: Location, nodes: ScriptNode[]): PageEntry =>
  ({ location, path: "", title: "", nodes, conditions: [], hasDialogue: true });
const msg = (cmd: number): ScriptNode => ({ kind: "message", cmd, lines: ["x"] });
const pick = (picked: number): PickInfo => ({ picked, run: 1, branch: 1, seq: 1, aftermath: [] });
const cov = (seen: string[], picks: [string, number[]][] = []): Coverage => ({
  seen: new Set(seen), picks: new Map(picks.map(([k, ps]) => [k, ps.map(pick)])),
  uncertainSeqs: new Set(), changedSeqs: new Set(),
});
const idx = (pages: PageEntry[]) => ({ pages }) as unknown as GameIndex;

const M: Location = { source: "map", mapId: 3, eventId: 5, page: 0 };
const C: Location = { source: "common", commonEventId: 7 };
const T2: Location = { source: "troop", troopId: 2, page: 0 };
const T2b: Location = { source: "troop", troopId: 2, page: 1 };
const choicePage = page(M, [
  msg(1),
  { kind: "choices", cmd: 2, branches: [{ label: "a", body: [msg(3)] }, { label: "b", body: [] }], cancelBranch: [msg(5)] },
]);

describe("pageNewCounts", () => {
  it("default ignores unseen lines inside choice branches; inChoices counts them", () => {
    const c = cov(["map:3:5:0#1"], [["map:3:5:0#2", [0, 1, -2]]]);
    expect(pageNewCounts(choicePage, c)).toEqual({ unseen: 0, unpicked: 0, dialogue: 4 });
    expect(pageNewCounts(choicePage, c, { inChoices: true })).toEqual({ unseen: 2, unpicked: 0, dialogue: 4 });
  });
  it("odd input never throws", () => {
    expect(pageNewCounts(null as unknown as PageEntry, cov([]))).toEqual({ unseen: 0, unpicked: 0, dialogue: 0 });
    expect(pageNewCounts(choicePage, null as unknown as Coverage).dialogue).toBe(0);
  });
});

describe("seenSets", () => {
  it("seenMessages = coverage.seen sorted", () => {
    expect(seenSets(cov(["b#1", "a#2"]), idx([])).seenMessages).toEqual(["a#2", "b#1"]);
  });
  it("page is fully seen only with every line (incl. in branches) seen and every option (incl. cancel) picked", () => {
    const all = ["map:3:5:0#1", "map:3:5:0#3", "map:3:5:0#5"];
    expect(seenSets(cov(all, [["map:3:5:0#2", [0, 1, -2]]]), idx([choicePage])).seenPages).toEqual(["map:3:5:0"]);
    expect(seenSets(cov(all, [["map:3:5:0#2", [0, 1]]]), idx([choicePage])).seenPages).toEqual([]);
    expect(seenSets(cov(all.slice(0, 2), [["map:3:5:0#2", [0, 1, -2]]]), idx([choicePage])).seenPages).toEqual([]);
  });
  it("pages without messages/choices are never listed", () => {
    const empty = page(C, [{ kind: "picture", cmd: 1, pictureId: 1, name: "p" }]);
    expect(seenSets(cov([]), idx([empty])).seenPages).toEqual([]);
    const common = page(C, [msg(4)]);
    expect(seenSets(cov(["common:7#4"]), idx([common])).seenPages).toEqual(["common:7"]);
  });
  it("troop pages are listed like any other page (no troop list: battles are never auto-sped)", () => {
    const pages = [page(T2, [msg(1)]), page(T2b, [msg(2)])];
    const r = seenSets(cov(["troop:2:0#1"]), idx(pages));
    expect(r.seenPages).toEqual(["troop:2:0"]);
    expect(Object.keys(r)).toEqual(["seenMessages", "seenPages"]);
  });
  it("never throws on odd input", () => {
    const bad = seenSets(null as unknown as Coverage, null as unknown as GameIndex);
    expect(bad).toEqual({ seenMessages: [], seenPages: [] });
    const odd = idx([null as unknown as PageEntry, { location: null } as unknown as PageEntry, page(M, null as unknown as ScriptNode[])]);
    expect(seenSets(cov([]), odd).seenPages).toEqual([]);
  });
});

describe("controlJson", () => {
  it("writes the v1 contract", () => {
    const j = JSON.parse(controlJson(DEFAULT_ASSIST, { seenMessages: ["a#1"], seenPages: ["common:7"] }, { id: "c-1", kind: "win" }, 123));
    expect(j).toEqual({
      v: 1, t: 123, speed: 1, skipSeen: true, autoFast: true, autoSpeed: 8,
      seenMessages: ["a#1"], seenPages: ["common:7"], command: { id: "c-1", kind: "win" },
    });
  });
  it("sanitizes bad settings/commands", () => {
    const j = JSON.parse(controlJson({ speed: 3, autoSpeed: 1 } as never, null as never, { id: "x", kind: "boom" } as never, NaN));
    expect(j).toMatchObject({ t: 0, speed: 1, autoSpeed: 8, seenMessages: [], command: null });
  });
});

describe("normalizeAssist / versionAtLeast", () => {
  it("normalizes stored values", () => {
    expect(normalizeAssist(null)).toEqual(DEFAULT_ASSIST);
    expect(normalizeAssist({ speed: 4, skipSeen: false, autoFast: false, autoSpeed: 2 }))
      .toEqual({ speed: 4, skipSeen: false, autoFast: false, autoSpeed: 2 });
    expect(normalizeAssist({ speed: "4", autoSpeed: 16 })).toEqual(DEFAULT_ASSIST);
  });
  it("compares versions", () => {
    expect(versionAtLeast("1.1.0", "1.1.0")).toBe(true);
    expect(versionAtLeast("1.10.0", "1.9.0")).toBe(true);
    expect(versionAtLeast("1.0.5", "1.1.0")).toBe(false);
    expect(versionAtLeast("2", "1.1.0")).toBe(true);
    expect(versionAtLeast(null, "1.1.0")).toBe(false);
    expect(versionAtLeast("1.1.0-beta", "1.1.0")).toBe(false);
  });
});
