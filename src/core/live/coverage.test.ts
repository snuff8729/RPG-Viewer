import { beforeAll, describe, expect, it } from "vitest";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { fixtureRecords } from "../../../tests/helpers/fixtureLog";
import { loadGame } from "../loader/loadGame";
import type { GameData } from "../types";
import { computeCoverage, pageList, pickKey, seenKey } from "./coverage";
import type { LogRecord } from "./types";

let data: GameData;
beforeAll(async () => {
  const r = await loadGame(loadFixtureFolder("sample-mz"));
  if (!r.ok) throw new Error("load failed");
  data = r.data;
});

describe("computeCoverage", () => {
  it("coverage from fixture", () => {
    const c = computeCoverage(fixtureRecords(), data);
    expect([...c.seen].sort()).toEqual(["common:1#0", "map:2:1:0#0", "map:2:1:0#12", "map:2:1:0#3", "map:2:1:0#5", "map:2:1:0#8", "map:2:1:1#0", "map:2:3:0#0"]);
    const picks = c.picks.get("map:2:1:0#10")!;
    expect(picks.map(p => [p.picked, p.branch])).toEqual([[0, 1], [1, 2]]);
    expect(picks[0].aftermath).toEqual(['촌장: "고맙네!"', "스위치 숲 개방 → ON", "🚪 숲 입구 이동"]);
    expect(picks[1]).toMatchObject({ run: 1, seq: 30, aftermath: ['(내레이션): "밤이 깊었다."'] });
    expect(c.uncertainSeqs.size).toBe(0);
  });
  it("text-only differences are linked but marked changed", () => {
    const recs = fixtureRecords().map(r => r.seq === 10 ? { ...r, text: "Thanks!" } as LogRecord : r);
    const c = computeCoverage(recs, data);
    expect(c.seen.has("map:2:1:0#12")).toBe(true);
    expect(c.changedSeqs.has(10)).toBe(true);
    expect(c.uncertainSeqs.has(10)).toBe(false);
  });
  it("face mismatch is uncertain", () => {
    const recs = fixtureRecords().map(r => r.seq === 3 ? { ...r, face: "Other" } as LogRecord : r);
    const c = computeCoverage(recs, data);
    expect(c.uncertainSeqs.has(3)).toBe(true);
    expect(c.changedSeqs.has(3)).toBe(false);
    expect(c.seen.has("map:2:1:0#3")).toBe(false);
  });
  it("faceIndex mismatch is uncertain", () => {
    const recs = fixtureRecords().map(r => r.seq === 2 ? { ...r, faceIndex: 5 } as LogRecord : r);
    expect(computeCoverage(recs, data).uncertainSeqs.has(2)).toBe(true);
  });
  it("choices: same count with other texts is changed, other count is uncertain", () => {
    const translated = fixtureRecords().map(r => r.seq === 7 ? { ...r, options: ["Yes", "No"] } as LogRecord : r);
    const c1 = computeCoverage(translated, data);
    expect(c1.changedSeqs.has(7)).toBe(true);
    expect(c1.uncertainSeqs.has(7)).toBe(false);
    expect(c1.uncertainSeqs.has(9)).toBe(false);
    expect(c1.picks.get("map:2:1:0#10")!.map(p => p.picked)).toEqual([0, 1]);
    const short = fixtureRecords().map(r => r.seq === 7 ? { ...r, options: ["a"] } as LogRecord : r);
    const c2 = computeCoverage(short, data);
    expect(c2.uncertainSeqs.has(7)).toBe(true);
    expect(c2.uncertainSeqs.has(9)).toBe(true);  // choice: preceding choices count differs
    expect(c2.changedSeqs.has(7)).toBe(false);
    expect(c2.picks.get("map:2:1:0#10")!.map(p => p.picked)).toEqual([1]);
  });
  it("fixture has no changed records", () => {
    expect(computeCoverage(fixtureRecords(), data).changedSeqs.size).toBe(0);
  });
  it("excludes wrong command codes and unknown locations", () => {
    const recs = fixtureRecords().map(r => {
      if (r.seq === 9) return { ...r, cmd: 11 } as LogRecord;                                            // 402, not 102
      if (r.seq === 2) return { ...r, src: { source: "map", mapId: 9, eventId: 1, page: 0 } } as LogRecord; // no such map
      if (r.seq === 3) return { ...r, src: null } as LogRecord;
      return r;
    });
    const c = computeCoverage(recs, data);
    expect([...c.uncertainSeqs].sort((a, b) => a - b)).toEqual([2, 3, 9]);
    expect(c.picks.get("map:2:1:0#10")!.map(p => p.picked)).toEqual([1]);
    expect(c.seen.has("map:2:1:0#0")).toBe(false);
  });
  it("never throws on odd input", () => {
    const odd = [null, 1, {}, { type: "message", seq: 1 }, { type: "choice", src: { source: "troop", troopId: 99, page: 0 }, cmd: 0, seq: 2 }] as unknown as LogRecord[];
    expect(() => computeCoverage(odd, data)).not.toThrow();
    expect(() => computeCoverage(fixtureRecords(), { ...data, maps: new Map(), commonEvents: [], troops: [] } as GameData)).not.toThrow();
  });
});

