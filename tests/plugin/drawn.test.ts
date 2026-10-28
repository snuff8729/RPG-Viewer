import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";

// 1.18.0: pictures plugins draw whole into their own canvas (BYWorkElement standing portraits that slide and change
// on hits in battle), battles whose BattleManager.setup the plugin never saw, custom battle scenes.

let h: Harness;
afterEach(() => { h?.bridge?._flushNow(); });

const CONTROL_PATH = "/game/www/rpg-viewer/control.json";

function newGame(capture = true): Harness {
  const harness = createHarness({ engine: "MV" });
  harness.g.DataManager.setupNewGame();
  harness.fs.dirs.add("/game/www/rpg-viewer");
  harness.fs.writeFileSync(CONTROL_PATH, JSON.stringify({ v: 1, t: harness.clock.t, capturePictures: capture }));
  harness.clock.t += 1000;
  harness.bridge._tick();
  return harness;
}
const log = (hh: Harness) => hh.readLog();
const screens = (hh: Harness) => log(hh).filter((r) => r.type === "screen");
function settle(hh: Harness, ms = 200) {
  for (let t = 0; t < ms; t += 50) { hh.clock.t += 50; hh.frame(); }
}

/**
 * Like BYWorkElement.createImage: an element (empty canvas) with a content sprite whose canvas gets the picture
 * loaded by path (ImageManager.loadNormalBitmap) drawn into it whole, stretched to the canvas (clearRect + blt).
 */
function element(hh: Harness, parent: any, x: number, y: number, w: number, ht: number) {
  const S = hh.g.Sprite;
  const el = new S();
  el.x = x; el.y = y;
  el.bitmap = new hh.g.Bitmap(0, 0);
  const content = new S();
  content.bitmap = new hh.g.Bitmap(w, ht);
  el.addChild(content);
  parent.addChild(el);
  return {
    el, content,
    set source(path: string) {
      const img = hh.g.ImageManager.loadNormalBitmap(path);
      img.addLoadListener(() => {
        content.bitmap.clearRect(0, 0, w, ht);
        content.bitmap.blt(img, 0, 0, img.width, img.height, 0, 0, w, ht);
      });
    },
  };
}
function battleScene(hh: Harness) {
  const ss = hh.mountSpriteset(10);
  Object.setPrototypeOf(ss.scene, hh.g.Scene_Battle.prototype);
  return ss;
}
const enemy = (name: string) => ({ name: () => name, isAlive: () => true });

