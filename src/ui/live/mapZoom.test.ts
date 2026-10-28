import { describe, expect, it } from "vitest";
import { fitZoom, MAX_ZOOM } from "./mapZoom";

describe("fitZoom", () => {
  it("가로·세로 중 더 빡빡한 쪽에 맞춘다", () => {
    expect(fitZoom(800, 500, 40, 20)).toBe(20);
    expect(fitZoom(800, 500, 20, 50)).toBe(10);
  });
  it("작은 맵은 최대 확대까지만", () => {
    expect(fitZoom(4000, 4000, 2, 2)).toBe(MAX_ZOOM);
  });
  it("아주 큰 맵도 칸당 1px 아래로는 줄이지 않는다", () => {
    expect(fitZoom(100, 100, 500, 500)).toBe(1);
  });
  it("영역이 0 크기면 null(레이아웃 뒤 다시 계산)", () => {
    expect(fitZoom(0, 500, 40, 20)).toBeNull();
    expect(fitZoom(800, 0, 40, 20)).toBeNull();
    expect(fitZoom(800, 500, 0, 20)).toBeNull();
  });
});
