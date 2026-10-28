import { beforeAll, describe, expect, it } from "vitest";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { fixtureRecords } from "../../../tests/helpers/fixtureLog";
import { loadGame } from "../loader/loadGame";
import type { GameData, Location } from "../types";
import { createAccumulator } from "./accumulator";
import { deletionClosure, planDeleteSet, planDeletion, type DeletionPlan } from "./branchDelete";
import { computeCoverage } from "./coverage";
import { branchPath, buildHistory, representative } from "./history";
import { buildSeenArchive, mergeSeenArchive, parseSeenArchive, serializeSeenArchive, type SeenArchive } from "./seenArchive";
import type { Coverage, HistoryModel, LogRecord } from "./types";

let data: GameData;
beforeAll(async () => {
  const r = await loadGame(loadFixtureFolder("sample-mz"));
  if (!r.ok) throw new Error("load failed");
  data = r.data;
});

const E1: Location = { source: "map", mapId: 2, eventId: 1, page: 0 } as Location;
const E1P1: Location = { source: "map", mapId: 2, eventId: 1, page: 1 } as Location;
const E3: Location = { source: "map", mapId: 2, eventId: 3, page: 0 } as Location;
const C1: Location = { source: "common", commonEventId: 1 } as Location;

/** 합성 기록 만들기: 픽스처의 같은 위치 대사를 본떠 seq·run·branch만 바꾼다. */
function builder() {
  const out: LogRecord[] = [];
  let seq = 0;
  const base = fixtureRecords();
  const put = (run: number, branch: number, body: Record<string, unknown>) => {
    seq++;
    out.push({ v: 1, seq, t: 1000 + seq, run, branch, ...body } as LogRecord);
    return seq;
  };
  const sameSrc = (a: unknown, b: Location) => JSON.stringify(a) === JSON.stringify(b);
  return {
    out,
    start: (run: number, branch: number, reason: "newGame" | "load", parentBranch: number | null = null, fromSeq: number | null = null) =>
      put(run, branch, { type: "branchStart", reason, parentBranch, fromSeq }),
    msg: (run: number, branch: number, src: Location, cmd: number) => {
      const f = base.find(r => r.type === "message" && sameSrc(r.src, src) && r.cmd === cmd);
      if (!f) throw new Error(`no fixture message ${JSON.stringify(src)}#${cmd}`);
      const { seq: _s, t: _t, run: _r, branch: _b, ...rest } = f;
      return put(run, branch, rest);
    },
    choices: (run: number, branch: number) => put(run, branch, { type: "choices", src: E1, cmd: 10, options: ["네, 도울게요", "생각해볼게요"] }),
    choice: (run: number, branch: number, picked: number) => put(run, branch, { type: "choice", src: E1, cmd: 10, picked }),
    save: (run: number, branch: number) => put(run, branch, { type: "save", slot: 1 }),
    load: (run: number, branch: number) => put(run, branch, { type: "load", slot: 1 }),
    transfer: (run: number, branch: number) => put(run, branch, { type: "transfer", mapId: 3, x: 1, y: 1 }),
    plugin: (run: number, branch: number) => put(run, branch, { type: "plugin", src: E1, cmd: 99, code: 357, text: "x" }),
  };
}

/**
 * 1회차 갈래 나무:
 *   B1(새 게임) ─ 저장@3 → B2(불러오기) ─ 저장@16 → B3 ─ 이어하기 → B5(B3에 합쳐짐)
 *               └ 저장@8 → B4
 * 2회차: B6(새 게임)
 */
