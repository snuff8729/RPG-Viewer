import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHarness, type Harness } from "./harness";

const CPM_PATH = fileURLToPath(new URL("../../adapters/character-picture-manager/bridge.js", import.meta.url));
const CONTROL_PATH = "/game/www/rpg-viewer/control.json";

let h: Harness;
afterEach(() => {
  h?.bridge?._flushNow();
  const g: any = globalThis;
  delete g.Scene_Base;
  delete g.RPGViewerBridgeExtensions;
});

function newGame(capture = true, menu = true): Harness {
  const harness = createHarness({ engine: "MZ" });
  harness.g.DataManager.setupNewGame();
  harness.fs.dirs.add("/game/www/rpg-viewer");
  harness.fs.writeFileSync(CONTROL_PATH, JSON.stringify({ v: 1, t: harness.clock.t, capturePictures: capture, captureMenuScenes: menu }));
  harness.clock.t += 1000;
  harness.bridge._tick();
  return harness;
}
const screens = (hh: Harness) => hh.readLog().filter((r) => r.type === "screen");
function settle(hh: Harness, ms = 300, scene?: any) {
  for (let t = 0; t < ms; t += 50) { hh.clock.t += 50; scene?.update(); hh.frame(); }
}

/** Scene_Base like CharacterPictureManager patches it (update runs updateAllStandPicture). */
function defineSceneBase(hh: Harness) {
  const S = hh.g.Sprite;
  function Scene_Base(this: any) { S.call(this); }
  Scene_Base.prototype = Object.create(S.prototype);
  Scene_Base.prototype.update = function (this: any) {
    this._standSprites?.forEach((stand: any) => stand.children.forEach((c: any) => c.cpmUpdate()));
  };
  hh.g.Scene_Base = Scene_Base;
  return Scene_Base as any;
}

function loadCpmExtension() {
  new Function(readFileSync(CPM_PATH, "utf8"))();
}

interface Layer { name: string; file: string; opacity?: number; outOfShake?: boolean }
/** Sprite_StandPicture + Sprite_StandPictureChild duck types (private classes in CharacterPictureManager). */
function makeStand(hh: Harness, actorId: number, actorName: string, base: { X: number; Y: number }, layers: Layer[]) {
  const S = hh.g.Sprite;
  const stand = new S();
  stand._pictures = { _actor: { actorId: () => actorId, name: () => actorName }, getBasePoint: () => base };
  stand._shake = 0;
  stand.getShakeX = () => stand._shake;
  stand.getShakeY = () => 0;
  stand.x = base.X; stand.y = base.Y;
  for (const l of layers) {
    const c = new S();
    c._picture = { ActorId: actorId, Name: l.name, Opacity: l.opacity ?? 255, FileName: l.file, FadeFrame: 10 };
    c._openness = 1;
    c._show = true;
    c._unfocus = false;
    c.isShowing = () => c._show;
    c.isOutOfShake = () => l.outOfShake === true;
    c.isUnFocus = () => c._unfocus;
    c.cpmUpdate = () => {
      if (c._fileName !== c._picture.FileName) { c._fileName = c._picture.FileName; c.bitmap = hh.g.ImageManager.loadPicture(c._fileName); }
      c._openness = Math.max(0, Math.min(1, c._openness + (c._show ? 0.1 : -0.1)));
      c.opacity = c._picture.Opacity * c._openness;
      c._colorTone = c._unfocus ? [-68, -68, -68, 0] : [0, 0, 0, 0];
    };
    c.cpmUpdate();
    stand.addChild(c);
  }
  stand.x = base.X + stand._shake;
  return stand;
}

function mountMenu(hh: Harness, Scene_Base: any, stands: any[]) {
  const scene = new Scene_Base();
  const container = scene.addChild(new hh.g.Sprite());
  scene._standSpriteContainer = container;
  scene._standSprites = new Map();
  for (const s of stands) { container.addChild(s); scene._standSprites.set(s._pictures._actor.actorId(), s); }
  hh.g.SceneManager._scene = scene;
  return scene;
}