describe("helpers", () => {
  it("keys and pageList", () => {
    expect(seenKey({ source: "map", mapId: 2, eventId: 1, page: 0 }, 3)).toBe("map:2:1:0#3");
    expect(pickKey({ source: "troop", troopId: 1, page: 0 }, 0)).toBe("troop:1:0#0");
    expect(pageList(data, { source: "common", commonEventId: 1 })![0].code).toBe(101);
    expect(pageList(data, { source: "troop", troopId: 1, page: 0 })).not.toBeNull();
    expect(pageList(data, { source: "map", mapId: 2, eventId: 1, page: 9 })).toBeNull();
    expect(pageList(data, { source: "map", mapId: 2, eventId: 99, page: 0 })).toBeNull();
  });
});

describe("choice option verification", () => {
  const reordered = (): GameData => {
    const maps = new Map(data.maps);
    const map = structuredClone(maps.get(2)!);
    const cmd = map.events[1]!.pages[0].list[10];
    cmd.parameters = [[...(cmd.parameters[0] as string[])].reverse(), ...cmd.parameters.slice(1)];
    maps.set(2, map);
    return { ...data, maps };
  };
  it("choices whose option texts differ (same count) are changed, not uncertain", () => {
    const c = computeCoverage(fixtureRecords(), reordered());
    expect(c.changedSeqs.has(7)).toBe(true);     // choices: options reordered in data
    expect(c.uncertainSeqs.has(7)).toBe(false);
    expect(c.uncertainSeqs.has(9)).toBe(false);  // choice: count matches
    expect(c.changedSeqs.has(9)).toBe(false);    // choice has no text of its own
    expect(c.uncertainSeqs.has(30)).toBe(false); // choice: no choices record in branch 2 → code alone
    expect(c.picks.get("map:2:1:0#10")!.map(p => [p.picked, p.branch])).toEqual([[0, 1], [1, 2]]);
  });
  it("matching option texts stay verified", () => {
    const c = computeCoverage(fixtureRecords(), data);
    expect(c.uncertainSeqs.has(7)).toBe(false);
    expect(c.uncertainSeqs.has(9)).toBe(false);
  });
});

describe("empty message", () => {
  it("a 101 with no following 401 verifies on the code when the record text is empty", () => {
    const maps = new Map(data.maps);
    const map = structuredClone(maps.get(2)!);
    const list = map.events[1]!.pages[0].list;
    list.splice(1, 2); // cmd 0 (101) is now followed by a 101, not a 401
    maps.set(2, map);
    const d = { ...data, maps };
    const base = fixtureRecords()[1] as LogRecord;
    const empty = { ...base, seq: 100, text: "" } as LogRecord;
    const filled = { ...base, seq: 101, text: "왔구나" } as LogRecord;
    const c = computeCoverage([empty, filled], d);
    expect(c.seen.has("map:2:1:0#0")).toBe(true);
    expect(c.uncertainSeqs.has(100)).toBe(false);
    expect(c.uncertainSeqs.has(101)).toBe(true);
    expect(c.changedSeqs.has(101)).toBe(false);
  });
  it("scroll checks only the 105 code; text differences are changed", () => {
    const maps = new Map(data.maps);
    const map = structuredClone(maps.get(2)!);
    map.events[1]!.pages[0].list.splice(0, 0,
      { code: 105, indent: 0, parameters: [2, false] }, { code: 405, indent: 0, parameters: ["두루마리"] });
    maps.set(2, map);
    const d = { ...data, maps };
    const src = { source: "map", mapId: 2, eventId: 1, page: 0 } as const;
    const base = { v: 1 as const, t: 0, run: 1, branch: 1 };
    const same = { ...base, seq: 1, type: "scroll", src, cmd: 0, text: "두루마리\n둘째 줄" } as LogRecord;
    const other = { ...base, seq: 2, type: "scroll", src, cmd: 0, text: "Scroll" } as LogRecord;
    const wrong = { ...base, seq: 3, type: "scroll", src, cmd: 1, text: "두루마리" } as LogRecord;
    const c = computeCoverage([same, other, wrong], d);
    expect(c.seen.has("map:2:1:0#0")).toBe(true);
    expect([...c.changedSeqs]).toEqual([2]);
    expect([...c.uncertainSeqs]).toEqual([3]);
  });
});

