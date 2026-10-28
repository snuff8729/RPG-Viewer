import { describe, expect, it } from "vitest";
import type { LogRecord } from "../live/types";
import { DEFAULT_SCREEN, parsePic, parsePics, picturesBySeq, samePictures, screenSizeOf } from "./screenPictures";

const base = { v: 1, t: 0, run: 1, branch: 1 } as const;
const msg = (seq: number, extra: Record<string, unknown> = {}) =>
  ({ ...base, seq, type: "message", src: null, cmd: seq, face: "", faceIndex: 0, speaker: "", text: "t", ...extra }) as LogRecord;
const A = [110, "submit/2", 0, 10, 20, 50, 50, 128, 1];
const B = [120, "stand/body", 1, 400, 624, 100, 100, 255, 0];

describe("parsePic / parsePics", () => {
  it("reads the compact entry, tone and angle", () => {
    expect(parsePic(A)).toEqual({ id: 110, name: "submit/2", origin: 0, x: 10, y: 20, scaleX: 50, scaleY: 50, opacity: 128, blendMode: 1 });
    expect(parsePic([5, "x", 1, 0, 0, 100, 100, 999, 7, [10, -20, 0, 0], 15])).toMatchObject({ opacity: 255, blendMode: 0, tone: [10, -20, 0, 0], angle: 15 });
    expect(parsePic([5, "x", 0, 0, 0, 100, 100, 255, 0, 0, 0])).not.toHaveProperty("tone");
  });
  it("drops bad entries, sorts by id, caps at 60", () => {
    expect(parsePic([0, "x"])).toBeNull();
    expect(parsePic([1, ""])).toBeNull();
    expect(parsePic("x")).toBeNull();
    expect(parsePics([B, "bad", A])!.map(p => p.id)).toEqual([110, 120]);
    expect(parsePics(Array.from({ length: 80 }, (_, i) => [i + 1, "p"]))).toHaveLength(60);
    expect(parsePics(undefined)).toBeNull();
  });
});

describe("picturesBySeq", () => {
  it("applies snapshots and sameness along the path", () => {
    const m = picturesBySeq([
      msg(1),                                   // capture off: unknown
      msg(2, { pics: [B, A] }),
      msg(3, { picsSame: true }),
      { ...base, seq: 4, type: "choices", src: null, cmd: 0, options: [], pics: [B] } as LogRecord,
      msg(5, { picsSame: true }),
      msg(6, { pics: [] }),
      { ...base, seq: 7, type: "branchStart", reason: "load", parentBranch: 1, fromSeq: 3 } as LogRecord,
      msg(8, { picsSame: true }),               // after a branch start sameness has nothing to refer to
      msg(9),
    ]);
    expect(m.has(1)).toBe(false);
    expect(m.get(2)!.map(p => p.id)).toEqual([110, 120]);
    expect(m.get(3)).toBe(m.get(2));
    expect(m.get(5)!.map(p => p.id)).toEqual([120]);
    expect(m.get(6)).toEqual([]);
    expect(m.has(8)).toBe(false);
    expect(m.has(9)).toBe(false);
  });
  it("never throws on junk", () => {
    expect(picturesBySeq(null as never).size).toBe(0);
    expect(picturesBySeq([null, 1, msg(1, { pics: "x" })] as never).size).toBe(0);
  });
});

describe("samePictures", () => {
  it("compares contents", () => {
    expect(samePictures(parsePics([A]), parsePics([A]))).toBe(true);
    expect(samePictures(parsePics([A]), parsePics([B]))).toBe(false);
    expect(samePictures(null, undefined)).toBe(true);
    expect(samePictures(null, [])).toBe(false);
  });
});

describe("screenSizeOf", () => {
  const plugins = (params: Record<string, string>, status = true) =>
    `var $plugins =\n[\n${JSON.stringify({ name: "YEP_CoreEngine", status, description: "", parameters: params })}\n];\n`;
  it("MZ System.json advanced, then MV plugin params, else 816x624", () => {
    expect(screenSizeOf({ advanced: { screenWidth: 1280, screenHeight: 720 } } as never, null)).toEqual({ width: 1280, height: 720 });
    expect(screenSizeOf({} as never, plugins({ "Screen Width": "1104", "Screen Height": "624" }))).toEqual({ width: 1104, height: 624 });
    expect(screenSizeOf({} as never, plugins({ "Screen Width": "1104", "Screen Height": "624" }, false))).toEqual(DEFAULT_SCREEN);
    expect(screenSizeOf({} as never, plugins({ screenWidth: "abc", screenHeight: "624" }))).toEqual(DEFAULT_SCREEN);
    expect(screenSizeOf(null, "garbage")).toEqual(DEFAULT_SCREEN);
  });
});
