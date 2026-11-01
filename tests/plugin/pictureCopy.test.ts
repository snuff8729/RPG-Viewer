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

// 1.31.0: the viewer's want-list (rpg-viewer/missing-pictures.json) is copied through the game's own file system, one
// per frame, even when that file system says the file exists (a packer serving packed files).
describe("want-list copies (1.31.0)", () => {
  const PNG = Buffer.from(PNG_B64, "base64");
  const WANTS = BASE_DIR + "/rpg-viewer/missing-pictures.json";
  const PICS = BASE_DIR + "/img/pictures";
  /** Encrypted like RPG Maker: "RPGMV" head + PNG whose first 16 bytes are scrambled. */
  const encrypted = () => {
    const body = Buffer.from(PNG);
    for (let i = 0; i < 16; i++) body[i] ^= 0x5a;
    return Buffer.concat([Buffer.from([0x52, 0x50, 0x47, 0x4d, 0x56, 0, 0, 0, 0, 3, 1, 0, 0, 0, 0, 0]), body]);
  };
  /** MemFs keeps text: binary goes in as latin1 (the bridge reads strings back as latin1). */
  const bin = (b: Buffer) => b.toString("latin1");

  function setup(names: string[]) {
    const hh = createHarness({ engine: "MV" });
    hh.g.DataManager.setupNewGame();
    fakeDocument(hh);
    hh.fs.dirs.add(BASE_DIR + "/rpg-viewer");
    hh.fs.dirs.add(PICS);
    hh.fs.writeFileSync(WANTS, JSON.stringify({ v: 1, pictures: names }));
    const written = new Map<string, Buffer>();
    const write = hh.fs.writeFileSync.bind(hh.fs);
    hh.fs.writeFileSync = (p: string, d: any) => {
      if (p.startsWith(CACHE + "/")) written.set(p, Buffer.isBuffer(d) ? d : Buffer.from(String(d), "latin1"));
      write(p, Buffer.isBuffer(d) ? bin(d) : d);
    };
    return { hh, written };
  }

  it("copies listed pictures one per frame, plain and encrypted, even though the file system says they exist", () => {
    const s = setup(["cut/a", "b", "absent", "junk"]);
    h = s.hh;
    h.fs.dirs.add(PICS + "/cut");
    h.fs.writeFileSync(PICS + "/cut/a.png", bin(PNG));
    h.fs.writeFileSync(PICS + "/b.rpgmvp", bin(encrypted()));
    h.fs.writeFileSync(PICS + "/junk.png", "not a png at all, really not");
    h.frame();
    expect([...s.written.keys()]).toEqual([CACHE + "/cut/a.png"]);
    h.frame();
    expect([...s.written.keys()]).toEqual([CACHE + "/cut/a.png", CACHE + "/b.png"]);
    expect(s.written.get(CACHE + "/cut/a.png")).toEqual(PNG);
    expect(s.written.get(CACHE + "/b.png")).toEqual(PNG);
    for (let i = 0; i < 5; i++) expect(() => h.frame()).not.toThrow(); // absent + junk: skipped
    expect(s.written.size).toBe(2);
  });

  it("skips pictures already copied, and reads the list again when it changes", () => {
    const s = setup(["done"]);
    h = s.hh;
    h.fs.dirs.add(CACHE);
    h.fs.writeFileSync(CACHE + "/done.png", "old");
    h.fs.writeFileSync(PICS + "/done.png", bin(PNG));
    s.written.clear();
    h.frame(); h.frame();
    expect(s.written.size).toBe(0);
    h.fs.writeFileSync(PICS + "/later.png", bin(PNG));
    h.fs.writeFileSync(WANTS, JSON.stringify({ v: 1, pictures: ["done", "later"] }));
    h.frame();
    expect(s.written.size).toBe(0); // checked again only after 5 s
    h.clock.t += 5000;
    h.frame();
    expect([...s.written.keys()]).toEqual([CACHE + "/later.png"]);
  });

  it("a listed picture shown in play is copied from its bitmap without asking whether the file exists", () => {
    const s = setup(["packed"]);
    h = s.hh;
    h.fs.writeFileSync(PICS + "/packed.png", "the packer says it is here but it does not read back as PNG");
    h.frame(); // reads the list; the file-system copy fails
    expect(s.written.size).toBe(0);
    show(h, "packed");
    expect([...s.written.keys()]).toEqual([CACHE + "/packed.png"]);
  });

  it("never throws into the game when the list or the files cannot be read", () => {
    const s = setup(["x"]);
    h = s.hh;
    h.fs.readFileSync = () => { throw new Error("EACCES"); };
    expect(() => { h.frame(); h.clock.t += 6000; h.frame(); h.frame(); }).not.toThrow();
    h.fs.writeFileSync(WANTS, "{ broken json");
    expect(() => { h.clock.t += 6000; h.frame(); }).not.toThrow();
    expect(s.written.size).toBe(0);
  });
});
