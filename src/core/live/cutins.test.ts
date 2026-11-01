import { describe, expect, it } from "vitest";
import type { EventCommand, GameData } from "../types";
import type { PictureContext, ScreenShot } from "../addons/screenPictures";
import { branchPath, buildHistory, foldTimeline } from "./history";
import { cutinRuns, eraseCmdAfter, type CutinStep } from "./cutins";
import { applyPictureOp, pictureOp, type StackPicture } from "./pictureStack";
import { readerItems, type ReaderItem } from "./reader";
import type { LogRecord, RecordOf } from "./types";

const SCREEN = { width: 816, height: 624 };
const c = (code: number, parameters: unknown[], indent = 0): EventCommand => ({ code, indent, parameters });
const show = (id: number, name: string, x = 0, y = 0, indent = 0) => c(231, [id, name, 0, 0, x, y, 100, 100, 255, 0], indent);
const wait = (n: number, indent = 0) => c(230, [n], indent);

// CE 1: skill cut-in (battle): background + 3-frame animation, faded out and erased — no message
const CE1 = [
  show(1, "BreakCutin_BackGround"),                              // 0
  show(2, "BreakCutin_Bust(Cloth)_0001", -27, -30), wait(5),     // 1 2
  show(2, "BreakCutin_Bust(Cloth)_0002", -24, -30), wait(5),     // 3 4
  show(2, "BreakCutin_Bust(Cloth)_0003", -21, -30),              // 5
  show(3, "BreakCutin_Effect"), wait(5),                         // 6 7
  c(232, [2, 0, 0, 0, -21, -30, 100, 100, 0, 0, 20, true, 0]),   // 8 fade out
  c(235, [1]), c(235, [2]), c(235, [3]), c(0, []),               // 9 10 11 12
];
// CE 2: the erase is only in a branch opened after the show (may not run), and in the else of the branch that ran
const CE2 = [
  c(111, [1, 10, 0, 1, 0]),                // 0 if v10 == 1
  show(4, "Cutin_A", 0, 0, 1),             // 1
  c(0, [], 1),                              // 2
  c(411, []),                               // 3 else
  c(235, [4], 1),                           // 4 (the else that did not run)
  c(0, [], 1),                              // 5
  c(412, []),                               // 6
  c(111, [0, 5, 0]),                        // 7 if switch 5
  c(235, [4], 1),                           // 8 (a new branch: unknown)
  c(0, [], 1),                              // 9
  c(412, []),                               // 10
  c(0, []),                                 // 11
];
// CE 3: a cut-in shown by a called common event (CE 4) and erased by the caller after the call
const CE3 = [c(117, [4]), wait(30), c(235, [5]), c(101, ["", 0, 0, 2, ""]), c(401, ["after"]), c(0, [])];
const CE4 = [show(5, "Cutin_Slime_0001"), wait(8), show(5, "Cutin_Slime_0002"), c(0, [])];
// CE 5: a picture erased only after the next message (shown with the message)
const CE5 = [show(6, "Talk_Cutin"), c(101, ["", 0, 0, 2, ""]), c(401, ["line"]), c(235, [6]), c(0, [])];

const ce = (id: number, list: EventCommand[]) => ({ id, name: `CE${id}`, trigger: 0, switchId: 1, list });
const data = {
  maps: new Map(), troops: [], actors: [], screenSize: SCREEN,
  commonEvents: [null, ce(1, CE1), ce(2, CE2), ce(3, CE3), ce(4, CE4), ce(5, CE5)],
} as unknown as GameData;
const ctx: PictureContext = { screen: SCREEN };

const common = (id: number) => ({ source: "common", commonEventId: id }) as const;
let seq = 0;
const R = (rec: Record<string, unknown>, t?: number): LogRecord => {
  seq++;
  return { v: 1, run: 1, branch: 1, seq, t: t ?? seq * 100, ...rec } as LogRecord;
};
const start = () => { seq = 0; return [R({ type: "branchStart", reason: "newGame", parentBranch: null, fromSeq: null })]; };
const pic = (ce: number, cmd: number, id: number, name: string, t: number, extra: Record<string, unknown> = {}) =>
  R({ type: "picture", src: common(ce), cmd, pictureId: id, name, ...extra }, t);
