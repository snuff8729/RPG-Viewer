import { describe, expect, it } from "vitest";
import type { GameData } from "../types";
import type { LiveSnapshot } from "./types";
import {
  baseParams, batchResults, cheatOpsForControl, describeCheatOp, fillAllOps, inverseCheatOps, makeBatch, searchEntries, searchItems,
  searchSystem, splitOps,
  undoable, validCheatOp, type CheatOp,
} from "./cheat";
import { controlJson, DEFAULT_ASSIST } from "./assist";

const data = {
  engine: "MZ", dataRoot: "data", imgRoot: "img",
  system: { gameTitle: "", currencyUnit: "G", switches: ["", "문 열림", ""], variables: ["", "돈 모은 횟수", "", ""] },
  mapInfos: [], maps: new Map(), commonEvents: [], troops: [],
  actors: [null, { id: 1, name: "해롤드", faceName: "", faceIndex: 0, classId: 1, initialLevel: 2 }],
  items: [null, { id: 1, name: "포션", description: "HP를 회복", iconIndex: 176 }, { id: 2, name: "하이 포션" }, null],
  weapons: [null, { id: 1, name: "검" }], armors: [null, { id: 1, name: "방패" }],
  skills: [null, { id: 1, name: "불꽃" }], states: [null, { id: 1, name: "전투불능" }],
  classes: [null, { id: 1, name: "용사", params: [[0, 450, 500], [0, 80, 90], [0, 20, 25], [0, 20, 25], [0, 20, 25], [0, 20, 25], [0, 20, 25], [0, 20, 25]] }],
  errors: [],
} as unknown as GameData;

const live = {
  items: { 1: 3 }, weapons: {}, armors: { 1: 2 }, gold: 150, switches: [1], variables: { 2: 7 }, selfSwitches: ["3,4,A"],
} as unknown as LiveSnapshot;

describe("validCheatOp", () => {
  it("accepts every op kind with good values", () => {
    const good: CheatOp[] = [
      { op: "gainItem", type: "item", id: 1, amount: -5 }, { op: "setItem", type: "weapon", id: 1, count: 0 },
      { op: "gold", set: 0 }, { op: "gold", add: -10 }, { op: "level", actorId: 1, level: 99 }, { op: "exp", actorId: 1, add: 100 },
      { op: "param", actorId: 1, paramId: 7, add: -1 }, { op: "recover", actorId: null }, { op: "recover", actorId: 1 },
      { op: "learnSkill", actorId: 1, skillId: 1 }, { op: "removeState", actorId: 1, stateId: 1 },
      { op: "switch", id: 2, value: false }, { op: "variable", id: 3, value: "글" }, { op: "variable", id: 1, value: -3 },
      { op: "selfSwitch", mapId: 1, eventId: 2, letter: "D", value: true },
    ];
    for (const op of good) expect(validCheatOp(op, data), JSON.stringify(op)).toBe(true);
  });

  it("rejects bad ids, types and limits", () => {
    const bad: unknown[] = [
      { op: "gainItem", type: "item", id: 3, amount: 1 }, { op: "gainItem", type: "item", id: 4, amount: 1 },
      { op: "gainItem", type: "skill", id: 1, amount: 1 }, { op: "gainItem", type: "item", id: 1, amount: 0.5 },
      { op: "gainItem", type: "item", id: 1, amount: 1e10 }, { op: "setItem", type: "armor", id: 1, count: -1 },
      { op: "gold", set: 1, add: 1 }, { op: "gold" }, { op: "gold", set: -1 },
      { op: "level", actorId: 2, level: 5 }, { op: "level", actorId: 1, level: 0 }, { op: "param", actorId: 1, paramId: 8, add: 1 },
      { op: "recover" }, { op: "learnSkill", actorId: 1, skillId: 2 }, { op: "addState", actorId: 1, stateId: 0 },
      { op: "switch", id: 3, value: true }, { op: "switch", id: 1, value: "on" }, { op: "variable", id: 4, value: 1 },
      { op: "variable", id: 1, value: "x".repeat(1001) }, { op: "variable", id: 1, value: Infinity },
      { op: "selfSwitch", mapId: 1, eventId: 1, letter: "a", value: true }, { op: "eval" }, null, [], "gold",
    ];
    for (const op of bad) expect(validCheatOp(op, data), JSON.stringify(op)).toBe(false);
  });

  it("without data checks shapes and ranges only", () => {
    expect(validCheatOp({ op: "gainItem", type: "item", id: 500, amount: 1 })).toBe(true);
    expect(validCheatOp({ op: "switch", id: 5000, value: true })).toBe(true);
    expect(validCheatOp({ op: "gainItem", type: "item", id: 0, amount: 1 })).toBe(false);
  });

  it("control.json carries cheat ops only when all are valid and there are 1..50", () => {
    const op: CheatOp = { op: "gold", add: 1 };
    expect(cheatOpsForControl([op])).toEqual([op]);
    expect(cheatOpsForControl([])).toBeNull();
    expect(cheatOpsForControl(new Array(51).fill(op))).toBeNull();
    expect(cheatOpsForControl([op, { op: "gold" }])).toBeNull();
    const sets = { seenMessages: [], seenPages: [] };
    const withOps = JSON.parse(controlJson(DEFAULT_ASSIST, sets, { id: "x", kind: "cheat", at: 5, ops: [op] }, 1));
    expect(withOps.command).toEqual({ id: "x", kind: "cheat", at: 5, ops: [op] });
    const bad = JSON.parse(controlJson(DEFAULT_ASSIST, sets, { id: "x", kind: "cheat", at: 5, ops: [] }, 1));
    expect(bad.command).toBeNull();
    const hp = JSON.parse(controlJson(DEFAULT_ASSIST, sets, { id: "y", kind: "hpFull", at: 5 }, 1));
    expect(hp.command).toEqual({ id: "y", kind: "hpFull", at: 5 });
  });
});

