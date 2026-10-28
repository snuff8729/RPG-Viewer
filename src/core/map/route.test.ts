import { describe, expect, it } from "vitest";
import { testMap, testTileset } from "../../../tests/helpers/mapFixture";
import { passable } from "./passage";
import { routeTo, standTiles, type Route } from "./route";

const F = 1536, W = 1537, COUNTER = 1538, NO_LEFT = 1539;
const ts = testTileset({ [W]: 0x0f, [COUNTER]: 0x8f, [NO_LEFT]: 0x02 });
const ev = (x: number, y: number, priorityType: number, trigger = 0) => ({ x, y, priorityType, trigger, through: false });
const grid = (w: number, h: number, fill = F) => Array.from({ length: h }, () => new Array<number>(w).fill(fill));

function expectContiguous(r: Route) {
  for (let i = 1; i < r.steps.length; i++) {
    const a = r.steps[i - 1], b = r.steps[i];
    expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBe(1);
  }
}

describe("standTiles", () => {
  const map = testMap(grid(5, 5));
  it("same-as-characters + action button: the 4 neighbours facing the event", () => {
    expect(standTiles(ev(2, 2, 1, 0), map, ts)).toEqual([
      { x: 2, y: 1, face: 2 }, { x: 3, y: 2, face: 4 }, { x: 1, y: 2, face: 6 }, { x: 2, y: 3, face: 8 },
    ]);
  });
  it("drops neighbours outside the map", () => {
    expect(standTiles(ev(0, 0, 1, 0), map, ts)).toEqual([{ x: 1, y: 0, face: 4 }, { x: 0, y: 1, face: 8 }]);
  });
  it("below/above characters: the event tile itself", () => {
    expect(standTiles(ev(2, 2, 0, 0), map, ts)).toEqual([{ x: 2, y: 2, face: null }]);
    expect(standTiles(ev(2, 2, 2, 0), map, ts)).toEqual([{ x: 2, y: 2, face: null }]);
    expect(standTiles(ev(2, 2, 0, 1), map, ts)).toEqual([{ x: 2, y: 2, face: null }]);
  });
  it("same-as-characters + touch: the 4 neighbours, bumping into the event", () => {
    const four = [
      { x: 2, y: 1, face: 2, touch: true }, { x: 3, y: 2, face: 4, touch: true },
      { x: 1, y: 2, face: 6, touch: true }, { x: 2, y: 3, face: 8, touch: true },
    ];
    expect(standTiles(ev(2, 2, 1, 1), map, ts)).toEqual(four);
    expect(standTiles(ev(2, 2, 1, 2), map, ts)).toEqual(four);
  });
  it("touch does not reach across a counter", () => {
    const m = testMap([[F, F, F], [F, COUNTER, F], [F, F, F]]);
    expect(standTiles(ev(1, 0, 1, 1), m, ts)).toHaveLength(3);
  });
  it("across a counter: also 2 tiles away", () => {
    const m = testMap([[F, F, F], [F, COUNTER, F], [F, F, F]]);
    expect(standTiles(ev(1, 0, 1, 0), m, ts)).toEqual([
      { x: 2, y: 0, face: 4 }, { x: 0, y: 0, face: 6 }, { x: 1, y: 1, face: 8 }, { x: 1, y: 2, face: 8 },
    ]);
  });
});

