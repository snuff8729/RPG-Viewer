import { describe, expect, it } from "vitest";
import { blocked, isCounter, passable } from "./passage";
import { testMap, testTileset } from "../../../tests/helpers/mapFixture";

// 1536 = 바닥(통과), 1537 = 벽(전방향 막힘), 1538 = 아래쪽만 막힘
const FLOOR = 1536, WALL = 1537, NO_DOWN = 1538, STAR = 5, BLOCK_B = 6, COUNTER = 1539;
const ts = testTileset({ [WALL]: 0x0f, [NO_DOWN]: 0x01, [STAR]: 0x1f, [BLOCK_B]: 0x0f, [COUNTER]: 0x8f });

describe("passable", () => {
  it("floor is passable, wall is not", () => {
    const m = testMap([[FLOOR, WALL]]);
    for (const d of [2, 4, 6, 8] as const) {
      expect(passable(m, ts, 0, 0, d)).toBe(true);
      expect(passable(m, ts, 1, 0, d)).toBe(false);
    }
  });
  it("uses direction bits", () => {
    const m = testMap([[NO_DOWN]]);
    expect(passable(m, ts, 0, 0, 2)).toBe(false);
    expect(passable(m, ts, 0, 0, 4)).toBe(true);
    expect(passable(m, ts, 0, 0, 6)).toBe(true);
    expect(passable(m, ts, 0, 0, 8)).toBe(true);
  });
  it("checks the top layer first and skips star tiles", () => {
    // 위 레이어의 별 타일은 무시 → 아래 바닥으로 판정
    expect(passable(testMap([[FLOOR]], { 2: [[STAR]] }), ts, 0, 0, 2)).toBe(true);
    expect(passable(testMap([[WALL]], { 2: [[STAR]] }), ts, 0, 0, 2)).toBe(false);
    // 위 레이어의 막는 B 타일이 아래 바닥보다 우선
    expect(passable(testMap([[FLOOR]], { 3: [[BLOCK_B]] }), ts, 0, 0, 6)).toBe(false);
    // 위 레이어가 통과(플래그 0)면 아래 벽이 있어도 통과
    expect(passable(testMap([[WALL]], { 1: [[FLOOR]] }), ts, 0, 0, 6)).toBe(true);
  });
  it("tile 0 (star by default) is skipped; all-star tile is impassable", () => {
    expect(passable(testMap([[0]]), ts, 0, 0, 2)).toBe(false);
  });
  it("out of bounds is impassable", () => {
    const m = testMap([[FLOOR]]);
    expect(passable(m, ts, -1, 0, 2)).toBe(false);
    expect(passable(m, ts, 0, 1, 2)).toBe(false);
  });
});

describe("blocked / isCounter", () => {
  it("blocked only when all 4 dirs are impassable", () => {
    const m = testMap([[FLOOR, WALL, NO_DOWN]]);
    expect(blocked(m, ts, 0, 0)).toBe(false);
    expect(blocked(m, ts, 1, 0)).toBe(true);
    expect(blocked(m, ts, 2, 0)).toBe(false);
  });
  it("counter flag on any layer", () => {
    const m = testMap([[FLOOR, FLOOR]], { 1: [[0, COUNTER]] });
    expect(isCounter(m, ts, 0, 0)).toBe(false);
    expect(isCounter(m, ts, 1, 0)).toBe(true);
  });
});
