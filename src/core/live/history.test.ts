import { describe, expect, it } from "vitest";
import { fixtureRecords } from "../../../tests/helpers/fixtureLog";
import { branchLabel, branchPath, buildHistory, foldTimeline, noisyVariables } from "./history";
import type { HistoryItem, LogRecord } from "./types";

const base = { v: 1, run: 1, branch: 1 } as const;
const src = (eventId: number) => ({ source: "map", mapId: 1, eventId, page: 0 }) as const;
const start = { ...base, seq: 1, t: 0, type: "branchStart", reason: "newGame", parentBranch: null, fromSeq: null } as const;
const msg = (seq: number, eventId: number, cmd: number) =>
  ({ ...base, seq, t: 0, type: "message", src: src(eventId), cmd, face: "", faceIndex: 0, speaker: "", text: `m${cmd}` }) as const;
const kinds = (items: HistoryItem[]) => items.map(i => i.kind === "record" ? i.record.seq : i.kind);

describe("history model", () => {
  it("builds branches", () => {
    const m = buildHistory(fixtureRecords());
    expect([...m.branches.keys()]).toEqual([1, 2, 3]);
    expect(m.branches.get(2)).toMatchObject({ run: 1, parent: 1, fromSeq: 8, reason: "load" });
    expect(m.branches.get(1)!.children).toEqual([2]);
    expect(m.runs).toEqual([{ run: 1, branches: [1, 2] }, { run: 2, branches: [3] }]);
    expect(m.latestBranch).toBe(3);
  });
  it("tracks start/last seq and time", () => {
    const m = buildHistory(fixtureRecords());
    expect(m.branches.get(1)).toMatchObject({ startSeq: 1, startT: 1001000, lastSeq: 27, lastT: 1027000 });
    expect(m.branches.get(2)).toMatchObject({ startSeq: 28, lastSeq: 31 });
  });
  it("labels", () => {
    const m = buildHistory(fixtureRecords());
    expect(branchLabel(m, 2)).toBe("1회차 갈래 2"); expect(branchLabel(m, 3)).toBe("2회차 갈래 1");
  });
  it("branch path includes ancestor up to fromSeq", () => {
    const recs = fixtureRecords(); const m = buildHistory(recs);
    expect(branchPath(recs, m, 2).map(r => r.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 28, 29, 30, 31]);
    expect(branchPath(recs, m, 3).map(r => r.seq)).toEqual([32, 33, 34, 35]);
    expect(branchPath(recs, m, 99)).toEqual([]);
  });
  it("noisy variables", () => expect(noisyVariables(fixtureRecords())).toEqual(new Set([5])));
  it("ignores run/branch 0, unknown parents and out-of-order records without throwing", () => {
    const recs = [
      { ...base, seq: 3, t: 3, branch: 2, type: "branchStart", reason: "load", parentBranch: 77, fromSeq: 1 },
      { v: 1, seq: 2, t: 2, run: 0, branch: 0, type: "error", message: "title" },
      start,
      { ...base, seq: 4, t: 4, branch: 2, type: "save", slot: 1 },
    ] as LogRecord[];
    const m = buildHistory(recs);
    expect([...m.branches.keys()]).toEqual([1, 2]);
    expect(m.runs).toEqual([{ run: 1, branches: [1, 2] }]);
    expect(m.latestBranch).toBe(2);
    expect(branchPath(recs, m, 2).map(r => r.seq)).toEqual([3, 4]);
    expect(() => foldTimeline(recs, m, {})).not.toThrow();
  });
});

