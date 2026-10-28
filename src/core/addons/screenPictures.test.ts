import { describe, expect, it } from "vitest";
import type { LogRecord } from "../live/types";
import {
  DEFAULT_SCREEN, groupById, hudKeyOf, hudKeys, nextShot, parsePic, parsePics, picturesBySeq, pngSize, roleOf, samePictures, sceneOf,
  screenSizeOf, seenPictures, snapshotCounts, type PictureRoles, type ScreenPicture,
} from "./screenPictures";

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

describe("1.7.0 entries", () => {
  it("reads [anchorX, anchorY] origins and bitmap sizes; opacity 0 is not on screen", () => {
    expect(parsePic([1, "a", [0.5, 0.5], 0, 0, 100, 100, 255, 0, 0, 0, 10, 20])).toEqual({
      id: 1, name: "a", origin: 1, x: 0, y: 0, scaleX: 100, scaleY: 100, opacity: 255, blendMode: 0, w: 10, h: 20,
    });
    expect(parsePic([1, "a", [0.5, 1], 0, 0])).toMatchObject({ origin: 0, anchor: [0.5, 1] });
    expect(parsePics([[1, "a", 0, 0, 0, 100, 100, 0, 0], A])!.map(p => p.id)).toEqual([110]);
  });
});

// the user's game: 1024×768, 60 = event CGs, 101–103 = HUD gauge, 111+ = standing layers
const SCREEN = { width: 1024, height: 768 };
const P = (e: unknown[]) => parsePic(e)!;
const CG = P([60, "Cut_bath", 0, 0, 0, 100, 100, 255, 0, 0, 0, 1024, 768]);
const GAUGE = P([102, "Guage", 0, 746, 2, 100, 100, 255, 0, 0, 0, 278, 60]);
const BODY = P([111, "actor01_pose01_body_0003", 0, 380, 0, 100, 100, 255, 0, 0, 0, 922, 922]);
const ORGAN = P([113, "organ/01v", 0, 380, 0, 100, 100, 4, 0, 0, 0, 922, 922]);

describe("picture groups", () => {
  it("cg covers ≥ 80% of the screen, everything else is a stand; unknown size is a stand", () => {
    const ctx = { screen: SCREEN };
    expect(roleOf(CG, ctx)).toBe("cg");
    expect(roleOf(BODY, ctx)).toBe("stand");
    expect(roleOf(GAUGE, ctx)).toBe("stand");
    expect(roleOf(P([60, "eve_10_0001", 0, 0, 0]), ctx)).toBe("stand");
    // 1.6.0 entries: size from the picture file
    expect(roleOf(P([60, "eve_10_0001", 0, 0, 0]), { ...ctx, sizeOf: () => ({ w: 1024, h: 768 }) })).toBe("cg");
  });

  it("hud: same name and place in ≥ 70% of the game's snapshots and smaller than 15% of the screen", () => {
    const counts = new Map<ScreenPicture[], number>([
      [[GAUGE, BODY], 6], [[GAUGE, CG, BODY], 2], [[CG], 2],
    ]);
    const hud = hudKeys(counts, SCREEN);
    expect([...hud]).toEqual([hudKeyOf(GAUGE)]); // BODY is as frequent but large
    expect(roleOf(GAUGE, { screen: SCREEN, hud })).toBe("hud");
    // 60% of snapshots: not a HUD
    expect(hudKeys(new Map([[[GAUGE], 6], [[CG], 4]]), SCREEN).size).toBe(0);
    // too few snapshots to tell
    expect(hudKeys(new Map([[[GAUGE], 4]]), SCREEN).size).toBe(0);
  });

  it("a chosen group wins over the automatic one", () => {
    const hud = new Set([hudKeyOf(GAUGE)]);
    const roles: PictureRoles = { 102: "stand", 60: "hidden", 111: "cg" };
    expect(roleOf(GAUGE, { screen: SCREEN, hud, roles })).toBe("stand");
    expect(roleOf(CG, { screen: SCREEN, roles })).toBe("hidden");
    expect(roleOf(BODY, { screen: SCREEN, roles })).toBe("cg");
  });

  it("sceneOf: drops hud / hidden, keeps a stand above a CG, hides what an opaque cover above hides", () => {
    const hud = new Set([hudKeyOf(GAUGE)]);
    const s = sceneOf([BODY, GAUGE, CG, ORGAN], { screen: SCREEN, hud });
    expect(s.cg.map(p => p.id)).toEqual([60]);
    expect(s.stand.map(p => p.id)).toEqual([111, 113]);
    const cover = P([150, "black", 0, 0, 0, 100, 100, 255, 0, 0, 0, 1024, 768]);
    expect(sceneOf([BODY, cover], { screen: SCREEN })).toEqual({ cg: [cover], stand: [] });
    // a translucent or added cover does not hide what is under it
    expect(sceneOf([BODY, { ...cover, opacity: 200 }], { screen: SCREEN }).stand).toHaveLength(1);
    expect(sceneOf([BODY, { ...cover, blendMode: 1 }], { screen: SCREEN }).stand).toHaveLength(1);
  });

  it("nextShot: CG with what is above it, stand only when its layers change", () => {
    const sc = (cg: ScreenPicture[], stand: ScreenPicture[]) => ({ cg, stand });
    const a = nextShot(null, sc([], [BODY]));
    expect(a.shot).toEqual({ kind: "stand", pictures: [BODY] });
    expect(nextShot(a.key, sc([], [BODY])).shot).toBeNull();
    const b = nextShot(a.key, sc([CG], [BODY]));
    expect(b.shot).toEqual({ kind: "cg", pictures: [CG, BODY] });
    expect(nextShot(b.key, sc([], [])).key).toBe("");
    expect(nextShot(b.key, null)).toEqual({ shot: null, key: null });
  });
});

describe("settings helpers", () => {
  it("seenPictures lists recent ids with names and their automatic group; groupById clusters near ids", () => {
    const recs = [
      msg(1, { pics: [[60, "Cut_bath", 0, 0, 0, 100, 100, 255, 0, 0, 0, 1024, 768], [111, "body_1", 0, 380, 0]] }),
      msg(2, { picsSame: true }),
      msg(3, { pics: [[60, "eve_10_0001", 0, 0, 0, 100, 100, 255, 0, 0, 0, 1024, 768], [111, "body_2", 0, 380, 0], [112, "hair", 0, 380, 0], [101, "Guageback", 0, 746, 2]] }),
    ];
    const seen = seenPictures(recs, { screen: SCREEN });
    expect(seen).toEqual([
      { id: 60, names: ["eve_10_0001", "Cut_bath"], auto: "cg" },
      { id: 101, names: ["Guageback"], auto: "stand" },
      { id: 111, names: ["body_2", "body_1"], auto: "stand" },
      { id: 112, names: ["hair"], auto: "stand" },
    ]);
    expect(groupById(seen).map(g => g.map(p => p.id))).toEqual([[60], [101], [111, 112]]);
  });

  it("snapshotCounts follows each branch separately", () => {
    const counts = snapshotCounts([
      msg(1, { pics: [A] }), { ...msg(2, { picsSame: true }), branch: 2 }, msg(3, { picsSame: true }),
    ]);
    expect([...counts.values()]).toEqual([2]);
  });

  it("pngSize reads the IHDR size", () => {
    const head = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 4, 0, 0, 0, 3, 0]);
    expect(pngSize(head)).toEqual({ w: 1024, h: 768 });
    expect(pngSize(new Uint8Array(24))).toBeNull();
    expect(pngSize(null)).toBeNull();
  });
});