const msg = (src: unknown, cmd: number, t?: number) => R({ type: "message", src, cmd, face: "", faceIndex: 0, speaker: "", text: `line` }, t);
const log = (text: string, t?: number) => R({ type: "battlelog", text }, t);

function read(recs: LogRecord[], scenes: Parameters<typeof readerItems>[5] = null): ReaderItem[] {
  const model = buildHistory(recs);
  const path = branchPath(recs, model, 1);
  return readerItems(foldTimeline(path, model, {}), data, new Map(), model, null, scenes, { compose: { ctx } }).filter(i => i.kind !== "chapter");
}
const names = (s: ScreenShot) => s.pictures.map(p => p.name).join("+");
const cutins = (items: ReaderItem[]): Extract<ReaderItem, { kind: "cutin" }>[] =>
  items.flatMap(i => (i.kind === "cutin" ? [i] : i.kind === "battle" ? cutins(i.items) : []));

/** 1.15.0+ records of CE1: show/move/erase with the resolved values, 5-frame waits (~83 ms) */
function ce1New(t0: number): LogRecord[] {
  const v = (x: number, y: number, opacity = 255) => ({ origin: 0, x, y, scaleX: 100, scaleY: 100, opacity, blend: 0 });
  return [
    pic(1, 0, 1, "BreakCutin_BackGround", t0, v(0, 0)),
    pic(1, 1, 2, "BreakCutin_Bust(Cloth)_0001", t0 + 1, v(-27, -30)),
    pic(1, 3, 2, "BreakCutin_Bust(Cloth)_0002", t0 + 84, v(-24, -30)),
    pic(1, 5, 2, "BreakCutin_Bust(Cloth)_0003", t0 + 167, v(-21, -30)),
    pic(1, 6, 3, "BreakCutin_Effect", t0 + 167, v(0, 0)),
    pic(1, 8, 2, "", t0 + 250, { op: "move", ...v(-21, -30, 0) }),
    pic(1, 9, 1, "", t0 + 584, { op: "erase" }),
    pic(1, 10, 2, "", t0 + 584, { op: "erase" }),
    pic(1, 11, 3, "", t0 + 584, { op: "erase" }),
  ];
}