describe("routeTo", () => {
  // . . E . .
  // . W W W .
  // . . P . .
  const map = testMap([[F, F, F, F, F], [F, W, W, W, F], [F, F, F, F, F]]);

  it("walks around a wall to the nearest stand tile", () => {
    const r = routeTo(map, ts, { x: 2, y: 2 }, standTiles(ev(2, 0, 1, 0), map, ts), new Set());
    expect(r).not.toBeNull();
    expect(r!.stand).toEqual({ x: 1, y: 0, face: 6 });
    expect(r!.steps[0]).toEqual({ x: 2, y: 2 });
    expect(r!.steps.at(-1)).toEqual({ x: 1, y: 0 });
    expect(r!.steps).toHaveLength(6);
    expectContiguous(r!);
    for (const s of r!.steps) expect(passable(map, ts, s.x, s.y, 2) || passable(map, ts, s.x, s.y, 8)).toBe(true);
    expect(r!.text).toBe("왼쪽 1칸, 위 2칸 가서 오른쪽을 보고 확인");
  });
  it("avoids other solid events", () => {
    const r = routeTo(map, ts, { x: 2, y: 2 }, standTiles(ev(2, 0, 1, 0), map, ts), new Set(["0,1"]));
    expect(r!.stand).toEqual({ x: 3, y: 0, face: 4 });
    expect(r!.text).toBe("오른쪽 1칸, 위 2칸 가서 왼쪽을 보고 확인");
  });
  it("returns null when unreachable", () => {
    expect(routeTo(map, ts, { x: 2, y: 2 }, standTiles(ev(2, 0, 1, 0), map, ts), new Set(["0,1", "4,1"]))).toBeNull();
    expect(routeTo(map, ts, { x: 2, y: 2 }, [], new Set())).toBeNull();
    expect(routeTo(map, ts, { x: 9, y: 9 }, standTiles(ev(2, 0, 1, 0), map, ts), new Set())).toBeNull();
  });
  it("stand-on events", () => {
    const r = routeTo(map, ts, { x: 2, y: 2 }, standTiles(ev(4, 2, 0, 0), map, ts), new Set());
    expect(r!.steps).toHaveLength(3);
    expect(r!.text).toBe("오른쪽 2칸 가서 그 칸에 서기");
  });
  it("already in place", () => {
    const r1 = routeTo(map, ts, { x: 1, y: 0 }, standTiles(ev(2, 0, 1, 0), map, ts), new Set());
    expect(r1).toEqual({ steps: [{ x: 1, y: 0 }], stand: { x: 1, y: 0, face: 6 }, text: "지금 자리에서 오른쪽을 보고 확인" });
    const r2 = routeTo(map, ts, { x: 4, y: 2 }, standTiles(ev(4, 2, 0, 0), map, ts), new Set());
    expect(r2!.text).toBe("지금 그 칸에 서 있음");
  });
  it("does not walk through the target event itself", () => {
    const line = testMap([[F, F, F]]);
    expect(routeTo(line, ts, { x: 0, y: 0 }, [{ x: 2, y: 0, face: 4 }], new Set())).toBeNull();
    const open = testMap(grid(3, 2));
    const r = routeTo(open, ts, { x: 0, y: 0 }, [{ x: 2, y: 0, face: 4 }], new Set());
    expect(r!.steps).toHaveLength(5);
    expect(r!.steps).not.toContainEqual({ x: 1, y: 0 });
    expect(r!.text).toBe("오른쪽 2칸 가서 왼쪽을 보고 확인");
  });
  it("respects one-sided passage (enter and leave checks)", () => {
    const m = testMap([[F, NO_LEFT, F]]);
    // (0,0)→(1,0): (1,0)의 왼쪽 면이 막힘
    expect(routeTo(m, ts, { x: 0, y: 0 }, standTiles(ev(1, 0, 0), m, ts), new Set())).toBeNull();
    // (2,0)→(1,0): 들어올 땐 오른쪽 면 → 통과
    expect(routeTo(m, ts, { x: 2, y: 0 }, standTiles(ev(1, 0, 0), m, ts), new Set())!.steps).toHaveLength(2);
  });
  it("touch events: walk next to it and bump into it", () => {
    const r = routeTo(map, ts, { x: 2, y: 2 }, standTiles(ev(2, 0, 1, 1), map, ts), new Set());
    expect(r!.stand).toEqual({ x: 1, y: 0, face: 6, touch: true });
    expect(r!.text).toBe("왼쪽 1칸, 위 2칸 가서 오른쪽으로 한 걸음 (부딪히기)");
    const here = routeTo(map, ts, { x: 1, y: 0 }, standTiles(ev(2, 0, 1, 2), map, ts), new Set());
    expect(here!.text).toBe("지금 자리에서 오른쪽으로 한 걸음 (부딪히기)");
  });
  it("routes to the far side of a counter", () => {
    // 상인(1,0) 앞 카운터(1,1), 플레이어는 (1,2)
    const m = testMap([[W, F, W], [W, COUNTER, W], [F, F, F]]);
    const r = routeTo(m, ts, { x: 0, y: 2 }, standTiles(ev(1, 0, 1, 0), m, ts), new Set());
    expect(r!.stand).toEqual({ x: 1, y: 2, face: 8 });
    expect(r!.text).toBe("오른쪽 1칸 가서 위를 보고 확인");
  });
});