function tree(): LogRecord[] {
  const b = builder();
  b.start(1, 1, "newGame");          // 1
  b.msg(1, 1, E1, 0);                // 2
  b.save(1, 1);                      // 3
  b.msg(1, 1, E1, 3);                // 4
  b.choices(1, 1);                   // 5
  b.choice(1, 1, 0);                 // 6
  b.msg(1, 1, E1, 12);               // 7
  b.save(1, 1);                      // 8
  b.transfer(1, 1);                  // 9  (6번 선택의 결과)
  b.msg(1, 1, E3, 0);                // 10
  b.start(1, 2, "load", 1, 3);       // 11
  b.load(1, 2);                      // 12
  b.msg(1, 2, E1, 8);                // 13
  b.choices(1, 2);                   // 14
  b.choice(1, 2, 1);                 // 15
  b.save(1, 2);                      // 16
  b.msg(1, 2, C1, 0);                // 17
  b.start(1, 3, "load", 2, 16);      // 18
  b.load(1, 3);                      // 19
  b.msg(1, 3, E1P1, 0);              // 20
  b.start(1, 4, "load", 1, 8);       // 21
  b.load(1, 4);                      // 22
  b.msg(1, 4, E3, 0);                // 23
  b.start(1, 5, "load", 3, 20);      // 24 — B3 묶음에 20 뒤 이야기 없음 → 이어하기
  b.load(1, 5);                      // 25
  b.msg(1, 5, E1, 5);                // 26
  b.plugin(1, 5);                    // 27
  b.start(2, 6, "newGame");          // 28
  b.msg(2, 6, E1, 0);                // 29
  return b.out;
}

const seqs = (rs: LogRecord[]) => rs.map(r => r.seq);
const normCov = (c: Coverage) => ({
  seen: [...c.seen].sort(), touched: [...c.touched].sort(), pluginRan: [...c.pluginRan].sort(),
  uncertainSeqs: [...c.uncertainSeqs].sort((a, b) => a - b), changedSeqs: [...c.changedSeqs].sort((a, b) => a - b),
  picks: [...c.picks.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, l]) => [k, [...l].sort((x, y) => x.seq - y.seq)]),
});

/** 남은 기록으로 다시 만든 갈래 모양이 남는 갈래에 대해 원래와 같은가. */
function expectSameStructure(model: HistoryModel, plan: DeletionPlan) {
  const after = buildHistory(plan.kept);
  for (const [id, b] of after.branches) {
    const o = model.branches.get(id)!;
    expect({ id, run: b.run, parent: b.parent, fromSeq: b.fromSeq, reason: b.reason, startSeq: b.startSeq })
      .toEqual({ id, run: o.run, parent: o.parent, fromSeq: o.fromSeq, reason: o.reason, startSeq: o.startSeq });
    expect(representative(after, id)).toBe(representative(model, id));
  }
}

/** 지운 뒤(남은 기록 + 보관) 진행도가 원래와 같은가 — 일괄 계산과 증분 누적기 모두. */
function expectSameCoverage(original: LogRecord[], plan: DeletionPlan, prev: SeenArchive | null = null): SeenArchive {
  const full = mergeSeenArchive(computeCoverage(original, data), prev);
  const archive = buildSeenArchive(full, computeCoverage(plan.kept, data), 1);
  // 파일로 쓰고 다시 읽어도 같다
  const reread = parseSeenArchive(serializeSeenArchive(archive));
  expect(reread).toEqual(archive);
  expect(normCov(mergeSeenArchive(computeCoverage(plan.kept, data), reread))).toEqual(normCov(full));
  const acc = createAccumulator(data);
  acc.append(plan.kept);
  expect(normCov(mergeSeenArchive(acc.coverage(), reread))).toEqual(normCov(full));
  return archive;
}

