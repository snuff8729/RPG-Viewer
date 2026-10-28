import { beforeAll, describe, expect, it } from "vitest";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { loadGame } from "../loader/loadGame";
import type { GameData } from "../types";
import {
  parsePic, picturesBySeq, roleOf, scenesBySeq, seenPictures, seenSprites, spriteKeyOf, type PictureContext,
} from "../addons/screenPictures";
import { addonsJson, parseAddonFile } from "../addons/settings";
import { branchPath, buildHistory, foldTimeline, isContinuation } from "./history";
import { readerItems, type ReaderItem } from "./reader";
import type { HistoryItem, LogRecord } from "./types";
import { readStats } from "../../ui/live/readerWindow";
import { ALL_KINDS, filterItems } from "../../ui/live/historyFilter";

let data: GameData;
beforeAll(async () => {
  const r = await loadGame(loadFixtureFolder("sample-mz"));
  if (!r.ok) throw new Error("load failed");
  data = r.data;
});

const base = { v: 1, run: 1, branch: 1, t: 0 } as const;
const mapSrc = { source: "map", mapId: 1, eventId: 2, page: 0 } as never;
const bs = (seq: number): LogRecord => ({ ...base, seq, type: "branchStart", reason: "newGame", parentBranch: null, fromSeq: null });
const msg = (seq: number, cmd: number, extra: object = {}): LogRecord =>
  ({ ...base, seq, type: "message", src: mapSrc, cmd, face: "", faceIndex: 0, speaker: "", text: `line ${cmd}`, ...extra }) as LogRecord;
const screen = (seq: number, pics: unknown[], scene = "map"): LogRecord => ({ ...base, seq, type: "screen", scene, pics }) as LogRecord;
const start = (seq: number): LogRecord =>
  ({ ...base, seq, type: "battle", phase: "start", troopId: 4, troopName: "고블린", enemies: [], canEscape: true, canLose: false }) as LogRecord;
const end = (seq: number): LogRecord => ({ ...base, seq, type: "battle", phase: "end", troopId: 4, result: "win" }) as LogRecord;
const line = (seq: number, text: string): LogRecord => ({ ...base, seq, type: "battlelog", text }) as LogRecord;

// bridge 1.10.0 entries of a CallCutin-like cut-in (world positions, "sprite")
const CUT = [1000, "actor01_cutin_A_0001", 0, 240, 256, 100, 100, 255, 0, [10, 0, -20, 0], 0, 300, 400, "sprite"];
const ORGAN = [1001, "organ/A_b", 0, 270, 296, 100, 100, 128, 0, 0, 0, 50, 60, "sprite"];
const FULL = [1000, "cutin_full", 0, 0, 0, 100, 100, 255, 0, 0, 0, 816, 624, "sprite"];
const ctx: PictureContext = { screen: { width: 816, height: 624 } };

const reader = (recs: LogRecord[], c: PictureContext = ctx) => {
  const model = buildHistory(recs);
  const path = branchPath(recs, model, 1);
  return readerItems(foldTimeline(path, model, {}), data, new Map(), model, null, scenesBySeq(picturesBySeq(path), c));
};

describe("plugin-drawn picture entries (1.10.0)", () => {
  it("parses the sprite marker and keys roles by name", () => {
    expect(parsePic(CUT)).toMatchObject({ id: 1000, name: "actor01_cutin_A_0001", kind: "sprite", tone: [10, 0, -20, 0], w: 300, h: 400 });
    expect(parsePic(CUT.slice(0, 13))).not.toHaveProperty("kind");
    expect(spriteKeyOf("actor01_cutin_A_0001")).toBe("actor01_cutin_A");
    expect(spriteKeyOf("organ/A_b")).toBe("organ/");
    expect(spriteKeyOf("12")).toBe("12");
    const p = parsePic(CUT)!;
    expect(roleOf(p, ctx)).toBe("stand");
    expect(roleOf(parsePic(FULL)!, ctx)).toBe("cg");
    expect(roleOf(p, { ...ctx, spriteRoles: { actor01_cutin_A: "hidden" } })).toBe("hidden");
    // picture-id roles never apply to synthetic ids
    expect(roleOf(p, { ...ctx, roles: { 1000: "hidden" } })).toBe("stand");
  });

  it("lists sprites by name key in the settings, not by id", () => {
    const recs = [bs(1), screen(2, [[5, "stand", 0, 0, 0, 100, 100, 255, 0], CUT, ORGAN])];
    expect(seenPictures(recs, ctx).map(s => s.id)).toEqual([5]);
    expect(seenSprites(recs, ctx)).toEqual([
      { key: "actor01_cutin_A", names: ["actor01_cutin_A_0001"], auto: "stand" },
      { key: "organ/", names: ["organ/A_b"], auto: "stand" },
    ]);
  });

  it("settings keep sprite roles", () => {
    const body = addonsJson({}, null, null, { "organ/": "hidden", "": "cg", bad: "nope" as never });
    expect(JSON.parse(body).spriteRoles).toEqual({ "organ/": "hidden" });
    expect(parseAddonFile(body)?.spriteRoles).toEqual({ "organ/": "hidden" });
    expect(parseAddonFile(addonsJson({}))).not.toHaveProperty("spriteRoles");
  });
});