describe("extension API (bridge 1.13.0)", () => {
  it("registers once per id, reports its id in live.json, and runs snapshotEntry / snapshotMeta on captured images", () => {
    h = newGame();
    const calls: string[] = [];
    let dirty: (() => void) | null = null;
    const ext = {
      id: "test-ext",
      onInstall(api: any) { calls.push("install:" + api.version); dirty = api.markScreenDirty; },
      snapshotEntry(_s: any, e: any[]) { return e[1] === "drop" ? null : undefined; },
      snapshotMeta(s: any) { return s.tagMe ? { actorId: 7, actorName: "아마네", junk: { x: 1 }, n: Infinity } : null; },
    };
    expect(h.bridge.registerExtension(ext)).toBe(true);
    expect(h.bridge.registerExtension(ext)).toBe(false);
    expect(h.bridge.registerExtension({})).toBe(false);
    expect(calls).toEqual(["install:1.24.0"]);
    expect(h.bridge.extensions()).toEqual(["test-ext"]);
    h.bridge._snapshotNow();
    expect(h.readLive().assist.extensions).toEqual(["test-ext"]);

    const ss = h.mountSpriteset(1);
    const S = h.g.Sprite;
    const a = new S(); a.bitmap = h.g.ImageManager.loadPicture("keep"); a.tagMe = true;
    const b = new S(); b.bitmap = h.g.ImageManager.loadPicture("drop");
    ss.spriteset.addChild(a); ss.spriteset.addChild(b);
    h.completeLoads();
    dirty!();
    h.frame();
    settle(h);
    const recs = screens(h);
    expect(recs).toHaveLength(1);
    expect(recs[0].pics).toEqual([[1000, "keep", 0, 0, 0, 100, 100, 255, 0, 0, 0, 100, 100, "sprite", { actorId: 7, actorName: "아마네" }]]);
  });

  it("a throwing extension is reported and skipped", () => {
    h = newGame();
    h.bridge.registerExtension({ id: "bad", snapshotEntry() { throw new Error("boom"); }, captureScene() { throw new Error("boom2"); } });
    const ss = h.mountSpriteset(1);
    const s = new h.g.Sprite(); s.bitmap = h.g.ImageManager.loadPicture("x");
    ss.spriteset.addChild(s);
    h.completeLoads();
    h.frame();
    settle(h);
    expect(screens(h)[0].pics.map((p: any[]) => p[1])).toEqual(["x"]);
  });

  it("extensions queued before the bridge loaded are registered when it starts", () => {
    const g: any = globalThis;
    g.RPGViewerBridgeExtensions = [{ id: "early" }];
    h = createHarness();
    expect(h.bridge.extensions()).toEqual(["early"]);
  });
});

