import { describe, expect, it } from "vitest";
import type { EventCommand } from "../types";
import {
  finishMotion, FRAME_MS, motionAt, motionNames, motionRuns, MOTION_MAX_FRAMES, MOTION_MAX_MS, MOTION_MAX_NAMES, simulateMotion, type MotionOp,
} from "./pictureMotion";
import type { ScreenPicture } from "./screenPictures";

const SCREEN = { width: 816, height: 624 };
const c = (code: number, parameters: unknown[], indent = 0): EventCommand => ({ code, indent, parameters });
const show = (id: number, name: string, x = 0, y = 0, opacity = 255, indent = 0) => c(231, [id, name, 0, 0, x, y, 100, 100, opacity, 0], indent);
const wait = (n: number, indent = 0) => c(230, [n], indent);
const msg = () => [c(101, ["", 0, 0, 2]), c(401, ["line"])];
const pic = (id: number, name: string, extra: Partial<ScreenPicture> = {}): ScreenPicture =>
  ({ id, name, origin: 0, x: 0, y: 0, scaleX: 100, scaleY: 100, opacity: 255, blendMode: 0, ...extra });
const names = (pics: ScreenPicture[]) => pics.map(p => p.name).join("+");

describe("simulateMotion / motionAt", () => {
  it("a move with a duration is linear over its duration, like the engine", () => {
    const ops: MotionOp[] = [{ t: 1000, kind: "move", id: 1, to: { x: 100, y: 0, scaleX: 100, scaleY: 100, opacity: 255 }, dur: 500 }];
    const m = simulateMotion([pic(1, "A")], ops);
    expect(m.end).toBe(500);
    expect(motionAt(m, 0)[0].x).toBe(0);
    expect(motionAt(m, 250)[0].x).toBeCloseTo(50);
    expect(motionAt(m, 500)[0].x).toBe(100);
    expect(motionAt(m, 9999)[0].x).toBe(100);
  });

  it("frame swaps step (no interpolation between names)", () => {
    const ops: MotionOp[] = [
      { t: 0, kind: "show", id: 1, pic: pic(1, "F_0001") },
      { t: 100, kind: "show", id: 1, pic: pic(1, "F_0002") },
      { t: 200, kind: "erase", id: 1 },
    ];
    const m = simulateMotion([], ops);
    expect(m.frames.map(f => [f.t, names(f.pictures)])).toEqual([[0, "F_0001"], [100, "F_0002"], [200, ""]]);
    expect(names(motionAt(m, 150))).toBe("F_0002");
  });

  it("same-moment ops are one frame", () => {
    const m = simulateMotion([], [
      { t: 0, kind: "show", id: 1, pic: pic(1, "Bg") },
      { t: 3, kind: "show", id: 2, pic: pic(2, "Face", { opacity: 0 }) },
      { t: 4, kind: "move", id: 2, to: { x: 0, y: 0, scaleX: 100, scaleY: 100, opacity: 255 }, dur: 300 },
    ]);
    expect(m.frames[0].pictures.map(p => p.name)).toEqual(["Bg", "Face"]);
    expect(motionAt(m, 150)[1].opacity).toBeCloseTo(127.5);
  });

  it("finishMotion: no visible change → null", () => {
    const m = simulateMotion([pic(1, "A")], [{ t: 0, kind: "show", id: 1, pic: pic(1, "A") }, { t: 500, kind: "show", id: 1, pic: pic(1, "A") }]);
    expect(finishMotion(m)).toBeNull();
  });
});