describe("pictures drawn into a plugin's canvas (1.18.0)", () => {
  it("records the standing portrait of a battle and its brief hurt image, at the picture's own size", () => {
    h = newGame();
    h.g.$dataTroops[4] = { id: 4, name: "슬라임", pages: [] };
    h.g.$gameTroop._enemies = [enemy("슬라임")];
    h.setBitmapSize("tachie/tachie_02_01_01", 800, 1200);
    h.setBitmapSize("tachie/tachie_02_01_05", 800, 1200);
    h.g.BattleManager.setup(4, true, false);
    const ss = battleScene(h);
    const liv = element(h, ss.scene, 900, 100, 400, 600); // added to the scene, above the spriteset
    liv.source = "img/pictures/tachie/tachie_02_01_01.png";
    h.completeLoads();
    new h.g.Scene_Battle().start();
    const portrait = [1000, "tachie/tachie_02_01_01", 0, 900, 100, 50, 50, 255, 0, 0, 0, 800, 1200, "sprite"];
    expect(log(h).find((r) => r.type === "battle" && r.phase === "start").pics).toEqual([portrait]);

    // hit: the portrait changes to the hurt image for a moment, then back
    liv.source = "img/pictures/tachie/tachie_02_01_05.png";
    h.frame();
    expect(screens(h)).toEqual([]); // still loading
    h.completeLoads();
    h.frame();
    settle(h);
    liv.source = "img/pictures/tachie/tachie_02_01_01.png"; // cached: drawn at once
    h.frame();
    settle(h);
    const recs = screens(h);
    expect(recs.map((r) => r.scene)).toEqual(["battle", "battle"]);
    expect(recs[0].pics).toEqual([[1000, "tachie/tachie_02_01_05", 0, 900, 100, 50, 50, 255, 0, 0, 0, 800, 1200, "sprite"]]);
    expect(recs[1].pics).toEqual([portrait]);
  });

  it("forgets the picture when the canvas is cleared; parts of pictures and other folders are no picture", () => {
    h = newGame();
    const ss = h.mountSpriteset(10);
    h.setBitmapSize("cg_01", 640, 360);
    const a = element(h, ss.spriteset, 0, 0, 640, 360);
    a.source = "img/pictures/cg_01.png";
    h.completeLoads();
    h.frame();
    settle(h);
    expect(screens(h).map((r) => r.pics.map((p: any[]) => p[1]))).toEqual([["cg_01"]]);
    a.content.bitmap.clear();
    h.frame();
    settle(h);
    expect(screens(h)[1].pics).toEqual([]);

    const S = h.g.Sprite;
    const sheet = h.g.ImageManager.loadNormalBitmap("img/pictures/sheet.png"); // 100 x 100
    const face = h.g.ImageManager.loadNormalBitmap("img/faces/Actor1.png");
    h.completeLoads();
    const frameCanvas = ss.spriteset.addChild(new S());
    frameCanvas.bitmap = new h.g.Bitmap(50, 50);
    frameCanvas.bitmap.blt(sheet, 50, 0, 50, 50, 0, 0, 50, 50); // one frame of a sheet
    const windowContents = ss.spriteset.addChild(new S());
    windowContents.bitmap = new h.g.Bitmap(400, 200);
    windowContents.bitmap.blt(sheet, 0, 0, 100, 100, 10, 10, 100, 100); // a part of the canvas
    const faceCanvas = ss.spriteset.addChild(new S());
    faceCanvas.bitmap = new h.g.Bitmap(100, 100);
    faceCanvas.bitmap.blt(face, 0, 0, 100, 100, 0, 0, 100, 100); // not the picture folder
    h.frame();
    settle(h);
    expect(screens(h)).toHaveLength(2);
  });
});

describe("battles the plugin did not see start (1.18.0)", () => {
  it("records the start when the battle scene starts in battle without BattleManager.setup having run", () => {
    h = newGame(false);
    h.g.$dataTroops[7] = { id: 7, name: "보스", pages: [] };
    h.g.$gameTroop._enemies = [enemy("보스")];
    h.g.$gameTroop._troopId = 7;
    h.g.$gameParty._inBattle = true;
    new h.g.Scene_Battle().start();
    h.g.BattleManager.endBattle(0);
    const recs = log(h).filter((r) => r.type === "battle");
    expect(recs.map((r) => r.phase)).toEqual(["start", "end"]);
    expect(recs[0]).toMatchObject({ troopId: 7, troopName: "보스" });
  });

  it("a battle set up normally gets one start record", () => {
    h = newGame(false);
    h.g.BattleManager.setup(3, true, false);
    new h.g.Scene_Battle().start();
    expect(log(h).filter((r) => r.type === "battle" && r.phase === "start")).toHaveLength(1);
  });

  it("a custom battle scene (not a Scene_Battle) is a battle screen while the party is in battle, never a menu", () => {
    h = newGame();
    const ss = h.mountSpriteset(10);
    function Scene_MiniBattle() { /* a Scene_Base subtype */ }
    Object.setPrototypeOf(Scene_MiniBattle.prototype, h.g.Sprite.prototype);
    Object.setPrototypeOf(ss.scene, Scene_MiniBattle.prototype);
    h.g.$gameParty._inBattle = true;
    h.setBitmapSize("cutin", 300, 300);
    const s = ss.spriteset.addChild(new h.g.Sprite());
    s.bitmap = h.g.ImageManager.loadPicture("cutin");
    h.completeLoads();
    h.frame();
    settle(h);
    const recs = screens(h);
    expect(recs).toHaveLength(1);
    expect(recs[0].scene).toBe("battle");
    expect(recs[0]).not.toHaveProperty("scene", "menu");
    expect(log(h).some((r) => r.scene === "menu")).toBe(false);
  });
});