describe("screen records in the reader (1.10.0)", () => {
  it("shows a cut-in between messages as its own item (cropped composite), and nothing when it adds nothing new", () => {
    const out = reader([bs(1), msg(2, 0, { pics: [] }), screen(3, [CUT, ORGAN]), screen(4, []), msg(5, 1, { picsSame: true })]);
    expect(out.map(i => i.kind)).toEqual(["chapter", "message", "screen", "message"]);
    const s = out[2] as Extract<ReaderItem, { kind: "screen" }>;
    expect(s.screen.kind).toBe("stand");
    expect(s.screen.pictures.map(p => p.name)).toEqual(["actor01_cutin_A_0001", "organ/A_b"]);
    // the message after the cut-in vanished has nothing new to show
    expect(out[3]).not.toHaveProperty("screen");
  });

  it("a full-screen plugin image is an event image; a hidden role drops it", () => {
    const out = reader([bs(1), screen(2, [FULL])]);
    expect(out[1]).toMatchObject({ kind: "screen", screen: { kind: "cg" } });
    expect(reader([bs(1), screen(2, [FULL])], { ...ctx, spriteRoles: { cutin_full: "hidden" } }).map(i => i.kind)).toEqual(["chapter"]);
  });

  it("sits inside the battle block in order", () => {
    const out = reader([bs(1), start(2), line(3, "공격!"), screen(4, [CUT], "battle"), line(5, "12의 데미지!"), screen(6, [], "battle"), end(7)]);
    expect(out.map(i => i.kind)).toEqual(["chapter", "battle"]);
    const b = out[1] as Extract<ReaderItem, { kind: "battle" }>;
    expect(b.items.map(i => i.kind)).toEqual(["battlelog", "screen", "battlelog"]);
    expect(b.logLines).toBe(2);
  });
});

describe("screen records are fold-neutral (1.10.0)", () => {
  it("do not break repeat folding of the same talk", () => {
    const talk = (s: number) => [msg(s, 0), screen(s + 1, [CUT]), msg(s + 2, 1)];
    const recs = [bs(1), ...talk(2), ...talk(5)];
    const items = foldTimeline(recs, buildHistory(recs), {});
    expect(items.map(i => i.kind)).toEqual(["record", "record", "record", "record", "repeat"]);
  });

  it("do not count as story: a load after one continues the branch", () => {
    const recs = [
      bs(1), { ...base, seq: 2, type: "save", slot: 1 } as LogRecord, screen(3, [CUT]),
      { ...base, seq: 4, branch: 2, type: "branchStart", reason: "load", parentBranch: 1, fromSeq: 2 } as LogRecord,
    ];
    expect(isContinuation(buildHistory(recs), 2)).toBe(true);
  });

  it("battle repeat folding ignores them; unread counts ignore them; the history list leaves them out", () => {
    const fight = (s: number, pics: unknown[]) => [start(s), line(s + 1, "공격!"), screen(s + 2, pics, "battle"), end(s + 3)];
    const recs = [bs(1), ...fight(2, [CUT]), ...fight(6, [ORGAN])];
    const items = foldTimeline(recs, buildHistory(recs), {});
    const bat = items.filter((i): i is Extract<HistoryItem, { kind: "battle" }> => i.kind === "battle");
    expect(bat.map(b => b.repeat)).toEqual([0, 1]);
    const out = reader([bs(1), msg(2, 0), screen(3, [CUT]), msg(4, 1)]);
    expect(readStats(out, 2).unread).toBe(1);
    const filtered = filterItems(items, new Set(ALL_KINDS));
    expect(JSON.stringify(filtered)).not.toContain("\"screen\"");
  });
});
