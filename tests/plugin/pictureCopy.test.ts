import { afterEach, describe, expect, it } from "vitest";
import { BASE_DIR, createHarness, type Harness } from "./harness";

// 1.31.0: a picture the game shows whose file is not in the game folder (packed inside the game exe) is saved once
// as a plain PNG to rpg-viewer/pictures/<name>.png.

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const CACHE = BASE_DIR + "/rpg-viewer/pictures";

let h: Harness;
afterEach(() => { h?.bridge?._flushNow(); });

/** A fake document whose canvases remember what was drawn and hand out a fixed PNG. */
function fakeDocument(hh: Harness) {
  const drawn: any[] = [];
  hh.g.document = {
    createElement(tag: string) {
      expect(tag).toBe("canvas");
      return {
        width: 0, height: 0,
        getContext: () => ({ drawImage: (src: any) => drawn.push(src) }),
        toDataURL: (type: string) => (type === "image/png" ? "data:image/png;base64," + PNG_B64 : ""),
      };
    },
  };
  return drawn;
}

function newGame(): { hh: Harness; drawn: any[] } {
  const hh = createHarness({ engine: "MV" });
  hh.g.DataManager.setupNewGame();
  return { hh, drawn: fakeDocument(hh) };
}

/** ImageManager.loadPicture, the bitmap gets an image, then it finishes loading. */
function show(hh: Harness, name: string) {
  const b = hh.g.ImageManager.loadPicture(name);
  b._image = { img: name };
  hh.completeLoads();
  return b;
}

const writes = (hh: Harness) => [...hh.fs.files.keys()].filter((p) => p.startsWith(CACHE + "/"));
const expected = Buffer.from(PNG_B64, "base64").toString();

describe("copies of pictures missing from the game folder (1.31.0)", () => {
  it("saves a loaded picture whose file is missing, once per name, keeping subfolders", () => {
    const game = newGame();
    h = game.hh;
    const drawn = game.drawn;
    show(h, "cutin_a");
    show(h, "event/cg 01");
    expect(writes(h).sort()).toEqual([CACHE + "/cutin_a.png", CACHE + "/event/cg 01.png"]);
    expect(h.fs.files.get(CACHE + "/cutin_a.png")).toBe(expected);
    expect(drawn).toEqual([{ img: "cutin_a" }, { img: "event/cg 01" }]);
    // shown again (even after the copy is deleted): not written again this session
    h.fs.files.delete(CACHE + "/cutin_a.png");
    show(h, "cutin_a");
    h.g.ImageManager.loadNormalBitmap("img/pictures/cutin_a.png");
    expect(writes(h)).toEqual([CACHE + "/event/cg 01.png"]);
    expect(drawn).toHaveLength(2);
  });

  it("writes nothing when the picture file is on disk (plain or encrypted) or the copy already exists", () => {
    ({ hh: h } = newGame());
    h.fs.dirs.add(BASE_DIR + "/img/pictures");
    h.fs.writeFileSync(BASE_DIR + "/img/pictures/plain.png", "x");
    h.fs.writeFileSync(BASE_DIR + "/img/pictures/locked.rpgmvp", "x");
    h.fs.dirs.add(BASE_DIR + "/rpg-viewer");
    h.fs.dirs.add(CACHE);
    h.fs.writeFileSync(CACHE + "/copied.png", "old");
    show(h, "plain");
    show(h, "locked");
    show(h, "copied");
    expect(writes(h)).toEqual([CACHE + "/copied.png"]);
    expect(h.fs.files.get(CACHE + "/copied.png")).toBe("old");
  });

  it("also copies pictures plugins load by path", () => {
    ({ hh: h } = newGame());
    const b = h.g.ImageManager.loadNormalBitmap("img/pictures/battle/cut%20in.png");
    b._image = { img: "battle" };
    h.completeLoads();
    expect(writes(h)).toEqual([CACHE + "/battle/cut in.png"]);
  });

  it("never leaves the copy folder", () => {
    ({ hh: h } = newGame());
    show(h, "../escape");
    show(h, "a/../../b");
    show(h, "C:/x");
    expect([...h.fs.files.keys()].filter((p) => p.endsWith(".png"))).toEqual([]);
  });

  it("never throws into the game when saving fails", () => {
    ({ hh: h } = newGame());
    const write = h.fs.writeFileSync.bind(h.fs);
    h.fs.writeFileSync = (p: string, d: string) => { if (p.endsWith(".png")) throw new Error("disk full"); write(p, d); };
    expect(() => show(h, "broken")).not.toThrow();
    h.fs.writeFileSync = write;
    h.g.document = undefined;
    expect(() => show(h, "no_document")).not.toThrow();
    const b = h.g.ImageManager.loadPicture("no_image"); // nothing to draw from
    expect(() => h.completeLoads()).not.toThrow();
    expect(b.isReady()).toBe(true);
    expect(writes(h)).toEqual([]);
  });
});
