import { describe, expect, it } from "vitest";
import { faceBackground } from "./faceCrop";

describe("faceBackground", () => {
  it("matches the old 4x2 sheet layout for a 576x288 sheet", () => {
    expect(faceBackground(0, 576, 288)).toEqual({ backgroundSize: "160px 80px", backgroundPosition: "0px 0px" });
    expect(faceBackground(5, 576, 288)).toEqual({ backgroundSize: "160px 80px", backgroundPosition: "-40px -40px" });
  });
  it("shows a single-face file whole instead of squashing it", () => {
    expect(faceBackground(0, 144, 144)).toEqual({ backgroundSize: "40px 40px", backgroundPosition: "0px 0px" });
  });
  it("keeps cells unscaled from the top-left for odd sizes", () => {
    expect(faceBackground(1, 600, 144).backgroundSize).toBe(`${600 * 40 / 144}px 40px`);
    expect(faceBackground(1, 600, 144).backgroundPosition).toBe("-40px 0px");
  });
});
