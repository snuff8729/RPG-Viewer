import { describe, expect, it } from "vitest";
import { branchPath, buildHistory } from "./history";
import {
  branchList, emptyPrefs, hideUpTo, isHidden, parseBranchPrefs, serializeBranchPrefs, summarizeBranches, tidyOld, updatePref,
} from "./branchTidy";
import type { LogRecord } from "./types";

const src = (eventId: number) => ({ source: "map", mapId: 2, eventId, page: 0 });
let seq = 0;
const at = (run: number, branch: number) => ({ v: 1, run, branch, t: 1_000_000 + seq * 1000 });
const start = (run: number, branch: number, reason: "newGame" | "load", parentBranch: number | null = null, fromSeq: number | null = null) =>
  ({ ...at(run, branch), seq: ++seq, type: "branchStart", reason, parentBranch, fromSeq });
const msg = (run: number, branch: number, cmd: number, text: string) =>
  ({ ...at(run, branch), seq: ++seq, type: "message", src: src(1), cmd, face: "", faceIndex: 0, speaker: "앨리스", text });
const transfer = (run: number, branch: number, mapId: number) => ({ ...at(run, branch), seq: ++seq, type: "transfer", mapId, x: 0, y: 0 });
const save = (run: number, branch: number) => ({ ...at(run, branch), seq: ++seq, type: "save", slot: 1 });
const choices = (run: number, branch: number, cmd: number, options: string[]) =>
  ({ ...at(run, branch), seq: ++seq, type: "choices", src: src(1), cmd, options });
const choice = (run: number, branch: number, cmd: number, picked: number) =>
  ({ ...at(run, branch), seq: ++seq, type: "choice", src: src(1), cmd, picked });

/**
 * 1회차: 1(새 게임, 맵 2, a b 저장 c d e)
 *   2 = 저장 지점에서 불러와 c만 다시 봄(중복), 3 = 불러오고 아무것도 안 봄(빈 갈래),
 *   4 = 불러와 q 한 줄(짧은 갈래), 5 = 불러와 선택 뒤 x y z w(보통)
 * 2회차: 6(새 게임, 비어 있지만 가장 최근)
 */
function scenario() {
  seq = 0;
  const r: unknown[] = [];
  r.push(start(1, 1, "newGame"), transfer(1, 1, 2), msg(1, 1, 1, "a"), msg(1, 1, 2, "b"));
  const saveSeq = seq + 1;
  r.push(save(1, 1), msg(1, 1, 3, "c"), msg(1, 1, 4, "d"), msg(1, 1, 5, "e"));
  r.push(start(1, 2, "load", 1, saveSeq), msg(1, 2, 3, "c"));
  r.push(start(1, 3, "load", 1, saveSeq), transfer(1, 3, 7));
  r.push(start(1, 4, "load", 1, saveSeq), msg(1, 4, 9, "q"));
  r.push(start(1, 5, "load", 1, saveSeq), choices(1, 5, 6, ["왼쪽", "오른쪽"]), choice(1, 5, 6, 1),
    msg(1, 5, 7, "x"), msg(1, 5, 8, "y"), msg(1, 5, 10, "z"), msg(1, 5, 11, "w"));
  r.push(start(2, 6, "newGame"));
  const records = r as LogRecord[];
  return { records, model: buildHistory(records), saveSeq };
}