describe("motionRuns (event commands)", () => {
  it("a numbered frame swap with waits becomes one run with the engine timing", () => {
    const list = [
      ...msg(),
      show(9, "Anim_0009"), wait(5), show(9, "Anim_0010"), wait(5), show(9, "Anim_0011"), wait(20),
      ...msg(), c(0, []),
    ];
    const runs = motionRuns(list, SCREEN);
    expect(runs).toHaveLength(1);
    expect(runs[0].first).toBe(2);
    const m = runs[0].motion;
    expect(m.frames.map(f => names(f.pictures))).toEqual(["Anim_0009", "Anim_0010", "Anim_0011"]);
    expect(m.frames[1].t).toBeCloseTo(5 * FRAME_MS);
    expect(m.frames[2].t).toBeCloseTo(10 * FRAME_MS);
  });

  it("pictures shown before the run stay under it; a fade-in move with wait interpolates", () => {
    const list = [
      show(1, "Bg"), ...msg(),
      show(2, "Face", 0, 0, 0), c(232, [2, 0, 0, 0, 0, 0, 100, 100, 255, 0, 60, true]), show(3, "Over"),
      ...msg(),
    ];
    const [run] = motionRuns(list, SCREEN);
    expect(run.first).toBe(3);
    expect(names(motionAt(run.motion, 0))).toBe("Bg+Face");
    expect(motionAt(run.motion, 0)[1].opacity).toBe(0);
    expect(motionAt(run.motion, 500)[1].opacity).toBeCloseTo(127.5);
    expect(names(motionAt(run.motion, run.motion.end))).toBe("Bg+Face+Over");
    expect(run.motion.end).toBeCloseTo(1000);
  });

  it("a frame loop (112) ended by a switch is repeated for a short looping clip", () => {
    const list = [
      ...msg(),
      c(112, []),
      show(72, "Loop_0001", 0, 0, 255, 1), wait(10, 1), show(72, "Loop_0002", 0, 0, 255, 1), wait(10, 1),
      c(111, [0, 5, 0], 1), c(113, [], 2), c(0, [], 2), c(412, [], 1),
      c(0, [], 1), c(413, []),
      ...msg(),
    ];
    const [run] = motionRuns(list, SCREEN);
    const seq = run.motion.frames.map(f => names(f.pictures));
    expect(seq.length).toBeGreaterThanOrEqual(4);
    expect(seq.slice(0, 4)).toEqual(["Loop_0001", "Loop_0002", "Loop_0001", "Loop_0002"]);
    expect(run.motion.end).toBeLessThanOrEqual(MOTION_MAX_MS);
  });

  it("tint (234) and rotation (233) animate", () => {
    const list = [show(1, "A"), c(234, [1, [90, 0, 0, 0], 60, true]), c(233, [1, 6]), wait(30)];
    const [run] = motionRuns(list, SCREEN);
    expect(motionAt(run.motion, 500)[0].tone?.[0]).toBeCloseTo(45);
    // speed 6 → 3°/frame
    const at = motionAt(run.motion, 1000 + 10 * FRAME_MS)[0].angle ?? 0;
    expect(at).toBeCloseTo(30, 0);
  });

  it("no change (same picture shown again) → no run; a single picture command → no run", () => {
    expect(motionRuns([show(1, "A"), wait(10), show(1, "A")], SCREEN)).toEqual([]);
    expect(motionRuns([...msg(), show(1, "A"), ...msg()], SCREEN)).toEqual([]);
  });

  it("very long swaps keep only the end (≤ MOTION_MAX_MS, ≤ MOTION_MAX_FRAMES)", () => {
    const list: EventCommand[] = [];
    for (let i = 0; i < 1000; i++) list.push(show(5, `Long_${String(i).padStart(4, "0")}`), wait(5));
    const [run] = motionRuns(list, SCREEN);
    expect(run.motion.end).toBeLessThanOrEqual(MOTION_MAX_MS);
    expect(run.motion.frames.length).toBeLessThanOrEqual(MOTION_MAX_FRAMES);
    expect(motionNames(run.motion).length).toBeLessThanOrEqual(MOTION_MAX_NAMES);
    expect(names(motionAt(run.motion, run.motion.end))).toBe("Long_0999");
    expect(run.motion.frames[0].t).toBe(0);
  });

  it("never throws on junk", () => {
    expect(motionRuns(null, SCREEN)).toEqual([]);
    expect(motionRuns([{ code: 231 } as unknown as EventCommand, null as unknown as EventCommand], SCREEN)).toEqual([]);
    expect(motionAt({ frames: [], end: 0 }, 5)).toEqual([]);
  });
});
