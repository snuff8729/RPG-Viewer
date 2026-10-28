import { describe, expect, it } from "vitest";
import { contentRect, parsePic, pictureDraw, pictureRect, standViewOf, type PictureContext } from "./screenPictures";

// 1.18.1: the drawn source / destination rects, the screen rect and the stand crop all use one size basis
// (record w·h, else the picture file's size; crop = part of the picture file).

const SCREEN = { width: 816, height: 624 };
const pic = (e: unknown[]) => parsePic(e)!;
const NAT = { w: 800, h: 1200 };

describe("pictureDraw / pictureRect / standViewOf share one size basis", () => {
  it("1.18.0 record of a canvas half the picture's width (picture stretched): the whole picture, squeezed", () => {
    // natural 800 x 1200 recorded with scale 50% x 100%
    const p = pic([1000, "tachie/body", 0, 100, 0, 50, 100, 255, 0, 0, 0, 800, 1200, "sprite"]);
    expect(pictureDraw(p, NAT)).toEqual({ sx: 0, sy: 0, sw: 800, sh: 1200, dx: 0, dy: 0, dw: 800, dh: 1200 });
    expect(pictureRect(p, null)).toEqual({ left: 100, top: 0, right: 500, bottom: 1200 });
    expect(standViewOf([p], SCREEN, () => NAT)).toEqual({ left: 100, top: 0, width: 400, height: 1200 });
  });

  it("an old record whose size differs from the picture file: the whole file stretched into it, never cropped", () => {
    const p = pic([1000, "tachie/body", 0, 0, 0, 100, 100, 255, 0, 0, 0, 400, 600, "sprite"]);
    expect(pictureDraw(p, NAT)).toEqual({ sx: 0, sy: 0, sw: 800, sh: 1200, dx: 0, dy: 0, dw: 400, dh: 600 });
    expect(standViewOf([p], SCREEN, () => NAT)).toEqual({ left: 0, top: 0, width: 400, height: 600 });
  });

  it("a frame showing the left half: only that half of the file, at its size", () => {
    const p = pic([1000, "tachie/body", 0, 100, 20, 100, 100, 255, 0, 0, 0, 400, 1200, "sprite", 0, [0, 0, 400, 1200, 800, 1200]]);
    expect(p.crop).toEqual([0, 0, 400, 1200, 800, 1200]);
    expect(pictureDraw(p, NAT)).toEqual({ sx: 0, sy: 0, sw: 400, sh: 1200, dx: 0, dy: 0, dw: 400, dh: 1200 });
    expect(pictureRect(p, null)).toEqual({ left: 100, top: 20, right: 500, bottom: 1220 });
  });

  it("a crop is scaled to the loaded file when it differs from the recorded picture size", () => {
    const p = pic([1000, "x", 1, 0, 0, 100, 100, 255, 0, 0, 0, 400, 1200, "sprite", 0, [400, 0, 400, 1200, 800, 1200]]);
    expect(pictureDraw(p, { w: 400, h: 600 })).toEqual({ sx: 200, sy: 0, sw: 200, sh: 600, dx: -200, dy: -600, dw: 400, dh: 1200 });
  });

  it("sprite scale 50%: the whole picture drawn at its own size and the rect halved", () => {
    const p = pic([1000, "tachie/body", 0, 0, 0, 50, 50, 255, 0, 0, 0, 800, 1200, "sprite"]);
    expect(pictureDraw(p, NAT)).toEqual({ sx: 0, sy: 0, sw: 800, sh: 1200, dx: 0, dy: 0, dw: 800, dh: 1200 });
    expect(standViewOf([p], SCREEN, () => NAT)).toEqual({ left: 0, top: 0, width: 400, height: 600 });
  });

  it("the alpha content box (picture-file shares) is mapped into the drawn size before cropping", () => {
    // figure in the right half of the file (x 50%..100%, y 10%..90%), canvas stretched to half width
    const stats = { opaque: 0.4, box: [0.5, 0.1, 1, 0.9] as [number, number, number, number] };
    const p = pic([1000, "tachie/body", 0, 100, 0, 50, 100, 255, 0, 0, 0, 800, 1200, "sprite"]);
    expect(standViewOf([p], SCREEN, () => NAT, () => stats)).toEqual({ left: 300, top: 120, width: 200, height: 960 });
    // with a crop of the left half the content (right half) is outside: nothing drawn
    const left = pic([1000, "tachie/body", 0, 100, 0, 100, 100, 255, 0, 0, 0, 400, 1200, "sprite", 0, [0, 0, 400, 1200, 800, 1200]]);
    const ctx: PictureContext = { screen: SCREEN, statsOf: () => stats };
    expect(contentRect(left, ctx)).toBeNull();
    // a crop of the right half: the content box inside it
    const right = pic([1000, "tachie/body", 0, 100, 0, 100, 100, 255, 0, 0, 0, 400, 1200, "sprite", 0, [400, 0, 400, 1200, 800, 1200]]);
    expect(contentRect(right, ctx)).toEqual({ left: 100, top: 120, right: 500, bottom: 1080 });
  });

  it("a standing picture past the (guessed) screen's right edge is not cut in half", () => {
    const p = pic([1000, "tachie/body", 0, 600, 0, 50, 50, 255, 0, 0, 0, 800, 1200, "sprite"]);
    expect(standViewOf([p], SCREEN, () => NAT)).toEqual({ left: 600, top: 0, width: 400, height: 600 });
  });

  it("unknown picture file: the whole screen; bad crops are ignored", () => {
    const p = pic([1000, "x", 0, 0, 0, 100, 100, 255, 0, 0, 0, 10, 10, "sprite", 0, [0, 0, 0, 1, 1, 1]]);
    expect(p.crop).toBeUndefined();
    expect(standViewOf([p], SCREEN, () => null)).toEqual({ left: 0, top: 0, width: 816, height: 624 });
    expect(pictureDraw(p, { w: 0, h: 0 })).toBeNull();
  });
});