describe("cut-ins (pictures shown and erased between messages)", () => {
  it("1.15.0+ battle: a skill's cut-in run between log lines becomes one cut-in item with its animation frames", () => {
    const recs = [
      ...start(),
      R({ type: "battle", phase: "start", troopId: 1, troopName: "Slime" }),
      log("Mermeia uses Break!", 1000),
      ...ce1New(1100),
      log("Slime takes 30 damage.", 1800),
      R({ type: "battle", phase: "end", troopId: 1, result: "win" }, 1900),
    ];
    const items = read(recs);
    const battle = items.find(i => i.kind === "battle");
    expect(battle?.kind === "battle" && battle.items.map(i => i.kind)).toEqual(["battlelog", "cutin", "battlelog"]);
    const [cut] = cutins(items);
    // same-moment commands are one frame; the fading frame is merged into the same picture (more opaque one kept)
    expect(cut.frames.map(names)).toEqual([
      "BreakCutin_BackGround+BreakCutin_Bust(Cloth)_0001",
      "BreakCutin_BackGround+BreakCutin_Bust(Cloth)_0002",
      "BreakCutin_BackGround+BreakCutin_Bust(Cloth)_0003+BreakCutin_Effect",
      "BreakCutin_BackGround+BreakCutin_Effect",
    ]);
    expect(cut.best).toBe(2);
    expect(cut.key).toBe(`k${recs[4].seq}`);
  });

  it("old logs (no erase records): the erase is found in the command list before the next message", () => {
    const recs = [
      ...start(),
      msg(common(9), 0, 900),
      pic(1, 0, 1, "BreakCutin_BackGround", 1000),
      pic(1, 1, 2, "BreakCutin_Bust(Cloth)_0001", 1001),
      pic(1, 3, 2, "BreakCutin_Bust(Cloth)_0002", 1084),
      pic(1, 5, 2, "BreakCutin_Bust(Cloth)_0003", 1167),
      pic(1, 6, 3, "BreakCutin_Effect", 1168),
      msg(common(9), 1, 1700),
    ];
    const items = read(recs);
    expect(items.map(i => i.kind)).toEqual(["message", "cutin", "message"]);
    const [cut] = cutins(items);
    expect(cut.frames.map(names)).toEqual([
      "BreakCutin_BackGround+BreakCutin_Bust(Cloth)_0001",
      "BreakCutin_BackGround+BreakCutin_Bust(Cloth)_0002",
      "BreakCutin_BackGround+BreakCutin_Bust(Cloth)_0003+BreakCutin_Effect",
    ]);
    // the erased cut-in is not left on the stack for the next message
    const last = items[2];
    expect(last.kind === "message" && last.screen).toBeFalsy();
  });

  it("old logs: an erase after the next message (or in a branch that may not run) does not make a cut-in", () => {
    // CE 5: shown with the message, erased after it
    const recs = [...start(), pic(5, 0, 6, "Talk_Cutin", 1000), msg(common(5), 1, 1100)];
    const items = read(recs);
    expect(items.map(i => i.kind)).toEqual(["message"]);
    expect(items[0].kind === "message" && items[0].screen && names(items[0].screen)).toBe("Talk_Cutin");
    // CE 2: the erases are in the else that did not run and in a new branch
    const show2 = { ...start()[0], seq: 2, t: 1000, type: "picture", src: common(2), cmd: 1, pictureId: 4, name: "Cutin_A" } as RecordOf<"picture">;
    expect(eraseCmdAfter(show2, null, data)).toBeNull();
    // 1.15.0+ records never use the lookup
    expect(eraseCmdAfter({ ...show2, x: 0, y: 0 }, null, data)).toBeNull();
  });

  it("old logs: a cut-in common event erased by its caller after the call", () => {
    const recs = [
      ...start(),
      pic(4, 0, 5, "Cutin_Slime_0001", 1000),
      pic(4, 2, 5, "Cutin_Slime_0002", 1134),
      msg(common(3), 3, 1700),
    ];
    const items = read(recs);
    expect(items.map(i => i.kind)).toEqual(["cutin", "message"]);
    expect(cutins(items)[0].frames.map(names)).toEqual(["Cutin_Slime_0001", "Cutin_Slime_0002"]);
    expect(eraseCmdAfter(recs[2] as RecordOf<"picture">, recs[3], data)).toEqual({ key: "common:3", cmd: 2, callee: "common:4" });
  });

  it("standing pictures that stay for the next message, or an existing stand leaving, are not cut-ins", () => {
    const v = { origin: 0, x: 0, y: 0, scaleX: 100, scaleY: 100, opacity: 255, blend: 0 };
    const stay = read([...start(), pic(9, 0, 10, "Reiri_Base", 1000, v), pic(9, 1, 11, "Reiri_Eyes1", 1000, v), msg(common(9), 2, 1100)]);
    expect(stay.map(i => i.kind)).toEqual(["message"]);
    const leave = read([
      ...start(), pic(9, 0, 10, "Reiri_Base", 1000, v), msg(common(9), 2, 1100),
      pic(9, 3, 10, "Reiri_Base", 1200, v), pic(9, 4, 10, "", 1300, { op: "erase" }), msg(common(9), 5, 1400),
    ]);
    expect(leave.map(i => i.kind)).toEqual(["message", "message"]);
    // shown long before it was erased (an overlay kept while walking around): not a cut-in
    const long = read([...start(), pic(9, 0, 12, "Overlay", 1000, v), pic(9, 1, 12, "", 60000, { op: "erase" }), msg(common(9), 2, 60100)]);
    expect(long.some(i => i.kind === "cutin")).toBe(false);
  });

  it("bridge screen records of the same moment: the one with more layers wins", () => {
    const recs = [...start(), log("x", 900), ...ce1New(1000), log("y", 2000)];
    // a screen record captured during the cut-in with fewer layers than its best frame is replaced
    const screenAt = (pics: unknown[], t: number) => R({ type: "screen", scene: "battle", pics }, t);
    const few = [...recs.slice(0, 5), screenAt([[2, "BreakCutin_Bust(Cloth)_0002", 0, -24, -30, 100, 100, 255, 0]], 1100), ...recs.slice(5)];
    few.forEach((r, i) => { r.seq = i + 1; });
    const scenes = new Map([[few[5].seq, { cg: [], stand: [{ id: 2, name: "BreakCutin_Bust(Cloth)_0002", origin: 0, x: -24, y: -30, scaleX: 100, scaleY: 100, opacity: 255, blendMode: 0 }] }]]);
    const a = read(few, scenes);
    expect(a.map(i => i.kind)).toEqual(["battlelog", "cutin", "battlelog"]);
    // ... but kept (and no cut-in) when it has more layers
    const p = (id: number, name: string) => ({ id, name, origin: 0, x: 0, y: 0, scaleX: 100, scaleY: 100, opacity: 255, blendMode: 0 });
    const rich = { cg: [], stand: [p(1, "BreakCutin_BackGround"), p(2, "BreakCutin_Bust(Cloth)_0002"), p(3, "BreakCutin_Effect"), p(4, "Extra"), p(5, "Extra2")] };
    const b = read(few, new Map([[few[5].seq, rich]]));
    expect(b.map(i => i.kind)).toEqual(["battlelog", "screen", "battlelog"]);
  });

  it("battle: a cut-in over a layered battle picture is not replaced by one screen record of it", () => {
    // a common event redraws a layered character (body/face/clothes) in battle; another shows an animated cut-in over it,
    // and the bridge captures the whole screen once during the animation
    const v = (x = 0, y = 0) => ({ origin: 0, x, y, scaleX: 100, scaleY: 100, opacity: 255, blend: 0 });
    const layered = (t: number, face: string) => [
      pic(20, 0, 33, "Battle_Back", t, v()), pic(20, 1, 45, "Hero_Base", t, v(400, 0)),
      pic(20, 2, 51, face, t, v(400, 0)), pic(20, 3, 55, "Hero_Cloth", t, v(400, 0)),
    ];
    let recs: LogRecord[] = [
      ...start(),
      R({ type: "battle", phase: "start", troopId: 1, troopName: "Goblin" }),
      ...layered(900, "Hero_Face"),
      log("Hero attacks!", 1000),
      pic(21, 0, 51, "Hero_Hurt", 1100, v(400, 0)),
      pic(22, 0, 75, "Insert_0001", 1101, v(100, 100)),
      pic(22, 1, 75, "Insert_0002", 1151, v(100, 100)),
      R({ type: "screen", scene: "battle", pics: [] }, 1160),
      pic(22, 2, 75, "Insert_0003", 1201, v(100, 100)),
      pic(22, 3, 75, "", 1300, { op: "erase" }),
      log("Goblin attacks Hero!", 1400),
      R({ type: "battle", phase: "end", troopId: 1, result: "win" }, 1500),
    ];
    recs = recs.map((r, i) => ({ ...r, seq: i + 1 }) as LogRecord);
    const screenSeq = recs.find(r => r.type === "screen")!.seq;
    const p = (id: number, name: string, x = 0, y = 0) => ({ id, name, origin: 0, x, y, scaleX: 100, scaleY: 100, opacity: 255, blendMode: 0 });
    // the screen record: the whole battle picture plus one frame of the cut-in (more layers than any cut-in frame)
    const shot = { cg: [p(33, "Battle_Back"), p(45, "Hero_Base", 400), p(51, "Hero_Hurt", 400), p(55, "Hero_Cloth", 400), p(75, "Insert_0002", 100, 100)], stand: [] };
    const items = read(recs, new Map([[screenSeq, shot]]));
    const battle = items.find(i => i.kind === "battle");
    expect(battle?.kind === "battle" && battle.items.map(i => i.kind)).toEqual(["battlelog", "cutin", "battlelog"]);
    const [cut] = cutins(items);
    expect(cut.frames.map(names)).toEqual(["Insert_0001", "Insert_0002", "Insert_0003"]);
    expect(cut.motion?.frames.length).toBeGreaterThan(1);
    // a screen record that has more cut-in layers than the stack knows (a plugin-drawn sprite) still wins
    const sprite = { ...p(1000, "Insert_Glow", 100, 100), kind: "sprite" as const };
    const richer = { cg: [...shot.cg, sprite, { ...sprite, id: 1001, name: "Insert_Spark" }], stand: [] };
    const kept = read(recs, new Map([[screenSeq, richer]]));
    const b2 = kept.find(i => i.kind === "battle");
    expect(b2?.kind === "battle" && b2.items.map(i => i.kind)).toEqual(["battlelog", "screen", "battlelog"]);
  });
});

