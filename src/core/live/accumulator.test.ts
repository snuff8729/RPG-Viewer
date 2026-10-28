import { beforeAll, describe, expect, it } from "vitest";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { fixtureRecords } from "../../../tests/helpers/fixtureLog";
import { loadGame } from "../loader/loadGame";
import type { GameData } from "../types";
import { createAccumulator, type LiveAccumulator } from "./accumulator";
import { computeCoverage } from "./coverage";
import { buildHistory, noisyVariables } from "./history";
import type { Coverage, HistoryModel, LogRecord } from "./types";

let data: GameData;
beforeAll(async () => {
  const r = await loadGame(loadFixtureFolder("sample-mz"));
  if (!r.ok) throw new Error("load failed");
  data = r.data;
});

/** 삽입 순서까지 비교하도록 Map/Set을 배열로 펼친다. */
const normModel = (m: HistoryModel) => ({
  branches: [...m.branches.entries()], runs: m.runs, alias: [...m.alias.entries()], latestBranch: m.latestBranch,
});
const normCov = (c: Coverage) => ({
  seen: [...c.seen], picks: [...c.picks.entries()], uncertainSeqs: [...c.uncertainSeqs], changedSeqs: [...c.changedSeqs],
  touched: [...c.touched], pluginRan: [...c.pluginRan],
});
const normNoisy = (s: Set<number>) => [...s].sort((a, b) => a - b);

function expectSameAsBatch(acc: LiveAccumulator) {
  const all = acc.records;
  expect(normModel(acc.model())).toEqual(normModel(buildHistory(all)));
  expect(normCov(acc.coverage())).toEqual(normCov(computeCoverage(all, data)));
  expect(normNoisy(acc.noisy())).toEqual(normNoisy(noisyVariables(all)));
}

/** 결정적 의사난수 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

/** 픽스처를 K번 이어 붙인 큰 기록(회차·갈래·seq를 밀고, 이상한 기록·뒤섞인 시각의 잦은 변수 포함) */
function bigLog(copies: number, seed = 1): LogRecord[] {
  const base = fixtureRecords();
  const rand = rng(seed);
  const out: LogRecord[] = [];
  let seq = 0;
  for (let k = 0; k < copies; k++) {
    for (const r of base) {
      seq++;
      const shifted = {
        ...r, seq, t: r.t + k * 40_000, run: r.run + 2 * k, branch: r.branch + 3 * k,
      } as LogRecord;
      if (shifted.type === "branchStart" && shifted.parentBranch !== null) {
        shifted.parentBranch = shifted.parentBranch + 3 * k;
        shifted.fromSeq = (shifted.fromSeq ?? 0) + seq - r.seq;
      }
      out.push(shifted);
    }
    // 같은 갈래 사이를 오가며 시각이 뒤섞인 변수 변경
    for (let j = 0; j < 4; j++) {
      seq++;
      out.push({
        v: 1, seq, t: 1_000_000 + Math.floor(rand() * 400_000), run: 1 + 2 * k, branch: 1 + 3 * k,
        type: "state", src: null, cmd: null, changes: [{ kind: "variable", id: 7 + (j % 2), value: j }],
      });
    }
    // 플러그인 명령 기록(원래 페이지 실행 위치 포함 — 데이터에 없으면 위치 불확실이지만 페이지는 실행된 것)
    seq++;
    out.push({
      v: 1, seq, t: 1_000_500 + k * 40_000, run: 1 + 2 * k, branch: 1 + 3 * k, type: "plugin",
      src: { source: "map", mapId: 2, eventId: 1 + (k % 3), page: k % 2, ...(k % 2 ? { origin: 0 } : {}) }, cmd: k % 4, code: 356, text: `p${k}`,
    });
    // 플러그인이 조절한(throttled) 드문 변수 변경: 횟수와 관계없이 잦은 변수
    if (k % 4 === 1) {
      seq++;
      out.push({
        v: 1, seq, t: 2_000_000 + k * 40_000, run: 1 + 2 * k, branch: 1 + 3 * k,
        type: "state", src: null, cmd: null, changes: [{ kind: "variable", id: 20 + k, value: k, throttled: true }],
      });
    }
    if (k % 3 === 0) out.push(null as unknown as LogRecord, { v: 1, t: 0 } as unknown as LogRecord);
  }
  return out;
}