describe("summarizeBranches", () => {
  it("classifies empty, duplicate, short and normal branches", () => {
    const { records, model } = scenario();
    const s = summarizeBranches(records, model);
    expect([...s.values()].map(b => [b.id, b.kind])).toEqual([
      [1, "normal"], [2, "duplicate"], [3, "empty"], [4, "short"], [5, "normal"], [6, "normal"],
    ]);
  });
  it("keeps the latest branch normal even when empty", () => {
    const { records, model } = scenario();
    expect(model.latestBranch).toBe(6);
    expect(summarizeBranches(records, model).get(6)!.storyCount).toBe(0);
  });
  it("summarizes lines, last line, start map and the distinguishing choice", () => {
    const { records, model } = scenario();
    const s = summarizeBranches(records, model);
    expect(s.get(1)).toMatchObject({ lineCount: 5, startMapId: 2, lastLine: { speaker: "앨리스", text: "e" }, firstPick: null, parent: null });
    // 맵 2는 조상(1)의 갈라진 지점 전 이동에서 온다
    expect(s.get(5)).toMatchObject({ lineCount: 4, startMapId: 2, parent: 1, firstPick: { picked: 1, options: ["왼쪽", "오른쪽"] } });
    expect(s.get(3)!.startMapId).toBe(2);
  });
  it("treats identical siblings: the later one is the duplicate", () => {
    seq = 0;
    const r: unknown[] = [start(1, 1, "newGame"), msg(1, 1, 1, "a"), msg(1, 1, 2, "b"), msg(1, 1, 3, "c"), msg(1, 1, 4, "d")];
    const fork = 2;
    r.push(start(1, 2, "load", 1, fork), msg(1, 2, 7, "x"), msg(1, 2, 8, "y"), msg(1, 2, 9, "z"), msg(1, 2, 10, "w"));
    r.push(start(1, 3, "load", 1, fork), msg(1, 3, 7, "x"), msg(1, 3, 8, "y"), msg(1, 3, 9, "z"), msg(1, 3, 10, "w"));
    r.push(start(1, 4, "load", 1, fork), msg(1, 4, 7, "x"), msg(1, 4, 8, "other"));
    r.push(start(2, 9, "newGame"));
    const records = r as LogRecord[];
    const s = summarizeBranches(records, buildHistory(records));
    expect(s.get(2)!.kind).toBe("normal");
    expect(s.get(3)!.kind).toBe("duplicate");
    expect(s.get(4)!.kind).toBe("short"); // 같은 위치에서 다른 대사 — 중복이 아니다
  });
  it("compares a reload against a continued story (save → quit → continue)", () => {
    seq = 0;
    const r: unknown[] = [start(1, 1, "newGame"), msg(1, 1, 1, "a")];
    const fork = seq;
    // 2: 저장 지점 뒤 이야기가 없을 때 불러옴 → 1을 이어 간 갈래
    r.push(start(1, 2, "load", 1, fork), msg(1, 2, 2, "b"), msg(1, 2, 3, "c"));
    // 3: 같은 저장을 다시 불러와 b만 다시 봄 → 중복
    r.push(start(1, 3, "load", 1, fork), msg(1, 3, 2, "b"));
    r.push(start(2, 9, "newGame"));
    const records = r as LogRecord[];
    const model = buildHistory(records);
    expect(model.alias.get(2)).toBe(1);
    const s = summarizeBranches(records, model);
    expect([...s.keys()]).toEqual([1, 3, 9]);
    expect(s.get(1)!.lineCount).toBe(3);
    expect(s.get(3)!.kind).toBe("duplicate");
  });
  it("never throws on junk", () => {
    expect(summarizeBranches(null as unknown as LogRecord[], buildHistory([])).size).toBe(0);
    expect(summarizeBranches([{ seq: "x" } as unknown as LogRecord], null as never).size).toBe(0);
  });
});

describe("branchList", () => {
  it("hides empty and duplicate branches and folds short ones under their parent", () => {
    const { records, model } = scenario();
    const s = summarizeBranches(records, model);
    const list = branchList(s, emptyPrefs());
    expect(list.hiddenCount).toBe(2);
    expect(list.runs.map(r => [r.run, r.rows.map(x => x.id)])).toEqual([[2, [6]], [1, [5, 1]]]);
    const one = list.runs[1].rows.find(x => x.id === 1)!;
    expect(one.shorts.map(x => x.id)).toEqual([4]);
  });
  it("shows hidden branches with the toggle and keeps the selected one visible", () => {
    const { records, model } = scenario();
    const s = summarizeBranches(records, model);
    const all = branchList(s, emptyPrefs(), { showHidden: true });
    expect(all.runs[1].rows.map(x => [x.id, x.hidden])).toEqual([[5, false], [3, true], [2, true], [1, false]]);
    expect(branchList(s, emptyPrefs(), { always: 2 }).runs[1].rows.map(x => x.id)).toContain(2);
  });
  it("applies pins, labels-independent hiding and explicit unhide", () => {
    const { records, model } = scenario();
    const s = summarizeBranches(records, model);
    let p = updatePref(emptyPrefs(), 4, { pinned: true }, 1);
    p = updatePref(p, 5, { hidden: true }, 2);
    p = updatePref(p, 2, { hidden: false }, 3);
    const list = branchList(s, p);
    expect(list.pinned.map(x => x.id)).toEqual([4]);
    expect(list.runs[1].rows.map(x => x.id)).toEqual([2, 1]);
    expect(isHidden(s.get(5)!, p)).toBe(true);
    expect(isHidden(s.get(2)!, p)).toBe(false);
  });
});

