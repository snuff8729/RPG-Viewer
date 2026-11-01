import { describe, expect, it } from "vitest";
import type { EventCommand, GameData } from "../types";
import type { PictureContext, ScreenPicture } from "../addons/screenPictures";
import { motionAt, MOTION_MAX_MS } from "../addons/pictureMotion";
import { branchPath, buildHistory, foldTimeline } from "./history";
import { readerItems, type ReaderItem } from "./reader";
import type { LogRecord } from "./types";

const SCREEN = { width: 816, height: 624 };
const c = (code: number, parameters: unknown[], indent = 0): EventCommand => ({ code, indent, parameters });
// CE 1: fade-in (show at 0, move to 255 over 30 frames)
const CE1 = [c(231, [1, "Scene_Bg", 0, 0, 0, 0, 100, 100, 0, 0]), c(232, [1, 0, 0, 0, 0, 0, 100, 100, 255, 0, 30, true]), c(0, [])];
// CE 2: slide (move over 60 frames)
const CE2 = [c(232, [1, 0, 0, 0, 200, 0, 100, 100, 255, 0, 60, true]), c(0, [])];
const ce = (id: number, list: EventCommand[]) => ({ id, name: `CE${id}`, trigger: 0, switchId: 1, list });
const data = {
  maps: new Map(), troops: [], actors: [], screenSize: SCREEN,
  commonEvents: [null, ce(1, CE1), ce(2, CE2), ce(3, [c(0, [])])],
} as unknown as GameData;
// every picture is full-screen (an event CG)
const ctx: PictureContext = { screen: SCREEN, sizeOf: () => ({ w: 816, h: 624 }) };
const common = (id: number) => ({ source: "common", commonEventId: id }) as const;

let seq = 0;
const R = (rec: Record<string, unknown>, t: number): LogRecord => {
  seq++;
  return { v: 1, run: 1, branch: 1, seq, t, ...rec } as LogRecord;
};
const start = () => { seq = 0; return [R({ type: "branchStart", reason: "newGame", parentBranch: null, fromSeq: null }, 1)]; };
const v = (x: number, opacity = 255) => ({ origin: 0, x, y: 0, scaleX: 100, scaleY: 100, opacity, blend: 0 });
const pic = (ce: number, cmd: number, id: number, name: string, t: number, extra: Record<string, unknown> = {}) =>
  R({ type: "picture", src: common(ce), cmd, pictureId: id, name, ...extra }, t);
let line = 0;
const msg = (t: number) => { line++; return R({ type: "message", src: common(3), cmd: line, face: "", faceIndex: 0, speaker: "", text: `line ${line}` }, t); };

function read(recs: LogRecord[]): ReaderItem[] {
  const model = buildHistory(recs);
  const path = branchPath(recs, model, 1);
  return readerItems(foldTimeline(path, model, {}), data, new Map(), model, null, null, { compose: { ctx } }).filter(i => i.kind !== "chapter");
}
const messages = (items: ReaderItem[]) => items.filter((i): i is Extract<ReaderItem, { kind: "message" }> => i.kind === "message");
const names = (pics: ScreenPicture[]) => pics.map(p => p.name).join("+");

describe("picture motion from the play log", () => {
  it("a fade-in before a message animates with the command's duration; the end is the message's still", () => {
    const recs = [...start(), msg(100), pic(1, 0, 1, "Scene_Bg", 1000, v(0, 0)), pic(1, 1, 1, "", 1001, { op: "move", ...v(0, 255) }), msg(1600)];
    const [, second] = messages(read(recs));
    const m = second.screen?.motion;
    expect(m).toBeTruthy();
    expect(m!.end).toBeCloseTo(500);
    expect(motionAt(m!, 0)[0].opacity).toBe(0);
    expect(motionAt(m!, 250)[0].opacity).toBeCloseTo(127.5);
    expect(motionAt(m!, m!.end)).toEqual(second.screen!.pictures);
  });

  it("a frame swap that stays on screen steps at the logged times", () => {
    const recs = [
      ...start(), msg(100),
      pic(3, 0, 9, "Anim_0001", 1000, v(0)), pic(3, 0, 9, "Anim_0002", 1083, v(0)), pic(3, 0, 9, "Anim_0003", 1166, v(0)),
      msg(1500),
    ];
    const [, second] = messages(read(recs));
    const m = second.screen!.motion!;
    expect(m.frames.map(f => [Math.round(f.t), names(f.pictures)])).toEqual([[0, "Anim_0001"], [83, "Anim_0002"], [166, "Anim_0003"]]);
    expect(names(second.screen!.pictures)).toBe("Anim_0003");
  });

  it("only pictures that changed move; the others stay as in the still", () => {
    const recs = [
      ...start(), pic(3, 0, 2, "Room", 50, v(0)), msg(100),
      pic(2, 0, 2, "", 1000, { op: "move", ...v(0) }), // no-op move of the background
      pic(3, 0, 1, "Scene_Bg", 1000, v(0)), pic(2, 0, 1, "", 1001, { op: "move", ...v(100) }),
      msg(2500),
    ];
    const [, second] = messages(read(recs));
    const m = second.screen!.motion!;
    expect(names(motionAt(m, 0))).toBe("Scene_Bg+Room");
    expect(motionAt(m, 500).find(p => p.name === "Scene_Bg")!.x).toBeCloseTo(50);
    expect(motionAt(m, 500).find(p => p.name === "Room")!.x).toBe(0);
  });

  it("a long two-frame loop is shortened to a short clip", () => {
    const recs = [...start(), msg(100)];
    for (let i = 0; i < 200; i++) recs.push(pic(3, 0, 72, i % 2 ? "Loop_0002" : "Loop_0001", 1000 + i * 100, v(0)));
    recs.push(msg(1000 + 200 * 100 + 50));
    const [, second] = messages(read(recs));
    const m = second.screen!.motion!;
    expect(m.end).toBeLessThanOrEqual(MOTION_MAX_MS);
    expect(m.end).toBeLessThan(4000);
    expect(m.frames.slice(0, 4).map(f => names(f.pictures))).toEqual(["Loop_0001", "Loop_0002", "Loop_0001", "Loop_0002"]);
  });

  it("no picture change between messages → no motion", () => {
    const recs = [...start(), pic(3, 0, 1, "Scene_Bg", 50, v(0)), msg(100), msg(500)];
    const items = messages(read(recs));
    expect(items[0].screen?.motion).toBeUndefined();
    expect(items[1].screen).toBeUndefined();
  });

  it("a cut-in (shown and erased between lines) carries its timed motion", () => {
    const recs = [
      ...start(), msg(100),
      pic(3, 0, 5, "Cut_0001", 1000, v(0)), pic(3, 0, 5, "Cut_0002", 1050, v(0)), pic(3, 0, 5, "Cut_0003", 1100, v(0)),
      pic(3, 0, 5, "", 1300, { op: "erase" }),
      msg(1500),
    ];
    const cut = read(recs).find((i): i is Extract<ReaderItem, { kind: "cutin" }> => i.kind === "cutin");
    expect(cut?.motion?.frames.map(f => [Math.round(f.t), names(f.pictures)])).toEqual([[0, "Cut_0001"], [50, "Cut_0002"], [100, "Cut_0003"]]);
  });
});