describe("inverseCheatOps (undo)", () => {
  it("restores items, gold, switches, variables and self switches to the values before", () => {
    const ops: CheatOp[] = [
      { op: "gainItem", type: "item", id: 1, amount: 10 }, { op: "gainItem", type: "item", id: 1, amount: 5 },
      { op: "setItem", type: "item", id: 2, count: 99 }, { op: "gold", add: 1000 }, { op: "switch", id: 1, value: false },
      { op: "variable", id: 2, value: "글" }, { op: "variable", id: 3, value: 4 }, { op: "selfSwitch", mapId: 3, eventId: 4, letter: "A", value: false },
      { op: "param", actorId: 1, paramId: 2, add: 10 },
    ];
    expect(inverseCheatOps(ops, live)).toEqual([
      { op: "param", actorId: 1, paramId: 2, add: -10 },
      { op: "selfSwitch", mapId: 3, eventId: 4, letter: "A", value: true },
      { op: "variable", id: 3, value: 0 },
      { op: "variable", id: 2, value: 7 },
      { op: "switch", id: 1, value: true },
      { op: "gold", set: 150 },
      { op: "setItem", type: "item", id: 2, count: 0 },
      { op: "setItem", type: "item", id: 1, count: 3 },
    ]);
    expect(undoable(ops)).toBe(true);
  });

  it("level, exp, recover, skills and states cannot be undone; without a live state only params can", () => {
    expect(inverseCheatOps([{ op: "level", actorId: 1, level: 5 }], live)).toBeNull();
    expect(inverseCheatOps([{ op: "gold", add: 1 }, { op: "recover", actorId: null }], live)).toBeNull();
    expect(undoable([{ op: "learnSkill", actorId: 1, skillId: 1 }])).toBe(false);
    expect(inverseCheatOps([{ op: "gold", add: 1 }], null)).toBeNull();
    expect(inverseCheatOps([{ op: "param", actorId: 1, paramId: 0, add: 5 }], null)).toEqual([{ op: "param", actorId: 1, paramId: 0, add: -5 }]);
  });
});