describe("performance", () => {
  it("200k records with 1000 abandoned branches", () => {
    const src = { source: "map", mapId: 2, eventId: 1, page: 0 } as const;
    const recs: LogRecord[] = [];
    let seq = 1;
    const base = { v: 1 as const, t: 0, run: 1 };
    for (let b = 1; b <= 1000; b++) {
      recs.push({ ...base, seq: seq++, branch: b, type: "branchStart", reason: "load", parentBranch: b > 1 ? 1 : null, fromSeq: null });
      for (let k = 0; k < 196; k++) {
        recs.push({ ...base, seq: seq++, branch: b, type: "state", src: null, cmd: null, changes: [{ kind: "variable", id: 5, value: k }] });
      }
      recs.push({ ...base, seq: seq++, branch: b, type: "choices", src, cmd: 10, options: ["네, 도울게요", "생각해볼게요"] });
      recs.push({ ...base, seq: seq++, branch: b, type: "choice", src, cmd: 10, picked: b % 2 });
      recs.push({ ...base, seq: seq++, branch: b, type: "state", src: null, cmd: null, changes: [{ kind: "variable", id: 6, value: 1 }] });
    }
    expect(recs.length).toBe(200_000);
    const t0 = performance.now();
    const c = computeCoverage(recs, data);
    const ms = performance.now() - t0;
    console.log(`computeCoverage(200k records, 1000 abandoned branches): ${ms.toFixed(1)} ms`);
    expect(c.picks.get("map:2:1:0#10")!.length).toBe(1000);
    expect(ms).toBeLessThan(300);
  });
});

describe("touched pages and plugin commands", () => {
  const P = (list: { code: number; indent: number; parameters: unknown[] }[]) => ({ conditions: {}, trigger: 0, list });
  const pluginData = (): GameData => {
    const maps = new Map(data.maps);
    const map = structuredClone(maps.get(2)!);
    const tpl = P([{ code: 356, indent: 0, parameters: ["TE固有イベント呼び出し"] }, { code: 0, indent: 0, parameters: [] }]);
    const origin = P([{ code: 356, indent: 0, parameters: ["TMng Search 종이 상자."] }, { code: 0, indent: 0, parameters: [] }]);
    map.events[9] = { id: 9, name: "조사", x: 0, y: 0, pages: [P([]), tpl], originalPages: [P([]), origin] } as never;
    maps.set(2, map);
    return { ...data, maps };
  };
  const at = (seq: number, extra: Record<string, unknown>) =>
    ({ v: 1, seq, t: 0, run: 1, branch: 1, ...extra }) as unknown as LogRecord;
  const page = { source: "map", mapId: 2, eventId: 9, page: 1 } as const;
  const origin = { ...page, origin: 1 } as const;

  it("touched: page keys from any record with a src; origin runs map back to the template page", () => {
    const c = computeCoverage([
      at(1, { type: "plugin", src: origin, cmd: 0, code: 356, text: "TMng Search 종이 상자." }),
      at(2, { type: "state", src: { source: "common", commonEventId: 1 }, cmd: 0, changes: [] }),
      at(3, { type: "transfer", mapId: 1, x: 0, y: 0 }),
      at(4, { type: "picture", src: null, cmd: 0, pictureId: 1, name: "x" }),
    ], pluginData());
    expect([...c.touched].sort()).toEqual(["common:1", "map:2:9:1"]);
    expect([...c.pluginRan]).toEqual(["map:2:9:1:o1#0"]);
    expect(c.uncertainSeqs.size).toBe(0);
  });

  it("fixture dialogue touches its pages", () => {
    const c = computeCoverage(fixtureRecords(), data);
    expect(c.touched.size).toBeGreaterThan(0);
    for (const k of c.seen) expect(c.touched.has(k.split("#")[0])).toBe(true);
  });

  it("a plugin record on another command is uncertain and not run, but still touches the page", () => {
    const c = computeCoverage([
      at(1, { type: "plugin", src: page, cmd: 0, code: 356, text: "TE" }),
      at(2, { type: "plugin", src: page, cmd: 1, code: 356, text: "x" }),     // 0(끝)
      at(3, { type: "plugin", src: page, cmd: 0, code: 357, text: "x" }),     // 코드가 다름
      at(4, { type: "plugin", src: null, cmd: 0, code: 356, text: "x" }),
    ], pluginData());
    expect([...c.pluginRan]).toEqual(["map:2:9:1#0"]);
    expect([...c.uncertainSeqs]).toEqual([2, 3, 4]);
    expect([...c.touched]).toEqual(["map:2:9:1"]);
  });
});
