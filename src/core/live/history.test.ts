import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureRecords } from "../../../tests/helpers/fixtureLog";
import { branchLabel, branchPath, buildHistory, foldTimeline, noisyVariables, representative } from "./history";
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
  it("a variable with any throttled change is noisy even with few changes", () => {
    const st = (seq: number, changes: unknown[]) =>
      ({ ...base, seq, t: seq * 20_000, type: "state", src: null, cmd: null, changes }) as unknown as LogRecord;
    const recs = [start, st(2, [{ kind: "variable", id: 3, value: 1 }, { kind: "variable", id: 4, value: 1, throttled: true }]),
      st(3, [{ kind: "variable", id: 3, value: 2 }, { kind: "switch", id: 5, value: true, throttled: true }])] as LogRecord[];
    expect(noisyVariables(recs)).toEqual(new Set([4]));
  });
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
  it("marks changed records", () => {
    const recs = [start, msg(2, 1, 0), msg(3, 2, 0)] as LogRecord[];
    const items = foldTimeline(recs, buildHistory(recs), { changedSeqs: new Set([3]) });
    expect(items[1]).toMatchObject({ kind: "record", changed: false, uncertain: false, record: { seq: 2 } });
    expect(items[2]).toMatchObject({ kind: "record", changed: true, record: { seq: 3 } });
    expect(foldTimeline(recs, buildHistory(recs), {})[1]).toMatchObject({ kind: "record", changed: false });
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

describe("seq order", () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it("does not sort records that are already in seq order", () => {
    const recs = fixtureRecords();
    const model0 = buildHistory(recs);
    const spy = vi.spyOn(Array.prototype, "sort");
    const model = buildHistory(recs);
    const path = branchPath(recs, model, 2);
    // 회차 목록(작은 배열) 정렬은 괜찮다 — 기록 배열은 정렬하지 않는다
    const recordSorts = spy.mock.contexts.filter(c => Array.isArray(c) && c.some(x => x && typeof x === "object" && "seq" in x));
    expect(recordSorts).toHaveLength(0);
    spy.mockRestore();
    expect(model.latestBranch).toBe(model0.latestBranch);
    expect(path.map(r => r.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 28, 29, 30, 31]);
  });
  it("still sorts out-of-order records", () => {
    const recs = [...fixtureRecords()].reverse();
    const model = buildHistory(recs);
    expect(branchPath(recs, model, 2).map(r => r.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 28, 29, 30, 31]);
  });
});

describe("save-load continuations", () => {
  type Opts = { run?: number; branch: number };
  const at = (o: Opts, seq: number) => ({ v: 1, seq, t: seq * 1000, run: o.run ?? 1, branch: o.branch }) as const;
  const bs = (o: Opts, seq: number, reason: "newGame" | "load", parentBranch: number | null, fromSeq: number | null) =>
    ({ ...at(o, seq), type: "branchStart", reason, parentBranch, fromSeq }) as LogRecord;
  const m = (o: Opts, seq: number, eventId = 1) =>
    ({ ...at(o, seq), type: "message", src: src(eventId), cmd: seq, face: "", faceIndex: 0, speaker: "", text: `m${seq}` }) as LogRecord;
  const st = (o: Opts, seq: number) =>
    ({ ...at(o, seq), type: "state", src: null, cmd: null, changes: [{ kind: "switch", id: seq, value: true }] }) as LogRecord;
  const save = (o: Opts, seq: number) => ({ ...at(o, seq), type: "save", slot: 1 }) as LogRecord;
  const b1 = { branch: 1 }, b2 = { branch: 2 }, b3 = { branch: 3 };

  // 새 게임 b1, seq 10에 저장, 상태 기록 몇 개, 불러오기 → b2(부모 1, 10부터)
  const contLog = (): LogRecord[] => [
    bs(b1, 1, "newGame", null, null), m(b1, 2), m(b1, 3), save(b1, 10), st(b1, 11), st(b1, 12),
    bs(b2, 13, "load", 1, 10), m(b2, 14, 2), m(b2, 15, 2), st(b2, 16),
  ];

  it("a load with no story after the save point continues the parent branch", () => {
    const recs = contLog(); const model = buildHistory(recs);
    expect(model.runs).toEqual([{ run: 1, branches: [1] }]);
    expect(model.alias).toEqual(new Map([[2, 1]]));
    expect(representative(model, 2)).toBe(1);
    expect(representative(model, 1)).toBe(1);
    expect(representative(model, 99)).toBe(99);
    expect(branchLabel(model, 2)).toBe("1회차 갈래 1");
    expect(branchLabel(model, 1)).toBe("1회차 갈래 1");
    expect(model.latestBranch).toBe(1);
    const all = [1, 2, 3, 10, 11, 12, 13, 14, 15, 16];
    expect(branchPath(recs, model, 1).map(r => r.seq)).toEqual(all);
    expect(branchPath(recs, model, 2).map(r => r.seq)).toEqual(all);
    expect(foldTimeline(branchPath(recs, model, 1), model, {}).some(i => i.kind === "fork")).toBe(false);
    // 원본 갈래 정보는 그대로 남는다
    expect(model.branches.get(2)).toMatchObject({ parent: 1, fromSeq: 10, reason: "load" });
  });

  it("a load after story in the parent past the save point is a real branch", () => {
    const recs = [
      bs(b1, 1, "newGame", null, null), m(b1, 2), save(b1, 10), m(b1, 11), st(b1, 12),
      bs(b2, 13, "load", 1, 10), m(b2, 14, 2),
    ];
    const model = buildHistory(recs);
    expect(model.runs).toEqual([{ run: 1, branches: [1, 2] }]);
    expect(model.alias.size).toBe(0);
    expect(branchLabel(model, 2)).toBe("1회차 갈래 2");
    expect(model.latestBranch).toBe(2);
    expect(branchPath(recs, model, 1).map(r => r.seq)).toEqual([1, 2, 10, 11, 12]);
    expect(branchPath(recs, model, 2).map(r => r.seq)).toEqual([1, 2, 10, 13, 14]);
    expect(foldTimeline(branchPath(recs, model, 2), model, {}).find(i => i.kind === "fork"))
      .toMatchObject({ atSeq: 10, branches: [2, 1] });
  });

  it("chains of continuations collapse into one branch", () => {
    const recs = [...contLog(), save(b2, 20), st(b2, 21), bs(b3, 22, "load", 2, 20), m(b3, 23, 3)];
    const model = buildHistory(recs);
    expect(model.runs).toEqual([{ run: 1, branches: [1] }]);
    expect(model.alias).toEqual(new Map([[2, 1], [3, 1]]));
    expect(branchLabel(model, 3)).toBe("1회차 갈래 1");
    expect(model.latestBranch).toBe(1);
    const all = recs.map(r => r.seq);
    for (const id of [1, 2, 3]) expect(branchPath(recs, model, id).map(r => r.seq)).toEqual(all);
    expect(foldTimeline(branchPath(recs, model, 3), model, {}).some(i => i.kind === "fork")).toBe(false);
  });

  it("story in an earlier continuation makes a second load of the same save a real fork", () => {
    // b1 저장(10) → b2 이어짐(이야기 진행) → 같은 저장을 다시 불러옴 → b3는 진짜 갈래
    const recs = [...contLog(), bs(b3, 17, "load", 1, 10), m(b3, 18, 3)];
    const model = buildHistory(recs);
    expect(model.runs).toEqual([{ run: 1, branches: [1, 3] }]);
    expect(model.alias).toEqual(new Map([[2, 1]]));
    expect(branchLabel(model, 3)).toBe("1회차 갈래 2");
    expect(branchPath(recs, model, 1).map(r => r.seq)).toEqual([1, 2, 3, 10, 11, 12, 13, 14, 15, 16]);
    expect(branchPath(recs, model, 3).map(r => r.seq)).toEqual([1, 2, 3, 10, 17, 18]);
    expect(foldTimeline(branchPath(recs, model, 1), model, {}).find(i => i.kind === "fork"))
      .toMatchObject({ atSeq: 10, branches: [1, 3] });
    expect(foldTimeline(branchPath(recs, model, 3), model, {}).find(i => i.kind === "fork"))
      .toMatchObject({ atSeq: 10, branches: [3, 1] });
  });

  it("a real fork from a continuation is reported against the representative", () => {
    // b1 → b2 이어짐, b2에서 저장(20) 뒤 이야기 → 불러오기 b3(부모 2, 20부터)는 진짜 갈래
    const recs = [...contLog(), save(b2, 20), m(b2, 21, 2), bs(b3, 22, "load", 2, 20), m(b3, 23, 3)];
    const model = buildHistory(recs);
    expect(model.runs).toEqual([{ run: 1, branches: [1, 3] }]);
    expect(branchLabel(model, 3)).toBe("1회차 갈래 2");
    expect(branchPath(recs, model, 3).map(r => r.seq)).toEqual([1, 2, 3, 10, 11, 12, 13, 14, 15, 16, 20, 22, 23]);
    expect(foldTimeline(branchPath(recs, model, 1), model, {}).find(i => i.kind === "fork"))
      .toMatchObject({ atSeq: 20, branches: [1, 3] });
    expect(foldTimeline(branchPath(recs, model, 3), model, {}).find(i => i.kind === "fork"))
      .toMatchObject({ atSeq: 20, branches: [3, 1] });
  });

  it("only load starts in the same run can continue", () => {
    const recs = [
      bs(b1, 1, "newGame", null, null), save(b1, 2),
      bs({ branch: 2, run: 2 }, 3, "newGame", null, null),
      bs({ branch: 3, run: 2 }, 4, "load", 1, 2),   // 다른 회차의 부모
    ];
    const model = buildHistory(recs);
    expect(model.runs).toEqual([{ run: 1, branches: [1] }, { run: 2, branches: [2, 3] }]);
    expect(model.alias.size).toBe(0);
  });

  it("the decision is made when the branch starts; later parent records do not flip it", () => {
    // 비정상 기록: 이어진 뒤에 부모 갈래에 이야기가 붙는다
    const recs = [...contLog(), m(b1, 30)];
    const model = buildHistory(recs);
    expect(model.alias).toEqual(new Map([[2, 1]]));
    expect(model.runs).toEqual([{ run: 1, branches: [1] }]);
  });
});