describe("cutinRuns", () => {
  const step = (stack: ReadonlyMap<number, StackPicture>, rec: LogRecord): { stack: ReadonlyMap<number, StackPicture>; step: CutinStep } => {
    const next = applyPictureOp(stack, pictureOp(rec, data, SCREEN));
    return { stack: next, step: { rec: rec as RecordOf<"picture">, stack: next } };
  };

  it("splits runs where no cut-in picture is on screen and keeps at most one frame per moment", () => {
    seq = 0;
    const v = { origin: 0, x: 0, y: 0, scaleX: 100, scaleY: 100, opacity: 255, blend: 0 };
    const recs = [
      pic(9, 0, 1, "FinishBlow_Whiteout", 1000, v), pic(9, 1, 2, "cutin_1", 1000, v),
      pic(9, 2, 1, "", 1100, { op: "erase" }), pic(9, 3, 2, "", 1100, { op: "erase" }),
      pic(9, 4, 3, "cutin(Mermeia)_1", 1500, v), pic(9, 5, 3, "cutin(Mermeia)_2", 1583, v), pic(9, 6, 3, "", 1700, { op: "erase" }),
    ];
    let stack: ReadonlyMap<number, StackPicture> = new Map();
    const steps: CutinStep[] = [];
    for (const r of recs) { const s = step(stack, r); stack = s.stack; steps.push(s.step); }
    const runs = cutinRuns({ start: new Map(), steps, end: stack, endT: 1800 }, ctx);
    expect(runs.map(r => r.frames.map(names))).toEqual([["FinishBlow_Whiteout+cutin_1"], ["cutin(Mermeia)_1", "cutin(Mermeia)_2"]]);
  });

  it("gives each frame the game's real screen size at that record (1.18.2), none for old logs", () => {
    seq = 0;
    const v = { origin: 0, x: 0, y: 0, scaleX: 100, scaleY: 100, opacity: 255, blend: 0 };
    const recs = [pic(9, 0, 2, "cutin_1", 1000, v), pic(9, 1, 2, "", 1100, { op: "erase" })];
    let stack: ReadonlyMap<number, StackPicture> = new Map();
    const steps: CutinStep[] = [];
    for (const r of recs) { const s = step(stack, r); stack = s.stack; steps.push(s.step); }
    const seg = { start: new Map(), steps, end: stack, endT: 1200 };
    const real = { width: 1280, height: 720 };
    const sized = cutinRuns(seg, { ...ctx, sizes: [{ seq: recs[0].seq, size: real }] });
    expect(sized.map(r => r.frames.map(f => f.screen))).toEqual([[real]]);
    expect(cutinRuns(seg, ctx)[0].frames[0].screen).toBeUndefined();
  });

  it("never throws on broken input", () => {
    expect(cutinRuns({ start: new Map(), steps: [null as unknown as CutinStep], end: new Map(), endT: 0 }, ctx)).toEqual([]);
    expect(eraseCmdAfter(null as unknown as RecordOf<"picture">, null, data)).toBeNull();
  });
});