describe("planDeletion", () => {
  it("tree fixture has the intended shape", () => {
    const m = buildHistory(tree());
    expect(m.alias.get(5)).toBe(3);
    expect(m.alias.has(2)).toBe(false);
    expect(m.alias.has(3)).toBe(false);
    expect(m.alias.has(4)).toBe(false);
  });

  it("leaf delete removes only that branch", () => {
    const recs = tree();
    const model = buildHistory(recs);
    const plan = planDeleteSet(recs, model, [4]);
    expect(seqs(plan.dropped)).toEqual([21, 22, 23]);
    expect(plan.removedBranches).toEqual([4]);
    expect(plan.removedIds).toEqual([4]);
    expect(plan.partialBranches).toEqual([]);
    expect(plan.dependents).toEqual([]);
    expect(plan.removedLines).toBe(1);
    expectSameStructure(model, plan);
    expectSameCoverage(recs, plan);
  });

  it("keeping a deep branch keeps only the needed front of its ancestors", () => {
    const recs = tree();
    const model = buildHistory(recs);
    const plan = planDeletion(recs, model, [3]);
    // B3+B5 전부, B2는 16까지(+구조용 17), B1은 3까지(+구조용 4 — 없으면 B2가 B1의 이어하기로 합쳐진다)
    expect(seqs(plan.kept)).toEqual([1, 2, 3, 4, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 24, 25, 26, 27]);
    expect(plan.removedBranches).toEqual([4, 6]);
    expect(plan.removedIds).toEqual([4, 6]);
    // B2는 구조용 17까지 남아 결국 통째로 남는다
    expect(plan.keptBranches).toEqual([2, 3]);
    expect(plan.partialBranches).toEqual([{ id: 1, upToSeq: 3, neededBy: [3] }]);
    expectSameStructure(model, plan);
    expectSameCoverage(recs, plan);
    // 남긴 갈래의 처음부터 읽기 경로는 그대로
    expect(seqs(branchPath(plan.kept, buildHistory(plan.kept), 3))).toEqual(seqs(branchPath(recs, model, 3)));
  });

  it("partial ancestor keeps a truncated choice whose result lives in the archive", () => {
    const recs = tree();
    const model = buildHistory(recs);
    const plan = planDeletion(recs, model, [4]);
    // B1은 8까지 + B4가 따로 보이게 하는 이야기 한 줄(10)
    expect(seqs(plan.kept)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 10, 21, 22, 23]);
    const rest = computeCoverage(plan.kept, data);
    const full = computeCoverage(recs, data);
    const key = "map:2:1:0#10";
    expect(rest.picks.get(key)!.find(p => p.seq === 6)!.aftermath).not.toEqual(full.picks.get(key)!.find(p => p.seq === 6)!.aftermath);
    const archive = expectSameCoverage(recs, plan);
    expect(archive.picks[key].map(p => p.seq)).toEqual([6, 15]);
    expectSameStructure(model, plan);
  });

  it("multi-level: deleting a middle branch also deletes what came from it", () => {
    const recs = tree();
    const model = buildHistory(recs);
    expect([...deletionClosure(model, [2])].sort()).toEqual([2, 3]);
    const plan = planDeleteSet(recs, model, [2]);
    expect(plan.dependents).toEqual([3]);
    expect(plan.removedBranches).toEqual([2, 3]);
    expect(plan.removedIds).toEqual([2, 3, 5]);
    expect(plan.keptBranches).toEqual([1, 4, 6]);
    expectSameStructure(model, plan);
    expectSameCoverage(recs, plan);
  });

  it("a continuation id means its representative branch", () => {
    const recs = tree();
    const model = buildHistory(recs);
    expect(seqs(planDeletion(recs, model, [5]).kept)).toEqual(seqs(planDeletion(recs, model, [3]).kept));
  });

  it("repeated deletions keep coverage equal through the archive chain", () => {
    const recs = tree();
    const model = buildHistory(recs);
    const first = planDeleteSet(recs, model, [4]);
    const a1 = expectSameCoverage(recs, first);
    const second = planDeletion(first.kept, buildHistory(first.kept), [6]);
    const fullOriginal = computeCoverage(recs, data);
    const a2 = expectSameCoverage(first.kept, second, a1);
    expect(normCov(mergeSeenArchive(computeCoverage(second.kept, data), a2))).toEqual(normCov(fullOriginal));
  });

  it("coverage stays equal for every keep set on the fixture and tree", () => {
    for (const recs of [tree(), fixtureRecords()]) {
      const model = buildHistory(recs);
      const ids = [...model.branches.keys()];
      for (let mask = 0; mask < 1 << ids.length; mask++) {
        const keep = ids.filter((_, i) => mask & (1 << i));
        const plan = planDeletion(recs, model, keep);
        expectSameStructure(model, plan);
        expectSameCoverage(recs, plan);
        const del = planDeleteSet(recs, model, keep);
        expectSameStructure(model, del);
        expectSameCoverage(recs, del);
      }
    }
  });

  it("keeps records without a branch and never throws", () => {
    const recs = [...tree(), { v: 1, seq: 99, t: 1, run: 0, branch: 0, type: "error", message: "x" } as LogRecord];
    const plan = planDeletion(recs, buildHistory(recs), []);
    expect(seqs(plan.kept)).toEqual([99]);
    expect(() => planDeletion(null as unknown as LogRecord[], buildHistory([]), [1])).not.toThrow();
    expect(() => planDeleteSet([null, 1] as unknown as LogRecord[], buildHistory([]), [1])).not.toThrow();
  });
});
