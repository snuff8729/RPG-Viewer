import { describe, expect, it } from "vitest";
import { FLAT_SAMPLE, isFlatPixels } from "./screenPictures";

// One-colour screen fills (Darkness) vs real one-frame cut-ins (Shadow_Dragon: a silhouette crossing the screen).

const W = FLAT_SAMPLE, H = 36;
function image(fill: (x: number, y: number) => [number, number, number, number]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px.set(fill(x, y), (y * W + x) * 4);
  return px;
}

describe("isFlatPixels", () => {
  it("a full-screen fill of one colour is flat (tiny noise allowed)", () => {
    expect(isFlatPixels(image(() => [0, 0, 0, 255]), W, H)).toBe(true);
    expect(isFlatPixels(image((x, y) => [3 + ((x + y) % 3), 2, 4, 255]), W, H)).toBe(true);
  });

  it("a silhouette (opaque shape on a transparent background) is never flat", () => {
    // a dark dragon-ish blob over 60% of the picture, transparent elsewhere
    const dragon = image((x, y) => ((x - 32) ** 2 / 900 + (y - 18) ** 2 / 200 <= 1 ? [10, 10, 12, 255] : [0, 0, 0, 0]));
    expect(isFlatPixels(dragon, W, H)).toBe(false);
    // even a silhouette that covers almost everything but leaves transparent gaps above 5%
    const big = image((x, y) => (x < 3 || y < 1 ? [0, 0, 0, 0] : [0, 0, 0, 255]));
    expect(isFlatPixels(big, W, H)).toBe(false);
  });

  it("an opaque picture with real detail is not flat", () => {
    expect(isFlatPixels(image((x) => (x < 4 ? [200, 50, 50, 255] : [0, 0, 0, 255])), W, H)).toBe(false);
  });

  it("half-transparent fills and unreadable input are not flat", () => {
    expect(isFlatPixels(image(() => [0, 0, 0, 128]), W, H)).toBe(false);
    expect(isFlatPixels(null, W, H)).toBe(false);
    expect(isFlatPixels(new Uint8ClampedArray(4), W, H)).toBe(false);
  });
});
