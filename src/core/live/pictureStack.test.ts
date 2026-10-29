import { describe, expect, it } from "vitest";
import type { EventCommand, GameData } from "../types";
import type { HistoryItem, HistoryModel, LogRecord } from "./types";
import { applyPictureOp, composedScene, hasLayeredPictures, pictureOp, pictureVarIds, stackPictures, type StackPicture } from "./pictureStack";
import { PICTURE_RUN_GAP_MS, readerItems } from "./reader";

const SCREEN = { width: 816, height: 624 };
const c = (code: number, parameters: unknown[]): EventCommand => ({ code, indent: 0, parameters });
// map 1 event 1 page 0: a standing picture built from parts (T_043302 style)
const list = [
  c(231, [2, "Reiri_Base", 0, 0, 0, 0, 100, 100, 255, 0]),
  c(231, [3, "Reiri_Arm", 0, 0, 0, 0, 100, 100, 255, 0]),
  c(231, [10, "Reiri_Eyes1", 0, 0, 0, 0, 100, 100, 255, 0]),
  c(231, [11, "Reiri_Mouth3", 0, 1, 5, 6, 100, 100, 255, 0]),   // variable-designated
  c(231, [12, "Fade", 1, 0, 408, 312, 100, 100, 0, 0]),           // shown at opacity 0 (faded in by 232)
  c(0, []),
];
const data = {
  maps: new Map([[1, { events: [null, { pages: [{ list }] }] }]]), commonEvents: [], troops: [], actors: [],
} as unknown as GameData;
const src = { source: "map", mapId: 1, eventId: 1, page: 0 } as const;
const base = { v: 1, run: 1, branch: 1 } as const;
const pic = (seq: number, cmd: number, pictureId: number, name: string, extra: Record<string, unknown> = {}, t = seq) =>
  ({ ...base, seq, t, type: "picture", src, cmd, pictureId, name, ...extra }) as LogRecord;
const msg = (seq: number, t = seq) =>
  ({ ...base, seq, t, type: "message", src, cmd: 99, face: "", faceIndex: 0, speaker: "", text: `line ${seq}` }) as LogRecord;
const item = (record: LogRecord): HistoryItem => ({ kind: "record", uncertain: false, changed: false, record });
const model: HistoryModel = { branches: new Map(), runs: [], alias: new Map(), latestBranch: 1 };

const build = (recs: LogRecord[], vars: Record<string, number> | null = null) => {
  let stack: ReadonlyMap<number, StackPicture> = new Map();
  for (const r of recs) stack = applyPictureOp(stack, pictureOp(r, data, SCREEN, vars ? { branch: 1, values: vars } : null));
  return stackPictures(stack);
};

describe("pictureStack (rebuilding layered pictures from commands)", () => {
  it("old logs: looks the Show Picture command up in the game data", () => {
    const pics = build([pic(1, 0, 2, "Reiri_Base"), pic(2, 1, 3, "Reiri_Arm"), pic(3, 2, 10, "Reiri_Eyes1")]);
    expect(pics.map(p => [p.id, p.name, p.x, p.y, p.opacity])).toEqual([
      [2, "Reiri_Base", 0, 0, 255], [3, "Reiri_Arm", 0, 0, 255], [10, "Reiri_Eyes1", 0, 0, 255],
    ]);
  });

  it("old logs: a picture shown at opacity 0 is kept visible (no move records to fade it in)", () => {
    const [p] = build([pic(1, 4, 12, "Fade")]);
    expect(p).toMatchObject({ origin: 1, x: 408, y: 312, opacity: 255 });
  });

  it("variable-designated positions: live variables for the current branch, else centred and marked unknown", () => {
    const [known] = build([pic(1, 3, 11, "Reiri_Mouth3")], { 5: 120, 6: 40 });
    expect(known).toMatchObject({ x: 120, y: 40, origin: 0 });
    expect(known.posUnknown).toBeUndefined();
    const [unknown] = build([pic(1, 3, 11, "Reiri_Mouth3")]);
    expect(unknown).toMatchObject({ x: 408, y: 312, origin: 1, posUnknown: true });
    // another branch's record never uses the live variables
    const other = pictureOp({ ...pic(1, 3, 11, "Reiri_Mouth3"), branch: 2 } as LogRecord, data, SCREEN, { branch: 1, values: { 5: 1, 6: 1 } });
    expect(other?.op === "show" && other.pic?.posUnknown).toBe(true);
  });

  it("pictureVarIds: only variables a variable-designated Show Picture can read", () => {
    expect(pictureVarIds([pic(1, 0, 2, "Reiri_Base"), msg(2)], data)).toEqual([]);
    expect(pictureVarIds([pic(1, 3, 11, "Reiri_Mouth3"), pic(2, 0, 2, "Reiri_Base")], data)).toEqual([5, 6]);
    // resolved values in the record (1.15.0+), erase/move, or no name: the variables are never read
    expect(pictureVarIds([
      pic(1, 3, 11, "Reiri_Mouth3", { x: 1, y: 2 }), pic(2, 3, 11, "", {}), pic(3, 3, 11, "", { op: "erase" }),
    ], data)).toEqual([]);
    // when it is empty, live variables make no difference to the stack
    const recs = [pic(1, 0, 2, "Reiri_Base"), pic(2, 1, 3, "Reiri_Arm")];
    expect(build(recs, { 5: 1, 6: 2 })).toEqual(build(recs));
  });

  it("new logs (1.15.0) carry the resolved values; no lookup", () => {
    const [p] = build([pic(1, 77, 4, "X", { origin: 1, x: 10, y: 20, scaleX: 50, scaleY: 60, opacity: 128, blend: 2 })]);
    expect(p).toMatchObject({ id: 4, name: "X", origin: 1, x: 10, y: 20, scaleX: 50, scaleY: 60, opacity: 128, blendMode: 2 });
  });

  it("erase removes and move updates the target values", () => {
    const pics = build([
      pic(1, 77, 4, "A", { origin: 0, x: 0, y: 0, scaleX: 100, scaleY: 100, opacity: 0, blend: 0 }),
      pic(2, 77, 5, "B", { origin: 0, x: 0, y: 0, scaleX: 100, scaleY: 100, opacity: 255, blend: 0 }),
      pic(3, 78, 4, "", { op: "move", origin: 1, x: 300, y: 200, scaleX: 100, scaleY: 100, opacity: 255, blend: 0 }),
      pic(4, 79, 5, "", { op: "erase" }),
      pic(5, 79, 9, "", { op: "erase" }), // nothing there: no change
    ]);
    expect(pics.map(p => [p.id, p.x, p.y, p.origin, p.opacity])).toEqual([[4, 300, 200, 1, 255]]);
  });

  it("small parts overlapping a drawn layer stay part of the stand", () => {
    const sizes: Record<string, { w: number; h: number }> = { Body: { w: 400, h: 600 }, Eyes: { w: 40, h: 20 }, Badge: { w: 30, h: 30 } };
    const pics = build([
      pic(1, 77, 2, "Body", { origin: 0, x: 200, y: 24, scaleX: 100, scaleY: 100, opacity: 255, blend: 0 }),
      pic(2, 77, 3, "Eyes", { origin: 0, x: 380, y: 120, scaleX: 100, scaleY: 100, opacity: 255, blend: 0 }),
      pic(3, 77, 4, "Badge", { origin: 0, x: 0, y: 0, scaleX: 100, scaleY: 100, opacity: 255, blend: 0 }),
    ]);
    const scene = composedScene(pics, { screen: SCREEN, sizeOf: n => sizes[n] ?? null });
    expect(scene.stand.map(p => p.name)).toEqual(["Body", "Eyes"]);
  });

  it("hint: three or more Show Picture records between messages", () => {
    expect(hasLayeredPictures([pic(1, 0, 2, "a"), msg(2), pic(3, 0, 3, "b"), pic(4, 0, 4, "c"), msg(5)])).toBe(false);
    expect(hasLayeredPictures([msg(1), pic(2, 0, 2, "a"), pic(3, 0, 3, "b"), pic(4, 0, 4, "c"), msg(5)])).toBe(true);
    // erase / move / text pictures don't count
    expect(hasLayeredPictures([pic(1, 0, 2, "a"), pic(2, 0, 2, "", { op: "erase" }), pic(3, 0, 3, ""), pic(4, 0, 3, "b")])).toBe(false);
  });
});

