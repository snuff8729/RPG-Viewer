import { describe, expect, it } from "vitest";
import { fitZoom, followScroll, scrollChange, shouldRefit } from "./mapZoom";

describe("map does not jitter", () => {
  it("a fitted map never exceeds the view (no scrollbar toggling)", () => {
    for (const [cw, ch, w, h] of [[508.5, 300.25, 37, 23], [801, 499, 41, 17], [333, 333, 7, 9]]) {
      const z = fitZoom(cw, ch, w, h)!;
      expect(w * z).toBeLessThanOrEqual(cw);
      expect(h * z).toBeLessThanOrEqual(ch);
      // the same size again gives exactly the same zoom
      expect(fitZoom(cw, ch, w, h)).toBe(z);
    }
  });

  it("refits only when the view changed by 2px or more", () => {
    expect(shouldRefit(null, 500, 300)).toBe(true);
    expect(shouldRefit({ w: 500, h: 300 }, 500, 300)).toBe(false);
    expect(shouldRefit({ w: 500, h: 300 }, 501.5, 299)).toBe(false);
    expect(shouldRefit({ w: 500, h: 300 }, 485, 300)).toBe(true);
    expect(shouldRefit({ w: 500, h: 300 }, 0, 300)).toBe(false);
  });

  it("repeated identical scroll targets change nothing", () => {
    expect(scrollChange(120, 40, 120.4, 39.6)).toBeNull();
    expect(scrollChange(120, 40, 120, 40)).toBeNull();
    expect(scrollChange(120, 40, 130.6, 40)).toEqual({ left: 131, top: 40 });
    expect(scrollChange(0, 0, NaN, 0)).toBeNull();
  });

  it("following the player moves only when it leaves the inner margin, to whole pixels", () => {
    const view = { left: 100, top: 100, width: 400, height: 300, scrollWidth: 2000, scrollHeight: 2000 };
    const z = 16;
    // standing still in the middle: nothing, however often it is asked
    for (let i = 0; i < 5; i++) expect(followScroll(300, 250, view, z)).toBeNull();
    // walked out of the margin on the right
    const next = followScroll(495, 250, view, z)!;
    expect(next).toEqual({ left: 295, top: 100 });
    // after recentring, the same position is inside again
    expect(followScroll(495, 250, { ...view, ...next }, z)).toBeNull();
    // nothing to scroll: never moves
    expect(followScroll(0, 0, { ...view, scrollWidth: 400, scrollHeight: 300 }, z)).toBeNull();
  });
});
