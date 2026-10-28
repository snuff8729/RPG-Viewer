import { afterEach, describe, expect, it } from "vitest";
import { cmd, createHarness, type Harness } from "./harness";

let h: Harness;
afterEach(() => { h?.bridge?._flushNow(); });

const CONTROL_PATH = "/game/www/rpg-viewer/control.json";

function newGame(engine: "MZ" | "MV" = "MZ", capture = true): Harness {
  const harness = createHarness({ engine });
  harness.g.DataManager.setupNewGame();
  harness.fs.dirs.add("/game/www/rpg-viewer");
  harness.fs.writeFileSync(CONTROL_PATH, JSON.stringify({ v: 1, t: harness.clock.t, capturePictures: capture }));
  harness.clock.t += 1000;
  harness.bridge._tick();
  return harness;
}
const screens = (hh: Harness) => hh.readLog().filter((r) => r.type === "screen");

/** Like the CallCutin plugin: a plain container on the spriteset with picture-bitmap layers (no Game_Screen pictures). */
function callCutin(hh: Harness, spriteset: any, base: string) {
  const S = hh.g.Sprite;
  const total = new S();
  spriteset.addChild(total);
  total.x = 240; total.y = 256;
  const body = new S();
  body.bitmap = hh.g.ImageManager.loadPicture(`actor01_cutin_${base}_0001`);
  body._colorTone = [10, 0, -20, 0];
  total.addChild(body);
  const organ = new S();
  organ.bitmap = hh.g.ImageManager.loadPicture(`organ/${base}_b`);
  organ.opacity = 128;
  organ.x = 30; organ.y = 40;
  total.addChild(organ);
  return total;
}