describe("character-picture-manager adapter", () => {
  it("tags stands with actor and layer, records the menu scene, settled (no fade / shake / unfocus)", () => {
    h = newGame();
    const SB = defineSceneBase(h);
    loadCpmExtension();
    expect(h.bridge.extensions()).toEqual(["character-picture-manager"]);
    h.setBitmapSize("Reiri_Base", 300, 600);
    h.setBitmapSize("Reiri_Eyes1", 300, 600);
    h.setBitmapSize("Mer_Base", 300, 600);
    const reiri = makeStand(h, 1, "레이리", { X: 0, Y: 0 }, [{ name: "ベース", file: "Reiri_Base" }, { name: "目", file: "Reiri_Eyes1" }]);
    const mer = makeStand(h, 3, "메르메이아", { X: 450, Y: 0 }, [{ name: "ベース", file: "Mer_Base", opacity: 200 }]);
    // mid-fade-in, shaking, unfocused
    for (const c of [...reiri.children, ...mer.children]) { c._openness = 0.3; c.opacity = c._picture.Opacity * 0.3; }
    reiri._shake = 4; reiri.x = 4;
    mer.children[0]._unfocus = true; mer.children[0]._colorTone = [-68, -68, -68, 0];
    const scene = mountMenu(h, SB, [reiri, mer]);
    h.completeLoads();
    for (const c of [...reiri.children, ...mer.children]) { c._openness = 0.3; c.opacity = c._picture.Opacity * 0.3; }
    scene.update = function () { /* hold the fade for this check */ SB.prototype.update.call(this); for (const c of [...reiri.children, ...mer.children]) { c._openness = 0.3; c.opacity = c._picture.Opacity * 0.3; } };
    scene.update();
    h.frame();
    settle(h, 300, scene);
    const recs = screens(h);
    expect(recs).toHaveLength(1);
    expect(recs[0].scene).toBe("menu");
    const meta = { adapter: "character-picture-manager", role: "stand" };
    expect(recs[0].pics).toEqual([
      [1000, "Reiri_Base", 0, 0, 0, 100, 100, 255, 0, 0, 0, 300, 600, "sprite", { ...meta, actorId: 1, actorName: "레이리", layer: "ベース" }],
      [1001, "Reiri_Eyes1", 0, 0, 0, 100, 100, 255, 0, 0, 0, 300, 600, "sprite", { ...meta, actorId: 1, actorName: "레이리", layer: "目" }],
      [1002, "Mer_Base", 0, 450, 0, 100, 100, 200, 0, 0, 0, 300, 600, "sprite", { ...meta, actorId: 3, actorName: "메르메이아", layer: "ベース" }],
    ]);
  });

  it("a stand change between messages marks the screen dirty and is recorded; fading out drops the layer at once", () => {
    h = newGame();
    const SB = defineSceneBase(h);
    loadCpmExtension();
    const reiri = makeStand(h, 1, "레이리", { X: 0, Y: 0 }, [{ name: "ベース", file: "Base" }, { name: "目", file: "Eyes1" }]);
    const scene = mountMenu(h, SB, [reiri]);
    h.completeLoads();
    scene.update(); h.frame();
    settle(h, 300, scene);
    expect(screens(h)).toHaveLength(1);
    // expression change (variable condition): the layer's file changes
    reiri.children[1]._picture.FileName = "Eyes3";
    scene.update();
    h.completeLoads();
    h.frame();
    settle(h, 300, scene);
    let recs = screens(h);
    expect(recs).toHaveLength(2);
    expect(recs[1].pics.map((p: any[]) => p[1])).toEqual(["Base", "Eyes3"]);
    // hide switch: starts fading out -> recorded without the stand
    reiri.children.forEach((c: any) => { c._show = false; });
    scene.update(); h.frame();
    settle(h, 300, scene);
    recs = screens(h);
    expect(recs).toHaveLength(3);
    expect(recs[2].pics).toEqual([]);
  });

  it("focus and shake changes alone never make a record", () => {
    h = newGame();
    const SB = defineSceneBase(h);
    loadCpmExtension();
    const reiri = makeStand(h, 1, "레이리", { X: 0, Y: 0 }, [{ name: "ベース", file: "Base" }]);
    const scene = mountMenu(h, SB, [reiri]);
    h.completeLoads();
    scene.update(); h.frame();
    settle(h, 300, scene);
    expect(screens(h)).toHaveLength(1);
    reiri.children[0]._unfocus = true;
    reiri._shake = 6; reiri.x = 6;
    for (let i = 0; i < 20; i++) { h.clock.t += 100; scene.update(); reiri.x = 6; h.frame(); }
    expect(screens(h)).toHaveLength(1);
  });

  it("menu scenes are not recorded unless the viewer turned on captureMenuScenes (1.16.0)", () => {
    h = newGame(true, false);
    const SB = defineSceneBase(h);
    loadCpmExtension();
    const reiri = makeStand(h, 1, "레이리", { X: 0, Y: 0 }, [{ name: "ベース", file: "Base" }]);
    const scene = mountMenu(h, SB, [reiri]);
    h.completeLoads();
    scene.update(); h.frame();
    settle(h, 300, scene);
    expect(screens(h)).toEqual([]);
    expect(h.readLive().assist.captureMenuScenes).toBe(false);
  });

  it("opening and closing the menu writes no record: no menu shot, no gone shot, the same map again is no change", () => {
    h = newGame(true, false);
    const SB = defineSceneBase(h);
    loadCpmExtension();
    const sm = h.g.SceneManager;
    const ss = h.mountSpriteset(1);
    const cut = new h.g.Sprite(); cut.bitmap = h.g.ImageManager.loadPicture("stand_A");
    ss.spriteset.addChild(cut);
    h.completeLoads();
    h.frame();
    settle(h);
    expect(screens(h)).toHaveLength(1);
    // menu requested: the map is fading out, its picture already gone
    sm._nextScene = {};
    cut.visible = false;
    h.g.RPGViewerBridge._tick();
    settle(h, 1500);
    // the menu (stands shown) is open
    sm._nextScene = null;
    const reiri = makeStand(h, 1, "레이리", { X: 0, Y: 0 }, [{ name: "ベース", file: "Base" }]);
    const menu = mountMenu(h, SB, [reiri]);
    h.completeLoads();
    menu.update(); h.frame();
    settle(h, 1500, menu);
    // back on a new map scene, still loading, then started with the same picture
    const back = h.mountSpriteset(1);
    sm._sceneStarted = false;
    settle(h, 300);
    sm._sceneStarted = true;
    const again = new h.g.Sprite(); again.bitmap = h.g.ImageManager.loadPicture("stand_A");
    back.spriteset.addChild(again);
    h.completeLoads();
    h.frame();
    settle(h, 1500);
    expect(screens(h)).toHaveLength(1);
  });

  it("records nothing while capture is off", () => {
    h = newGame(false);
    const SB = defineSceneBase(h);
    loadCpmExtension();
    const reiri = makeStand(h, 1, "레이리", { X: 0, Y: 0 }, [{ name: "ベース", file: "Base" }]);
    const scene = mountMenu(h, SB, [reiri]);
    h.completeLoads();
    scene.update(); h.frame();
    settle(h, 300, scene);
    expect(screens(h)).toEqual([]);
  });
});
