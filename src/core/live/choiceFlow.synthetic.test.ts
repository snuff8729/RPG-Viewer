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
});