describe("plugin-drawn images (1.10.0)", () => {
  for (const engine of ["MZ", "MV"] as const) {
    it(`records a CallCutin-like cut-in once its bitmaps are ready, with world positions (${engine})`, () => {
      h = newGame(engine);
      const ss = h.mountSpriteset(10);
      h.setBitmapSize("actor01_cutin_A_0001", 300, 400);
      h.setBitmapSize("organ/A_b", 50, 60);
      h.frame();
      expect(screens(h)).toEqual([]);
      const total = callCutin(h, ss.spriteset, "A");
      h.frame(); // still loading: nothing yet
      expect(screens(h)).toEqual([]);
      h.completeLoads();
      h.frame(); // the frame after the load: recorded
      const recs = screens(h);
      expect(recs).toHaveLength(1);
      expect(recs[0]).toMatchObject({ scene: "map" });
      expect(recs[0].pics).toEqual([
        [1000, "actor01_cutin_A_0001", 0, 240, 256, 100, 100, 255, 0, [10, 0, -20, 0], 0, 300, 400, "sprite"],
        [1001, "organ/A_b", 0, 270, 296, 100, 100, 128, 0, 0, 0, 50, 60, "sprite"],
      ]);
      // stays: never recorded again
      for (let i = 0; i < 20; i++) { h.clock.t += 100; h.frame(); }
      expect(screens(h)).toHaveLength(1);
      // removed (EraceCutinTotal): recorded as gone while the screen is watched after activity
      ss.spriteset.removeChild(total);
      h.g.ImageManager.loadPicture("actor01_cutin_A_0001"); // cached: activity, already ready
      h.frame();
      const after = screens(h);
      expect(after).toHaveLength(2);
      expect(after[1].pics).toEqual([]);
    });
  }

  it("records an image shown for a single frame after its load-ready event", () => {
    h = newGame();
    const ss = h.mountSpriteset(10);
    const total = callCutin(h, ss.spriteset, "B");
    h.completeLoads();
    h.frame();
    ss.spriteset.removeChild(total);
    h.clock.t += 16;
    h.frame();
    const recs = screens(h);
    expect(recs).toHaveLength(1);
    expect(recs[0].pics.map((p: any[]) => p[1])).toEqual(["actor01_cutin_B_0001", "organ/B_b"]);
  });

  it("accumulates parent scale, rotation, pivot and alpha; skips hidden and transparent branches", () => {
    h = newGame();
    const ss = h.mountSpriteset(10);
    const S = h.g.Sprite;
    const outer = ss.spriteset.addChild(new S());
    outer.x = 100; outer.y = 50; outer.scale = { x: 2, y: 2 }; outer.alpha = 0.5; outer.pivot = { x: 10, y: 0 };
    const inner = outer.addChild(new S());
    inner.x = 20; inner.y = 10; inner.rotation = Math.PI / 2; inner.anchor = { x: 0.5, y: 1 };
    inner.bitmap = h.g.ImageManager.loadPicture("cut in");
    const hidden = ss.spriteset.addChild(new S());
    hidden.visible = false;
    hidden.addChild(new S()).bitmap = h.g.ImageManager.loadPicture("never");
    const clear = ss.spriteset.addChild(new S());
    clear.opacity = 0;
    clear.addChild(new S()).bitmap = h.g.ImageManager.loadPicture("never2");
    h.completeLoads();
    h.frame();
    const [rec] = screens(h);
    expect(rec.pics).toEqual([[1000, "cut in", [0.5, 1], 120, 70, 200, 200, 127.5, 0, 0, 90, 100, 100, "sprite"]]);
  });

  it("keeps Sprite_Picture entries with their ids and puts plain sprites after them", () => {
    h = newGame();
    const ss = h.mountSpriteset(10);
    h.g.$gameScreen.showPicture(3, "stand", 0, 0, 0, 100, 100, 255, 0);
    ss.update();
    callCutin(h, ss.spriteset, "C");
    h.completeLoads();
    h.frame();
    const recs = screens(h);
    expect(recs).toHaveLength(1);
    expect(recs[0].pics.map((p: any[]) => [p[0], p[1]])).toEqual([[3, "stand"], [1000, "actor01_cutin_C_0001"], [1001, "organ/C_b"]]);
    expect(recs[0].pics[0]).toHaveLength(13);
  });

  it("a message drawn while the cut-in shows carries it; no separate screen record", () => {
    h = newGame();
    const ss = h.mountSpriteset(10);
    callCutin(h, ss.spriteset, "D");
    h.completeLoads();
    const interp = h.newInterpreter();
    interp.setup([cmd(101, ["", 0, 0, 2, ""]), cmd(401, ["아앗"]), cmd(0)], 0);
    h.runCommand(interp, 0);
    h.frame(); // the message waits for its own snapshot: no screen record
    expect(screens(h)).toEqual([]);
    h.drawMessageText();
    h.frame();
    const msg = h.readLog().find((r) => r.type === "message");
    expect(msg.pics.map((p: any[]) => p[1])).toEqual(["actor01_cutin_D_0001", "organ/D_b"]);
    expect(screens(h)).toEqual([]);
  });

  it("is rate limited to 8 records a second", () => {
    h = newGame();
    const ss = h.mountSpriteset(10);
    let last: any = null;
    for (let i = 0; i < 20; i++) {
      if (last) ss.spriteset.removeChild(last);
      last = ss.spriteset.addChild(new h.g.Sprite());
      last.bitmap = h.g.ImageManager.loadPicture("flash" + i);
      h.completeLoads();
      h.clock.t += 10;
      h.frame();
    }
    expect(screens(h)).toHaveLength(8);
  });

  it("the slow poll records images that never went through ImageManager once they stay for two checks", () => {
    h = newGame();
    const ss = h.mountSpriteset(10);
    h.frame();
    const s = ss.spriteset.addChild(new h.g.Sprite());
    s.bitmap = { _url: "img/pictures/direct.png", width: 10, height: 10, isReady: () => true };
    h.clock.t += 1000; h.frame();
    expect(screens(h)).toEqual([]);
    h.clock.t += 1000; h.frame();
    expect(screens(h).map((r) => r.pics[0][1])).toEqual(["direct"]);
  });

  it("ignores other img folders and their children, and records nothing when capture is off", () => {
    h = newGame();
    const ss = h.mountSpriteset(10);
    const enemy = ss.spriteset.addChild(new h.g.Sprite());
    enemy.bitmap = h.g.ImageManager.loadEnemy("slime");
    enemy.addChild(new h.g.Sprite()).bitmap = h.g.ImageManager.loadPicture("inside_enemy");
    h.completeLoads();
    h.frame();
    expect(screens(h)).toEqual([]);
    // a container with an in-memory bitmap (url "") is entered
    const canvas = ss.spriteset.addChild(new h.g.Sprite());
    canvas.bitmap = { _url: "", width: 816, height: 624, isReady: () => true };
    canvas.addChild(new h.g.Sprite()).bitmap = h.g.ImageManager.loadPicture("on_canvas");
    h.completeLoads();
    h.frame();
    expect(screens(h).map((r) => r.pics.map((p: any[]) => p[1]))).toEqual([["on_canvas"]]);

    h = newGame("MZ", false);
    const ss2 = h.mountSpriteset(10);
    callCutin(h, ss2.spriteset, "E");
    h.completeLoads();
    h.frame();
    h.clock.t += 5000; h.frame(); h.clock.t += 5000; h.frame();
    expect(screens(h)).toEqual([]);
  });

  it("walks at most 3000 nodes, cheaply", () => {
    h = newGame();
    const ss = h.mountSpriteset(10);
    const S = h.g.Sprite;
    for (let i = 0; i < 100; i++) {
      const c = ss.spriteset.addChild(new S());
      for (let j = 0; j < 100; j++) c.addChild(new S());
    }
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) { h.g.ImageManager.loadPicture("x" + i); h.frame(); }
    const ms = (performance.now() - t0) / 10;
    expect(h.bridge._scanVisited()).toBeLessThanOrEqual(3000);
    expect(h.bridge._scanVisited()).toBeGreaterThan(2000);
    expect(ms).toBeLessThan(20);
  });

  it("records battle-scene cut-ins with scene battle", () => {
    h = newGame();
    h.g.$dataTroops[3] = { id: 3, name: "보스", pages: [] };
    h.g.$gameTroop._enemies = [];
    h.g.BattleManager.setup(3, false, true);
    const ss = h.mountSpriteset(10);
    new h.g.Scene_Battle().start();
    callCutin(h, ss.spriteset, "F");
    h.completeLoads();
    h.frame();
    expect(screens(h)).toEqual([expect.objectContaining({ scene: "battle" })]);
  });
});
