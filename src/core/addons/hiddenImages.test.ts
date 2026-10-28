import { beforeAll, describe, expect, it } from "vitest";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { loadGame } from "../loader/loadGame";
import type { GameData } from "../types";
import {
  cleanHiddenImages, cleanHiddenPattern, hiddenImageMatcher, matchesHiddenPattern, similarPattern, withHidden,
} from "./hiddenImages";
import { addonsJson, parseAddonFile, type AddonFile } from "./settings";
import { picturesBySeq, roleOf, scenesBySeq, type PictureContext } from "./screenPictures";
import { branchPath, buildHistory, foldTimeline } from "../live/history";
import { readerItems } from "../live/reader";
import type { LogRecord } from "../live/types";

describe("hidden image patterns", () => {
  it("matches exact names and prefix* patterns, ignoring case", () => {
    expect(matchesHiddenPattern("Guage", "Guage")).toBe(true);
    expect(matchesHiddenPattern("guage", "Guage")).toBe(true);
    expect(matchesHiddenPattern("Guageback", "Guage")).toBe(false);
    expect(matchesHiddenPattern("Guageback", "Guage*")).toBe(true);
    expect(matchesHiddenPattern("Guageframe", "guage*")).toBe(true);
    expect(matchesHiddenPattern("Stand", "Guage*")).toBe(false);
    expect(matchesHiddenPattern("", "*")).toBe(false);
    const m = hiddenImageMatcher(["Guage*", "hud_bar"])!;
    expect(["Guage", "Guageback", "Guageframe", "HUD_BAR", "stand"].map(m)).toEqual([true, true, true, true, false]);
    expect(hiddenImageMatcher([])).toBeNull();
    expect(hiddenImageMatcher(null)).toBeNull();
  });

  it("cleans patterns: trims, drops '*' alone, inner stars, non-strings and duplicates", () => {
    expect(cleanHiddenPattern("  Guage* ")).toBe("Guage*");
    expect(cleanHiddenPattern("*")).toBeNull();
    expect(cleanHiddenPattern("Gu*ge")).toBeNull();
    expect(cleanHiddenPattern("")).toBeNull();
    expect(cleanHiddenImages(["Guage*", "guage*", 3, "", "x", "*"])).toEqual(["Guage*", "x"]);
    expect(cleanHiddenImages("Guage")).toEqual([]);
  });

  it("similar names: drops trailing numbers and parenthesized suffixes", () => {
    expect(similarPattern("Guage")).toBe("Guage*");
    expect(similarPattern("Guage01")).toBe("Guage*");
    expect(similarPattern("Guage_2")).toBe("Guage*");
    expect(similarPattern("Guage (2)")).toBe("Guage*");
    expect(similarPattern("Guageback")).toBe("Guageback*");
    expect(similarPattern("ui/bar03")).toBe("ui/bar*");
    expect(similarPattern("123")).toBe("123");
  });

  it("withHidden adds once and folds exact names a new pattern covers", () => {
    expect(withHidden(["Guageback", "stand"], "Guage*")).toEqual(["stand", "Guage*"]);
    expect(withHidden(["Guage*"], "guage*")).toEqual(["Guage*"]);
    expect(withHidden(["a"], "*")).toEqual(["a"]);
  });

  it("a hidden name wins over any other role", () => {
    const ctx: PictureContext = { screen: { width: 816, height: 624 }, roles: { 5: "cg" }, hidden: hiddenImageMatcher(["Guage*"]) };
    const p = { id: 5, name: "Guageframe", origin: 0, x: 0, y: 0, scaleX: 100, scaleY: 100, opacity: 255, blendMode: 0 };
    expect(roleOf(p, ctx)).toBe("hidden");
    expect(roleOf({ ...p, name: "Event" }, ctx)).toBe("cg");
  });
});