describe("readerItems with rebuilt pictures (add-on off)", () => {
  const run = (recs: LogRecord[]) => readerItems(recs.map(item), data, new Map(), model, null, null, { compose: { ctx: { screen: SCREEN } } });

  it("merges the parts into one composite on the message; never isolated part items", () => {
    const out = run([msg(1), pic(2, 0, 2, "Reiri_Base"), pic(3, 1, 3, "Reiri_Arm"), pic(4, 2, 10, "Reiri_Eyes1"), msg(5), msg(6)]);
    expect(out.map(i => i.kind)).toEqual(["message", "message", "message"]);
    const m = out[1];
    expect(m.kind === "message" && m.screen?.pictures.map(p => p.name)).toEqual(["Reiri_Base", "Reiri_Arm", "Reiri_Eyes1"]);
    // stays on screen across lines: not attached again
    expect(out[2].kind === "message" && out[2].screen).toBeFalsy();
  });

  it("changing one part re-shows the whole composite; erasing all shows nothing", () => {
    const out = run([
      pic(1, 0, 2, "Reiri_Base"), pic(2, 2, 10, "Reiri_Eyes1"), msg(3),
      pic(4, 77, 10, "Reiri_Eyes2", { origin: 0, x: 0, y: 0, scaleX: 100, scaleY: 100, opacity: 255, blend: 0 }), msg(5),
      pic(6, 9, 2, "", { op: "erase" }), pic(7, 9, 10, "", { op: "erase" }), msg(8),
    ]);
    const shots = out.map(i => (i.kind === "message" && i.screen ? i.screen.pictures.map(p => p.name).join("+") : "-"));
    expect(shots).toEqual(["Reiri_Base+Reiri_Eyes1", "Reiri_Base+Reiri_Eyes2", "-"]);
  });

  it("pictures changed without a message show as one screen item before a choice, or after a pause", () => {
    const choice = { ...base, seq: 4, t: 4, type: "choice", src, cmd: 50, picked: 0 } as LogRecord;
    const out = run([pic(1, 0, 2, "Reiri_Base"), pic(2, 1, 3, "Reiri_Arm"), choice]);
    expect(out.map(i => i.kind)).toEqual(["screen", "choice"]);
    expect(out[0]).toMatchObject({ key: "r1", seq: 2 });
    // a CG shown, held for a while, then erased before the next line: a cut-in (replaces the rebuilt screen item)
    const cg = run([pic(1, 0, 2, "Reiri_Base", {}, 0), pic(2, 0, 2, "", { op: "erase" }, PICTURE_RUN_GAP_MS + 500), msg(3, PICTURE_RUN_GAP_MS + 600)]);
    expect(cg.map(i => i.kind)).toEqual(["cutin", "message"]);
    expect(cg[0].kind === "cutin" && cg[0].frames.map(f => f.pictures.map(p => p.name).join("+"))).toEqual(["Reiri_Base"]);
    expect(cg[1].kind === "message" && cg[1].screen).toBeFalsy();
  });
});
