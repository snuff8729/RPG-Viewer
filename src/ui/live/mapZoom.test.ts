import { describe, expect, it } from "vitest";
import { anchorScroll, clampScroll, clampZoom, fitZoom, isDrag, MAX_ZOOM, MIN_ZOOM, pinchZoom, wheelFactor } from "./mapZoom";

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

describe("wheelFactor", () => {
  it("휠 한 칸(100px)은 ×1.15, 위로 굴리면 확대", () => {
    expect(wheelFactor(-100)).toBeCloseTo(1.15);
    expect(wheelFactor(100)).toBeCloseTo(1 / 1.15);
  });
  it("줄 단위도 px로 바꾼다", () => {
    expect(wheelFactor(-3, 1)).toBeCloseTo(Math.pow(1.15, 0.99));
  });
  it("핀치는 작은 delta에도 더 크게", () => {
    expect(wheelFactor(-10, 0, true)).toBeGreaterThan(wheelFactor(-10));
  });
  it("한 번에 ×2·÷2를 넘지 않는다", () => {
    expect(wheelFactor(-10000)).toBe(2);
    expect(wheelFactor(10000)).toBe(0.5);
  });
});

describe("anchorScroll", () => {
  it("커서 아래 점이 그대로 있다", () => {
    // 확대 10, 스크롤 100, 커서 50 → 맵 15칸 지점. 확대 20이면 300 - 50 = 250
    const s = anchorScroll(100, 50, 10, 20);
    expect(s).toBe(250);
    expect((s + 50) / 20).toBe(15);
  });
  it("같은 크기면 그대로", () => {
    expect(anchorScroll(123, 40, 8, 8)).toBe(123);
  });
});

describe("clampScroll", () => {
  it("범위 안으로", () => {
    expect(clampScroll(-5, 1000, 300)).toBe(0);
    expect(clampScroll(900, 1000, 300)).toBe(700);
    expect(clampScroll(200, 1000, 300)).toBe(200);
  });
  it("내용이 더 작으면 0", () => {
    expect(clampScroll(50, 200, 300)).toBe(0);
  });
});

describe("clampZoom · pinchZoom · isDrag", () => {
  it("확대 범위 안으로", () => {
    expect(clampZoom(0.5)).toBe(MIN_ZOOM);
    expect(clampZoom(1000)).toBe(MAX_ZOOM);
    expect(clampZoom(10)).toBe(10);
  });
  it("손가락 거리 비율만큼", () => {
    expect(pinchZoom(10, 100, 200)).toBe(20);
    expect(pinchZoom(10, 100, 50)).toBe(5);
    expect(pinchZoom(10, 0, 50)).toBe(10);
  });
  it("4px 미만은 누르기", () => {
    expect(isDrag(2, 2)).toBe(false);
    expect(isDrag(3, 3)).toBe(true);
  });
});