describe("addons.json keeps hidden images", () => {
  it("round-trips with every other field (adapterOptions too)", () => {
    const file: AddonFile = {
      state: { screenPictures: true, notices: true },
      pictureRoles: { 101: "hud", 60: "cg" },
      noticeHooks: ["TickerManager.show"],
      spriteRoles: { "organ/": "hidden" },
      adapters: { "ddaggeo-mode": true },
      storyProgress: "v:12",
      hiddenImages: ["Guage*", "Guageback"],
    };
    const body = addonsJson(file.state, file.pictureRoles, file.noticeHooks, file.spriteRoles, file.adapters, file.storyProgress, file.adapterOptions, file.hiddenImages);
    expect(JSON.parse(body).hiddenImages).toEqual(["Guage*", "Guageback"]);
    expect(parseAddonFile(body)).toEqual(file);
    expect(parseAddonFile(addonsJson({}))).not.toHaveProperty("hiddenImages");
    expect(parseAddonFile(JSON.stringify({ v: 1, enabled: {}, hiddenImages: ["*", 5, " a* "] }))?.hiddenImages).toEqual(["a*"]);
  });
});

describe("reader skips hidden images", () => {
  let data: GameData;
  beforeAll(async () => {
    const r = await loadGame(loadFixtureFolder("sample-mz"));
    if (!r.ok) throw new Error("load failed");
    data = r.data;
  });
  const base = { v: 1, run: 1, branch: 1, t: 0 } as const;
  const mapSrc = { source: "map", mapId: 1, eventId: 2, page: 0 } as never;
  const bs = (seq: number): LogRecord => ({ ...base, seq, type: "branchStart", reason: "newGame", parentBranch: null, fromSeq: null });
  const msg = (seq: number, pics: unknown[]): LogRecord =>
    ({ ...base, seq, type: "message", src: mapSrc, cmd: seq, face: "", faceIndex: 0, speaker: "", text: `line ${seq}`, pics }) as LogRecord;
  const screen = (seq: number, pics: unknown[]): LogRecord => ({ ...base, seq, type: "screen", scene: "map", pics }) as LogRecord;
  const STAND = [5, "stand_a", 0, 300, 100, 100, 100, 255, 0, 0, 0, 200, 400];
  const GAUGE = (x: number) => [10, "Guage", 0, x, 500, 100, 100, 255, 0, 0, 0, 200, 40];
  const FRAME = [11, "Guageframe", 0, 0, 500, 100, 100, 255, 0, 0, 0, 220, 50];
  const reader = (recs: LogRecord[], hidden: string[]) => {
    const ctx: PictureContext = { screen: { width: 816, height: 624 }, hidden: hiddenImageMatcher(hidden) };
    const model = buildHistory(recs);
    const path = branchPath(recs, model, 1);
    return readerItems(foldTimeline(path, model, {}), data, new Map(), model, null, scenesBySeq(picturesBySeq(path), ctx));
  };

  it("a snapshot whose only change is a hidden image produces no new picture", () => {
    const recs = [bs(1), msg(2, [STAND]), msg(3, [STAND, GAUGE(0), FRAME]), msg(4, [STAND, GAUGE(40), FRAME]), screen(5, [STAND, GAUGE(80)])];
    const shown = reader(recs, []).filter(i => i.kind === "screen" || ("screen" in i && i.screen));
    expect(shown.length).toBeGreaterThan(1);
    const out = reader(recs, ["Guage*"]);
    const withPics = out.filter(i => i.kind === "screen" || ("screen" in i && i.screen));
    expect(withPics).toHaveLength(1);
    expect(withPics[0]).toMatchObject({ kind: "message", screen: { pictures: [{ name: "stand_a" }] } });
  });

  it("an item whose layers are all hidden disappears", () => {
    const recs = [bs(1), msg(2, [GAUGE(0), FRAME]), screen(3, [FRAME])];
    expect(reader(recs, ["Guage*"]).filter(i => i.kind === "screen" || ("screen" in i && i.screen))).toEqual([]);
  });
});