describe("foldTimeline", () => {
  it("folds branch 1", () => {
    const recs = fixtureRecords(); const m = buildHistory(recs);
    const items = foldTimeline(branchPath(recs, m, 1), m, {});
    expect(kinds(items)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, "fork", 9, 10, 11, 12, "repeat", 27]);
    expect(items.find(i => i.kind === "repeat")).toMatchObject({ count: 2 });
    expect(items.find(i => i.kind === "fork")).toMatchObject({ atSeq: 8, branches: [1, 2] });
  });
  it("fork on a child path lists the continuing branch first", () => {
    const recs = fixtureRecords(); const m = buildHistory(recs);
    const items = foldTimeline(branchPath(recs, m, 2), m, {});
    expect(kinds(items)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, "fork", 28, 29, 30, 31]);
    expect(items.find(i => i.kind === "fork")).toMatchObject({ atSeq: 8, branches: [2, 1] });
  });
  it("groups unrelated state changes", () => {
    const recs = [start,
      { ...base, seq: 2, t: 0, type: "state", src: null, cmd: null, changes: [{ kind: "switch", id: 2, value: true }] },
      { ...base, seq: 3, t: 0, type: "state", src: null, cmd: null, changes: [{ kind: "switch", id: 3, value: true }] }] as LogRecord[];
    const items = foldTimeline(recs, buildHistory(recs), {});
    expect(items[1]).toMatchObject({ kind: "stateGroup", count: 2 });
    expect(items).toHaveLength(2);
  });
  it("keeps state with the same src as the preceding dialogue episode inline", () => {
    const recs = [start, msg(2, 1, 0),
      { ...base, seq: 3, t: 0, type: "state", src: src(1), cmd: 2, changes: [{ kind: "switch", id: 1, value: true }] },
      { ...base, seq: 4, t: 0, type: "state", src: src(9), cmd: 0, changes: [{ kind: "switch", id: 2, value: true }] }] as LogRecord[];
    expect(kinds(foldTimeline(recs, buildHistory(recs), {}))).toEqual([1, 2, 3, "stateGroup"]);
  });
  it("does not fold episodes with choices, and repeat needs same cmd order", () => {
    const recs = [start, msg(2, 1, 0), msg(3, 1, 2),
      msg(4, 1, 0), msg(5, 1, 2),          // repeat of [0,2]
      msg(6, 1, 0),                        // [0] — different signature
      msg(7, 1, 0),
      { ...base, seq: 8, t: 0, type: "choices", src: src(1), cmd: 1, options: ["a"] }, // [0]+choices — not folded
    ] as LogRecord[];
    const items = foldTimeline(recs, buildHistory(recs), {});
    expect(kinds(items)).toEqual([1, 2, 3, "repeat", 6, 7, 8]);
    expect(items[3]).toMatchObject({ kind: "repeat", count: 1, record: { seq: 4 } });
  });
  it("drops state records left empty after removing noisy variables", () => {
    const recs: LogRecord[] = [start];
    for (let i = 0; i < 11; i++) recs.push({ ...base, seq: 2 + i, t: i * 1000, type: "state", src: null, cmd: null,
      changes: [{ kind: "variable", id: 7, value: i }, ...(i === 0 ? [{ kind: "switch" as const, id: 1, value: true }] : [])] });
    const items = foldTimeline(recs, buildHistory(recs), {});
    expect(kinds(items)).toEqual([1, "stateGroup"]);
    expect(items[1]).toMatchObject({ count: 1, records: [{ seq: 2, changes: [{ kind: "switch", id: 1 }] }] });
  });
  it("marks uncertain records", () => {
    const recs = [start, msg(2, 1, 0), msg(3, 2, 0)] as LogRecord[];
    const items = foldTimeline(recs, buildHistory(recs), { uncertainSeqs: new Set([2]) });
    expect(items[1]).toMatchObject({ kind: "record", uncertain: true, record: { seq: 2 } });
    expect(items[2]).toMatchObject({ kind: "record", uncertain: false });
  });
  it("noisy-only state does not split a dialogue episode", () => {
    const noisyState = (seq: number) => ({ ...base, seq, t: 0, type: "state", src: null, cmd: null,
      changes: [{ kind: "variable", id: 7, value: seq }] }) as LogRecord;
    const recs = [start, msg(2, 1, 0), noisyState(3), msg(4, 1, 1),
      msg(5, 1, 0), noisyState(6), msg(7, 1, 1)] as LogRecord[];
    const items = foldTimeline(recs, buildHistory(recs), { noisy: new Set([7]) });
    expect(kinds(items)).toEqual([1, 2, 4, "repeat"]);
    expect(items[3]).toMatchObject({ kind: "repeat", count: 1, record: { seq: 5 } });
  });
  it("uses opts.noisy instead of computing from the path", () => {
    const recs = [start,
      { ...base, seq: 2, t: 0, type: "state", src: null, cmd: null, changes: [{ kind: "variable", id: 9, value: 1 }] },
      { ...base, seq: 3, t: 0, type: "state", src: null, cmd: null, changes: [{ kind: "variable", id: 4, value: 1 }] }] as LogRecord[];
    const items = foldTimeline(recs, buildHistory(recs), { noisy: new Set([9]) });
    expect(items[1]).toMatchObject({ kind: "stateGroup", count: 1, records: [{ seq: 3 }] });
    expect(foldTimeline(recs, buildHistory(recs), {})[1]).toMatchObject({ kind: "stateGroup", count: 2 });
    // 경로만으로는 잦지 않던 변수도 opts.noisy로 제외되고, 경로상 잦은 변수라도 opts.noisy에 없으면 남는다
    const fix = fixtureRecords(); const m = buildHistory(fix);
    const kept = foldTimeline(branchPath(fix, m, 1), m, { noisy: new Set() });
    expect(kept.find(i => i.kind === "stateGroup")).toMatchObject({ count: 12 });
  });
  it("uncertain episode does not seed repeat detection", () => {
    const recs = [start, msg(2, 1, 0), msg(3, 9, 0), msg(4, 1, 0)] as LogRecord[];
    const items = foldTimeline(recs, buildHistory(recs), { uncertainSeqs: new Set([2]) });
    expect(kinds(items)).toEqual([1, 2, 3, 4]);
  });
  it("handles empty path",() => expect(foldTimeline([], buildHistory([]), {})).toEqual([]));
});