describe("search", () => {
  it("ranks exact/id, then name prefix, then contains, then description, then icon index", () => {
    const list = [
      null, { id: 1, name: "하이 포션" }, { id: 2, name: "포션" }, { id: 3, name: "포션 세트" }, { id: 4, name: "해독제", description: "포션 대신" },
      { id: 5, name: "검", iconIndex: 2 }, { id: 6, name: "" },
    ];
    expect(searchEntries(list, "포션").map((e) => e.id)).toEqual([2, 3, 1, 4]);
    expect(searchEntries(list, " 2 ").map((e) => e.id)).toEqual([2, 5]);
    expect(searchEntries(list, "").map((e) => e.id)).toEqual([1, 2, 3, 4, 5]);
    expect(searchEntries(list, "6").map((e) => e.id)).toEqual([6]);
    expect(searchEntries(list, "포션", 2).map((e) => e.id)).toEqual([2, 3]);
    expect(searchEntries(undefined, "x")).toEqual([]);
  });

  it("searches items, weapons and armors together; fills every named entry", () => {
    expect(searchItems(data, "all", "포션").map((h) => `${h.type}:${h.entry.id}`)).toEqual(["item:1", "item:2"]);
    expect(searchItems(data, "all", "1").map((h) => `${h.type}:${h.entry.id}`)).toEqual(["item:1", "weapon:1", "armor:1"]);
    expect(searchItems(data, "all", "176").map((h) => h.entry.id)).toEqual([1]);
    expect(searchItems(data, "weapon", "").map((h) => h.entry.name)).toEqual(["검"]);
    expect(searchItems(null, "all", "x")).toEqual([]);
    expect(fillAllOps(data, "item")).toEqual([
      { op: "setItem", type: "item", id: 1, count: 99 }, { op: "setItem", type: "item", id: 2, count: 99 },
    ]);
  });

  it("switch/variable search shows unnamed ids after named ones", () => {
    expect(searchSystem(["", "", "문 열림", ""], "").map((e) => e.id)).toEqual([2, 1, 3]);
    expect(searchSystem(["", "", "문 열림", ""], "문").map((e) => e.id)).toEqual([2]);
    expect(searchSystem(["", "", "문 열림", ""], "3").map((e) => e.id)).toEqual([3]);
  });
});

describe("batches", () => {
  const op = (n: number): CheatOp => ({ op: "gold", add: n });
  it("packs queued entries up to 50 ops and maps the answer back to entries", () => {
    const queue = [{ key: "a", ops: [op(1)] }, { key: "b", ops: new Array(48).fill(op(2)) }, { key: "c", ops: [op(3), op(4)] }];
    const r = makeBatch(queue, "x-1", 9)!;
    expect(r.batch.entries).toEqual([{ key: "a", from: 0, to: 1 }, { key: "b", from: 1, to: 49 }]);
    expect(r.batch.ops).toHaveLength(49);
    expect(r.rest.map((q) => q.key)).toEqual(["c"]);
    expect(batchResults(r.batch, "x-1")).toEqual(new Map([["a", "applied"], ["b", "applied"]]));
    expect(batchResults(r.batch, "x-1:ignored")).toEqual(new Map([["a", "ignored"], ["b", "ignored"]]));
    expect(batchResults(r.batch, "x-1:failed:3")).toEqual(new Map([["a", "notApplied"], ["b", "failed"]]));
    expect(batchResults(r.batch, "x-1:failed")).toEqual(new Map([["a", "notApplied"], ["b", "notApplied"]]));
    expect(batchResults(r.batch, "x-10")).toBeNull();
    expect(batchResults(r.batch, "x-0")).toBeNull();
    expect(batchResults(r.batch, null)).toBeNull();
    expect(makeBatch([], "x", 0)).toBeNull();
    expect(splitOps(new Array(120).fill(op(1))).map((c) => c.length)).toEqual([50, 50, 20]);
  });
});

describe("labels and base params", () => {
  it("describes ops with database names", () => {
    expect(describeCheatOp({ op: "gainItem", type: "item", id: 1, amount: 10 }, data)).toBe("포션 +10");
    expect(describeCheatOp({ op: "param", actorId: 1, paramId: 2, add: -5 }, data)).toBe("해롤드 공격력 -5");
    expect(describeCheatOp({ op: "gainItem", type: "weapon", id: 9, amount: 1 }, null)).toBe("무기 9 +1");
    expect(describeCheatOp({ op: "gold", set: 5 }, data)).toBe("돈 → 5");
  });

  it("base params from the class curve at the initial (or given) level", () => {
    expect(baseParams(data, 1)).toEqual([500, 90, 25, 25, 25, 25, 25, 25]);
    expect(baseParams(data, 1, 1)).toEqual([450, 80, 20, 20, 20, 20, 20, 20]);
    expect(baseParams(data, 2)).toBeNull();
    expect(baseParams(null, 1)).toBeNull();
  });
});
