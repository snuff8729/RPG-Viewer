import { beforeAll, describe, expect, it } from "vitest";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { choiceTexts } from "../../ui/live/historyText";
import { loadGame } from "../loader/loadGame";
import type { GameData } from "../types";
import { choiceFlow, type FlowItem } from "./choiceFlow";
import { pickKey } from "./coverage";
import { branchPath, buildHistory, foldTimeline } from "./history";
import { readerItems } from "./reader";
import type { LogRecord } from "./types";

let data: GameData;
beforeAll(async () => {
  const r = await loadGame(loadFixtureFolder("sample-mz"));
  if (!r.ok) throw new Error("load failed");
  data = r.data;
});

const base = { v: 1, t: 0, run: 1 } as const;
const src = { source: "map", mapId: 1, eventId: 1, page: 0 } as const;
type Pick = { picked: number; branch: number; seq: number };
const cov = (picks: Pick[]) => ({
  seen: new Set<string>(), uncertainSeqs: new Set<number>(), changedSeqs: new Set<number>(),
  picks: new Map([[pickKey(src, 2), picks.map(p => ({ ...p, run: 1, aftermath: [] }))]]),
});
const long = "가".repeat(50);
const recs = (picked: number, opts: string[]): LogRecord[] => [
  { ...base, branch: 1, seq: 1, type: "branchStart", reason: "newGame", parentBranch: null, fromSeq: null },
  { ...base, branch: 1, seq: 2, type: "message", src, cmd: 0, face: "", faceIndex: 0, speaker: "A", text: long },
  { ...base, branch: 1, seq: 3, type: "choices", src, cmd: 2, options: opts },
  { ...base, branch: 1, seq: 4, type: "choice", src, cmd: 2, picked },
  { ...base, branch: 2, seq: 5, type: "branchStart", reason: "load", parentBranch: 1, fromSeq: 4 },
] as LogRecord[];
const run = (rs: LogRecord[], branch: number, picks: Pick[], mutate?: (r: ReturnType<typeof readerItems>) => ReturnType<typeof readerItems>) => {
  const m = buildHistory(rs);
  const path = branchPath(rs, m, branch);
  const items = foldTimeline(path, m, {});
  const choiceText = choiceTexts(path, data);
  let reader = readerItems(items, data, choiceText, m);
  if (mutate) reader = mutate(reader);
  return choiceFlow({ items, reader, data, model: m, coverage: cov(picks), branch, choiceText });
};
const choiceOf = (f: FlowItem[]) => f.find(i => i.kind === "choice") as Extract<FlowItem, { kind: "choice" }>;

describe("choiceFlow synthetic", () => {
  it("inherited choice does not echo its own pick as elsewhere", () => {
    const c = choiceOf(run(recs(0, ["x", "y"]), 2, [{ picked: 0, branch: 1, seq: 4 }, { picked: 1, branch: 3, seq: 9 }]));
    expect(c.options).toEqual([
      { label: "x", picked: true, elsewhere: [] },
      { label: "y", picked: false, elsewhere: ["갈래 3"] },
    ]);
  });

  it("same-branch picks at another seq are not elsewhere", () => {
    const c = choiceOf(run(recs(0, ["x", "y"]), 1, [{ picked: 0, branch: 1, seq: 4 }, { picked: 1, branch: 1, seq: 30 }]));
    expect(c.options.map(o => o.elsewhere)).toEqual([[], []]);
  });

  it("clips question to 40 chars", () => {
    expect(choiceOf(run(recs(0, ["x"]), 1, [])).question?.text).toBe("가".repeat(40) + "…");
  });

  it("cancel appends and picks 취소; elsewhere de-duplicates", () => {
    const c = choiceOf(run(recs(-2, ["x", "y"]), 1, [
      { picked: -2, branch: 1, seq: 4 }, { picked: 0, branch: 7, seq: 20 }, { picked: 0, branch: 7, seq: 21 },
    ]));
    expect(c.options.map(o => [o.label, o.picked])).toEqual([["x", false], ["y", false], ["취소", true]]);
    expect(c.options[0].elsewhere).toEqual(["갈래 7"]);
  });

  it("resyncs when reader has an extra or missing entry", () => {
    const extra = run(recs(0, ["x"]), 1, [], r => [{ kind: "battle", key: "r999", seq: 999 }, ...r]);
    const missing = run(recs(0, ["x"]), 1, [], r => r.filter(i => i.key !== "r2"));
    expect(extra.some(i => i.kind === "choice")).toBe(true);
    expect(missing.some(i => i.kind === "choice")).toBe(true);
  });

  it("falls back to the reader label when no choices record is on the path", () => {
    const c = choiceOf(run(recs(1, ["x", "y"]).filter(r => r.type !== "choices"), 1, []));
    expect(c.options).toHaveLength(1);
    expect(c.options[0].picked).toBe(true);
    expect(c.options[0].label.length).toBeGreaterThan(0);
  });

  it("falls back to the reader label when picked is out of range", () => {
    const c = choiceOf(run(recs(5, ["x", "y"]), 1, []));
    const picked = c.options.filter(o => o.picked);
    expect(picked).toHaveLength(1);
    expect(picked[0].label.length).toBeGreaterThan(0);
    expect(c.options.slice(0, 2).map(o => o.picked)).toEqual([false, false]);
  });

  it("counts lines, not boxes", () => {
    const rs = recs(0, ["x"]);
    (rs[1] as { text: string }).text = "a\nb\nc";
    const seg = run(rs, 1, []).find(i => i.kind === "segment") as Extract<FlowItem, { kind: "segment" }>;
    expect(seg.messages).toBe(3);
  });

  it("excludes picks whose seq belongs to this path from elsewhere", () => {
    const c = choiceOf(run(recs(0, ["x", "y"]), 1, [
      { picked: 1, branch: 9, seq: 2 }, { picked: 1, branch: 8, seq: 99 },
    ]));
    expect(c.options[1].elsewhere).toEqual(["갈래 8"]);
  });

  it("stays fast with thousands of state/save records between reader items", () => {
    const rs: LogRecord[] = [recs(0, ["x", "y"])[0]];
    let seq = 2;
    for (let i = 0; i < 3000; i++) rs.push({ ...base, branch: 1, seq: seq++, type: "save", slot: 1 } as LogRecord);
    for (let i = 0; i < 2000; i++) {
      rs.push({ ...base, branch: 1, seq: seq++, type: "message", src, cmd: i, face: "", faceIndex: 0, speaker: "A", text: `t${i}` } as LogRecord);
      for (let j = 0; j < 3; j++) rs.push({ ...base, branch: 1, seq: seq++, type: "save", slot: 1 } as LogRecord);
    }
    const t0 = performance.now();
    const f = run(rs, 1, []);
    const ms = performance.now() - t0;
    console.log(`choiceFlow perf: ${ms.toFixed(1)}ms`);
    expect(f.find(i => i.kind === "segment")).toBeDefined();
    expect(ms).toBeLessThan(50);
  });
});