/** 저장 → 종료 → 이어하기로 생긴 이어진 갈래들과 진짜 갈래가 섞인 기록 */
function continuationLog(): LogRecord[] {
  let seq = 0;
  const at = (branch: number, run = 1) => ({ v: 1 as const, seq: ++seq, t: seq * 1000, run, branch });
  const start = (branch: number, reason: "newGame" | "load", parentBranch: number | null, fromSeq: number | null, run = 1) =>
    ({ ...at(branch, run), type: "branchStart", reason, parentBranch, fromSeq }) as LogRecord;
  const msg = (branch: number, run = 1) => {
    const base = at(branch, run);
    return { ...base, type: "message", src: { source: "map", mapId: 1, eventId: branch, page: 0 }, cmd: base.seq,
      face: "", faceIndex: 0, speaker: "", text: `m${base.seq}` } as LogRecord;
  };
  const state = (branch: number) =>
    ({ ...at(branch), type: "state", src: null, cmd: null, changes: [{ kind: "switch", id: seq, value: true }] }) as LogRecord;
  const save = (branch: number, run = 1) => ({ ...at(branch, run), type: "save", slot: 1 }) as LogRecord;
  const out: LogRecord[] = [start(1, "newGame", null, null), msg(1), msg(1)];
  out.push(save(1)); const s1 = seq;
  out.push(state(1), state(1), start(2, "load", 1, s1), msg(2), state(2));
  out.push(save(2)); const s2 = seq;
  out.push(state(2), start(3, "load", 2, s2), msg(3), msg(3));
  out.push(start(4, "load", 1, s1), msg(4));
  out.push(save(4)); const s4 = seq;
  out.push(start(5, "load", 4, s4), msg(5), start(6, "newGame", null, null, 2), msg(6, 2));
  return out;
}

function chunksOf<T>(list: T[], rand: () => number, max: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length;) {
    const n = 1 + Math.floor(rand() * max);
    out.push(list.slice(i, i + n));
    i += n;
  }
  return out;
}