describe("bulk hiding", () => {
  it("hides this branch and every earlier one except pinned", () => {
    const { records, model } = scenario();
    const s = summarizeBranches(records, model);
    const pinned = updatePref(emptyPrefs(), 1, { pinned: true }, 1);
    const { prefs, count } = hideUpTo(s, pinned, 4, 5);
    // 2·3은 이미 자동으로 숨겨져 있어 새로 숨긴 건 4뿐(1은 고정)
    expect(count).toBe(1);
    expect([1, 2, 3, 4, 5, 6].map(id => isHidden(s.get(id)!, prefs))).toEqual([false, true, true, true, false, false]);
    expect(prefs.t).toBe(5);
  });
  it("tidies everything older than the most recent K visible branches", () => {
    const { records, model } = scenario();
    const s = summarizeBranches(records, model);
    // 보이는 갈래(최근 순): 6, 5, 4, 1
    const { prefs, count } = tidyOld(s, emptyPrefs(), 9, 2, model.latestBranch);
    expect(count).toBe(2);
    expect([1, 4, 5, 6].map(id => isHidden(s.get(id)!, prefs))).toEqual([true, true, false, false]);
    const pinned = updatePref(emptyPrefs(), 1, { pinned: true }, 1);
    expect(tidyOld(s, pinned, 9, 2, model.latestBranch).count).toBe(1);
    expect(tidyOld(s, emptyPrefs(), 9, 10, model.latestBranch).count).toBe(0);
  });
});

describe("hiding is display-only", () => {
  it("does not change the model or a branch's path from the start", () => {
    const { records, model } = scenario();
    const before = branchPath(records, model, 5).map(r => r.seq);
    const snapshot = JSON.stringify([[...model.branches], model.runs, [...model.alias], model.latestBranch]);
    const s = summarizeBranches(records, model);
    const prefs = hideUpTo(s, emptyPrefs(), 1, 1).prefs; // 부모 갈래 1을 숨김
    branchList(s, prefs);
    expect(isHidden(s.get(1)!, prefs)).toBe(true);
    expect(JSON.stringify([[...model.branches], model.runs, [...model.alias], model.latestBranch])).toBe(snapshot);
    expect(branchPath(records, model, 5).map(r => r.seq)).toEqual(before);
    expect(before.slice(0, 5)).toEqual([1, 2, 3, 4, 5]); // 숨긴 조상의 저장 지점까지가 그대로 앞에 붙는다
  });
});

describe("prefs serialization", () => {
  it("round-trips and drops junk", () => {
    let p = updatePref(emptyPrefs(), 3, { label: "  보스 앞  ", pinned: true }, 42);
    p = updatePref(p, 4, { hidden: false }, 43);
    expect(parseBranchPrefs(serializeBranchPrefs(p))).toEqual(p);
    expect(parseBranchPrefs("{\"v\":1,\"t\":1,\"branches\":{\"x\":{\"label\":\"a\"},\"5\":{\"pinned\":\"yes\"},\"6\":{\"label\":\"b\"}}}"))
      .toEqual({ v: 1, t: 1, branches: { 6: { label: "b" } } });
    expect(parseBranchPrefs("nope")).toBeNull();
    expect(parseBranchPrefs("{\"v\":2}")).toBeNull();
  });
  it("clears a branch entry when all settings are removed", () => {
    const p = updatePref(updatePref(emptyPrefs(), 3, { label: "x" }, 1), 3, { label: "" }, 2);
    expect(p.branches).toEqual({});
  });
});
