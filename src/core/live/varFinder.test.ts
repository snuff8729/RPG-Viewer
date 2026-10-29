import { describe, expect, it } from "vitest";
import type { LiveSnapshot } from "./types";
import {
  agoText, applyNarrow, emptyTracker, findVariablesByValue, FREQUENT_COUNT, liveVariable, recentChanges, startNarrow, trackVariables,
} from "./varFinder";

const names = ["", "所持金", "攻撃回数", "", "好感度", "タイマー"];
const snap = (variables: Record<string, number>) => ({ variables } as unknown as LiveSnapshot);

describe("liveVariable / findVariablesByValue", () => {
  it("reads values, missing = 0", () => {
    const live = snap({ 2: 7 });
    expect(liveVariable(live, 2)).toBe(7);
    expect(liveVariable(live, 1)).toBe(0);
    expect(liveVariable(null, 2)).toBe(0);
  });

  it("lists variables with that exact value, by id, including unnamed ones", () => {
    const live = snap({ 4: 30, 2: 30, 3: 30, 1: 31, 99: 30 });
    expect(findVariablesByValue(names, live, 30).map((e) => e.id)).toEqual([2, 3, 4]);
    expect(findVariablesByValue(names, live, 30)[0].name).toBe("攻撃回数");
    expect(findVariablesByValue(names, live, -5)).toEqual([]);
  });

  it("returns nothing for 0 or without a connection", () => {
    expect(findVariablesByValue(names, snap({ 1: 0 }), 0)).toEqual([]);
    expect(findVariablesByValue(names, null, 30)).toEqual([]);
  });
});

describe("narrowing", () => {
  it("remembers every variable, then keeps only the ones that match", () => {
    const s0 = startNarrow(names, snap({ 1: 100, 2: 5, 5: 9 }))!;
    expect(s0.candidates.map((c) => c.id)).toEqual([1, 2, 3, 4, 5]);
    expect(s0.candidates[0].prev).toBe(100);

    // 돈을 썼다: 1은 줄고, 5(타이머)는 늘고, 2는 그대로
    const live1 = snap({ 1: 60, 2: 5, 5: 12 });
    expect(applyNarrow(s0, live1, { kind: "changed" }).candidates.map((c) => c.id)).toEqual([1, 5]);
    expect(applyNarrow(s0, live1, { kind: "increased" }).candidates.map((c) => c.id)).toEqual([5]);
    expect(applyNarrow(s0, live1, { kind: "unchanged" }).candidates.map((c) => c.id)).toEqual([2, 3, 4]);
    const s1 = applyNarrow(s0, live1, { kind: "decreased" });
    expect(s1).toEqual({ candidates: [{ id: 1, prev: 60 }], steps: 1 });

    // 다음 비교는 새로 기억한 값에서
    expect(applyNarrow(s1, snap({ 1: 60 }), { kind: "unchanged" }).candidates).toHaveLength(1);
    expect(applyNarrow(s1, snap({ 1: 60 }), { kind: "changed" }).candidates).toHaveLength(0);
  });

  it("filters by an exact value (0 = missing from live)", () => {
    const s0 = startNarrow(names, snap({ 1: 3, 2: 3 }))!;
    expect(applyNarrow(s0, snap({ 1: 4, 2: 3 }), { kind: "equals", value: 3 }).candidates.map((c) => c.id)).toEqual([2]);
    expect(applyNarrow(s0, snap({ 1: 4 }), { kind: "equals", value: 0 }).candidates.map((c) => c.id)).toEqual([2, 3, 4, 5]);
  });

  it("does nothing without a connection or variables", () => {
    expect(startNarrow(names, null)).toBeNull();
    expect(startNarrow([""], snap({}))).toBeNull();
    const s0 = startNarrow(names, snap({}))!;
    expect(applyNarrow(s0, null, { kind: "changed" })).toBe(s0);
  });
});

describe("recent changes", () => {
  it("uses the first snapshot as the baseline and records old → new", () => {
    let t = trackVariables(emptyTracker(), snap({ 1: 10 }), 0);
    expect(t.changes.size).toBe(0);
    t = trackVariables(t, snap({ 1: 10 }), 1000);
    expect(t.changes.size).toBe(0);
    t = trackVariables(t, snap({ 1: 0, 2: 3 }), 2000);
    t = trackVariables(t, null, 2500);
    t = trackVariables(t, snap({ 2: 4 }), 3000);
    const { normal, frequent } = recentChanges(t, 3000);
    expect(frequent).toEqual([]);
    expect(normal.map((c) => [c.id, c.from, c.to, c.at])).toEqual([[2, 3, 4, 3000], [1, 10, 0, 2000]]);
  });

  it("returns the same tracker changes when nothing moved", () => {
    const t = trackVariables(trackVariables(emptyTracker(), snap({ 1: 1 }), 0), snap({ 1: 2 }), 1);
    expect(trackVariables(t, snap({ 1: 2 }), 2).changes).toBe(t.changes);
  });

  it("puts variables that keep changing aside", () => {
    let t = trackVariables(emptyTracker(), snap({ 5: 0, 1: 0 }), 0);
    for (let i = 1; i <= FREQUENT_COUNT; i++) t = trackVariables(t, snap({ 5: i, 1: 0 }), i * 1000);
    t = trackVariables(t, snap({ 5: FREQUENT_COUNT, 1: 50 }), 6000);
    let r = recentChanges(t, 6000);
    expect(r.normal.map((c) => c.id)).toEqual([1]);
    expect(r.frequent.map((c) => c.id)).toEqual([5]);
    // 한참 안 바뀌면 다시 보통 목록으로
    r = recentChanges(t, 60_000);
    expect(r.normal.map((c) => c.id)).toEqual([1, 5]);
  });

  it("formats how long ago", () => {
    expect(agoText(0, 1000)).toBe("방금");
    expect(agoText(0, 12_000)).toBe("12초 전");
    expect(agoText(0, 180_000)).toBe("3분 전");
    expect(agoText(0, 3_600_000)).toBe("1시간 전");
  });
});