describe("createAccumulator", () => {
  it("whole fixture at once equals batch", () => {
    const acc = createAccumulator(data);
    acc.append(fixtureRecords());
    expectSameAsBatch(acc);
    expect(acc.coverage().picks.get("map:2:1:0#10")!.map(p => p.aftermath)).toEqual([
      ['촌장: "고맙네!"', "스위치 숲 개방 → ON", "🚪 숲 입구 이동"], ['(내레이션): "밤이 깊었다."'],
    ]);
    expect(acc.noisy().has(5)).toBe(true);
  });

  it("a throttled change makes a variable noisy incrementally, same as batch", () => {
    const st = (seq: number, t: number, changes: unknown[]) =>
      ({ v: 1, seq, t, run: 1, branch: 1, type: "state", src: null, cmd: null, changes }) as unknown as LogRecord;
    const acc = createAccumulator(data);
    acc.append([st(1, 0, [{ kind: "variable", id: 9, value: 1 }])]);
    expect(acc.noisy().has(9)).toBe(false);
    expectSameAsBatch(acc);
    acc.append([st(2, 30_000, [{ kind: "variable", id: 9, value: 2, throttled: true }, { kind: "switch", id: 9, value: true, throttled: true }])]);
    expect(acc.noisy().has(9)).toBe(true);
    expectSameAsBatch(acc);
  });

  it("one record at a time equals batch after every step", () => {
    const acc = createAccumulator(data);
    for (const r of fixtureRecords()) {
      acc.append([r]);
      expectSameAsBatch(acc);
    }
  });

  it("random chunk sizes on a big log equal batch", () => {
    const log = bigLog(30);
    for (const seed of [1, 2, 3]) {
      const rand = rng(seed);
      const acc = createAccumulator(data);
      for (const chunk of chunksOf(log, rand, 50)) {
        acc.append(chunk);
        if (rand() < 0.2) expectSameAsBatch(acc);
      }
      expectSameAsBatch(acc);
    }
  });

  it("out-of-order chunks still equal batch (rebuild path)", () => {
    const log = bigLog(10, 5);
    const rand = rng(9);
    const chunks = chunksOf(log, rand, 20);
    // 인접 묶음을 몇 군데 맞바꿔 seq가 거꾸로 들어오게 한다
    for (let i = 0; i + 1 < chunks.length; i += 4) [chunks[i], chunks[i + 1]] = [chunks[i + 1], chunks[i]];
    const acc = createAccumulator(data);
    for (const c of chunks) {
      acc.append(c);
      expectSameAsBatch(acc);
    }
    // 한 묶음 안에서 거꾸로
    const acc2 = createAccumulator(data);
    acc2.append(fixtureRecords().slice().reverse());
    expectSameAsBatch(acc2);
  });

  it("save-load continuations equal batch in order, in chunks and out of order", () => {
    const log = continuationLog();
    const model = buildHistory(log);
    // 1←2←3 이어짐, 4는 진짜 갈래(1에서 이야기가 이미 진행됨), 5는 4의 이어짐, 6은 2회차 새 게임
    expect(model.alias).toEqual(new Map([[2, 1], [3, 1], [5, 4]]));
    expect(model.runs).toEqual([{ run: 1, branches: [1, 4] }, { run: 2, branches: [6] }]);
    const one = createAccumulator(data);
    for (const r of log) {
      one.append([r]);
      expectSameAsBatch(one);
    }
    for (const seed of [1, 2, 3]) {
      const rand = rng(seed);
      const chunks = chunksOf(log, rand, 4);
      if (seed === 3) for (let i = 0; i + 1 < chunks.length; i += 3) [chunks[i], chunks[i + 1]] = [chunks[i + 1], chunks[i]];
      const acc = createAccumulator(data);
      for (const c of chunks) {
        acc.append(c);
        expectSameAsBatch(acc);
      }
    }
  });

  it("a pick just before save → quit → continue gets its aftermath from the continuation", () => {
    const fix = fixtureRecords();
    const head = fix.filter(r => r.seq <= 9);   // ... 선택(seq 9)까지
    const tail = fix.filter(r => r.seq === 10 || r.seq === 11).map((r, i) => ({ ...r, seq: 22 + i, branch: 2 }) as LogRecord);
    const log: LogRecord[] = [
      ...head,
      { v: 1, seq: 20, t: 1_020_000, run: 1, branch: 1, type: "save", slot: 1 },
      { v: 1, seq: 21, t: 1_021_000, run: 1, branch: 2, type: "branchStart", reason: "load", parentBranch: 1, fromSeq: 20 },
      ...tail,
    ];
    expect(buildHistory(log).alias).toEqual(new Map([[2, 1]]));
    const batch = computeCoverage(log, data);
    expect(batch.picks.get("map:2:1:0#10")!.map(p => p.aftermath)).toEqual([['촌장: "고맙네!"', "스위치 숲 개방 → ON"]]);
    const acc = createAccumulator(data);
    for (const r of log) {
      acc.append([r]);
      expectSameAsBatch(acc);
    }
    const rev = createAccumulator(data);
    rev.append(log.slice().reverse());
    expectSameAsBatch(rev);
  });

  it("aftermath of a pick in branch 2 fills as later records arrive", () => {
    const recs = fixtureRecords();
    const upTo = (s: number) => recs.filter(r => r.seq <= s);
    const acc = createAccumulator(data);
    acc.append(upTo(30));
    expectSameAsBatch(acc);
    const pick2 = () => acc.coverage().picks.get("map:2:1:0#10")!.find(p => p.branch === 2)!;
    expect(pick2().aftermath).toEqual([]);
    // 다른 갈래의 기록은 갈래 2의 결과에 들어가지 않는다
    const other: LogRecord = { v: 1, seq: 30.5, t: 1030500, run: 1, branch: 1, type: "transfer", mapId: 3, x: 0, y: 0 };
    acc.append([other]);
    expect(pick2().aftermath).toEqual([]);
    acc.append(recs.filter(r => r.seq > 30));
    expect(pick2().aftermath).toEqual(['(내레이션): "밤이 깊었다."']);
    expectSameAsBatch(acc);
  });

  it("a later choice in the same branch closes the earlier pick", () => {
    const src = { source: "map" as const, mapId: 2, eventId: 1, page: 0 };
    const recs: LogRecord[] = [
      { v: 1, seq: 1, t: 1, run: 1, branch: 1, type: "choices", src, cmd: 10, options: ["네, 도울게요", "생각해볼게요"] },
      { v: 1, seq: 2, t: 2, run: 1, branch: 1, type: "choice", src, cmd: 10, picked: 0 },
      { v: 1, seq: 3, t: 3, run: 1, branch: 1, type: "transfer", mapId: 3, x: 0, y: 0 },
      { v: 1, seq: 4, t: 4, run: 1, branch: 1, type: "choice", src, cmd: 10, picked: 1 },
      { v: 1, seq: 5, t: 5, run: 1, branch: 1, type: "transfer", mapId: 3, x: 0, y: 0 },
    ];
    const acc = createAccumulator(data);
    for (const r of recs) acc.append([r]);
    expectSameAsBatch(acc);
    expect(acc.coverage().picks.get("map:2:1:0#10")!.map(p => p.aftermath.length)).toEqual([1, 1]);
  });

  it("returns the same objects until the version changes; reset empties", () => {
    const acc = createAccumulator(data);
    const v0 = acc.version;
    acc.append(fixtureRecords().slice(0, 10));
    expect(acc.version).toBe(v0 + 1);
    const m = acc.model(), c = acc.coverage(), n = acc.noisy();
    expect(acc.model()).toBe(m);
    expect(acc.coverage()).toBe(c);
    expect(acc.noisy()).toBe(n);
    acc.append(fixtureRecords().slice(10));
    expect(acc.model()).not.toBe(m);
    expect(acc.coverage()).not.toBe(c);
    expect(acc.noisy()).not.toBe(n);
    // 이전 결과는 그대로(나중 append로 바뀌지 않음)
    expect(m.branches.size).toBe(1);
    expect(c.picks.get("map:2:1:0#10")!.length).toBe(1);
    expect(c.picks.get("map:2:1:0#10")![0].aftermath).toEqual(['촌장: "고맙네!"']);

    const v1 = acc.version;
    acc.reset();
    expect(acc.version).toBe(v1 + 1);
    expect(acc.records).toEqual([]);
    expect(normModel(acc.model())).toEqual(normModel(buildHistory([])));
    expect(normCov(acc.coverage())).toEqual(normCov(computeCoverage([], data)));
    expect(acc.noisy().size).toBe(0);
    acc.append(fixtureRecords());
    expectSameAsBatch(acc);
  });

  it("coverage() keeps its object while appended records don't touch coverage", () => {
    const recs = fixtureRecords();
    const acc = createAccumulator(data);
    acc.append(recs);
    const c = acc.coverage();
    const last = recs[recs.length - 1];
    const next = (seq: number, extra: object) => ({ v: 1, seq, t: last.t + seq, run: last.run, branch: 999, ...extra }) as LogRecord;
    // 열린 선택이 없는 갈래의 이동·상태 기록: 진행도는 그대로
    acc.append([next(1000, { type: "transfer", mapId: 3, x: 0, y: 0 })]);
    acc.append([next(1001, { type: "state", src: null, cmd: null, changes: [{ kind: "switch", id: 1, value: true }] })]);
    expect(acc.coverage()).toBe(c);
    expectSameAsBatch(acc);
    // 열린 선택의 결과를 채우는 기록은 새 객체
    const src = { source: "map" as const, mapId: 2, eventId: 1, page: 0 };
    acc.append([next(1002, { branch: 998, type: "choices", src, cmd: 10, options: ["네, 도울게요", "생각해볼게요"] })]);
    acc.append([next(1003, { branch: 998, type: "choice", src, cmd: 10, picked: 0 })]);
    const c2 = acc.coverage();
    expect(c2).not.toBe(c);
    acc.append([next(1004, { branch: 998, type: "transfer", mapId: 3, x: 0, y: 0 })]);
    const c3 = acc.coverage();
    expect(c3).not.toBe(c2);
    expect(c2.picks.get("map:2:1:0#10")!.at(-1)!.aftermath).toEqual([]);
    expectSameAsBatch(acc);
    acc.reset();
    expect(acc.coverage()).not.toBe(c3);
  });

  it("plugin records touch pages incrementally, same as batch", () => {
    const acc = createAccumulator(data);
    acc.append(fixtureRecords());
    const c = acc.coverage();
    const next = (seq: number, src: unknown) =>
      ({ v: 1, seq, t: 2_000_000 + seq, run: 1, branch: 1, type: "plugin", src, cmd: 0, code: 356, text: "x" }) as LogRecord;
    acc.append([next(500, { source: "map", mapId: 2, eventId: 1, page: 0 })]);   // 이미 실행된 페이지, 101 → 위치 불확실
    const c2 = acc.coverage();
    expect(c2).not.toBe(c);
    expect(c2.uncertainSeqs.has(500)).toBe(true);
    expectSameAsBatch(acc);
    acc.append([next(501, { source: "map", mapId: 7, eventId: 4, page: 2, origin: 1 })]);
    expect(acc.coverage().touched.has("map:7:4:2")).toBe(true);
    expectSameAsBatch(acc);
  });

  it("never throws on junk input", () => {
    const acc = createAccumulator(data);
    expect(() => {
      acc.append(null as unknown as LogRecord[]);
      acc.append([null, 1, "x", { seq: "a" }, { seq: 3, type: "choice", branch: 1, run: 1, src: 5 }] as unknown as LogRecord[]);
      acc.model(); acc.coverage(); acc.noisy();
    }).not.toThrow();
    expectSameAsBatch(acc);
  });

  it("perf: 1,000 appended lines on top of 200k records", () => {
    const acc = createAccumulator(data);
    const log = bigLog(Math.ceil(201_000 / 39));
    const base = log.slice(0, 200_000), tail = log.slice(200_000, 201_000);
    expect(tail.length).toBe(1_000);
    acc.append(base);
    acc.model(); acc.coverage(); acc.noisy();
    const t0 = performance.now();
    acc.append(tail);
    acc.coverage();
    acc.model();
    acc.noisy();
    const ms = performance.now() - t0;
    console.log(`[accumulator perf] 200k + 1,000 append + coverage/model/noisy: ${ms.toFixed(2)}ms`);
    const t1 = performance.now();
    buildHistory(acc.records); computeCoverage(acc.records, data); noisyVariables(acc.records);
    console.log(`[accumulator perf] batch recompute of ${acc.records.length} records: ${(performance.now() - t1).toFixed(2)}ms`);
    expect(ms).toBeLessThan(50);
    expectSameAsBatch(acc);
  });
});
