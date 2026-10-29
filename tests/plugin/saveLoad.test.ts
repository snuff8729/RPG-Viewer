// 1.21.0: quick save / quick load / save & load screens, backup / restore requests to the viewer.
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";

const DIR = "/game/www/rpg-viewer";
const CONTROL_PATH = DIR + "/control.json";
const REQUEST_PATH = DIR + "/request.json";

let h: Harness;
afterEach(() => { h?.bridge?._flushNow(); });

interface Engine { calls: string[]; scenes: { Scene_Save: any; Scene_Load: any }; system: any }

/** A game on the map with save / load scenes, SceneManager.push / goto, $gameSystem (like rpg_scenes / rpg_objects). */
function game(engine: "MZ" | "MV" = "MZ"): Engine {
  h = createHarness({ engine });
  const g = h.g;
  g.DataManager.setupNewGame();
  const calls: string[] = [];
  function Scene_Save(this: any) { this._active = false; }
  function Scene_Load(this: any) { this._active = false; }
  Scene_Load.prototype.isActive = function () { return this._active; };
  Scene_Load.prototype.isBusy = function () { return false; };
  Scene_Load.prototype.onLoadSuccess = function () { calls.push("onLoadSuccess"); g.SceneManager.goto(g.Scene_Map); };
  Scene_Load.prototype.onLoadFailure = function () { calls.push("onLoadFailure"); };
  Object.assign(g.SceneManager, {
    push(cls: any) { calls.push("push:" + cls.name); g.SceneManager._nextScene = new cls(); },
    goto(cls: any) { calls.push("goto:" + cls.name); g.SceneManager._nextScene = new cls(); },
  });
  const system = {
    saveEnabled: true,
    isSaveEnabled() { return this.saveEnabled; },
    onBeforeSave() { calls.push("onBeforeSave"); },
    ...(engine === "MZ" ? { setSavefileId(id: number) { calls.push("setSavefileId:" + id); } } : {}),
  };
  g.$gameSystem = system;
  g.DataManager.maxSavefiles = () => 20;
  if (engine === "MZ") {
    g.Utils = { RPGMAKER_NAME: "MZ" };
    g.DataManager.savefileExists = (id: number) => !!h.saves[id];
  } else {
    g.Utils = { RPGMAKER_NAME: "MV" };
    g.DataManager.isThisGameFile = (id: number) => !!h.saves[id];
  }
  Object.assign(g, { Scene_Save, Scene_Load });
  g.SceneManager._scene = new g.Scene_Map();
  return { calls, scenes: { Scene_Save, Scene_Load }, system };
}

/** 1.22.0 defaults: Ctrl+S quick save, Ctrl+L quick load, Ctrl+Shift+S / Ctrl+Shift+L menus, Ctrl+B backup, Ctrl+Shift+B restore */
const CTRL = 256, SHIFT = 512;
const QUICK_SAVE = 83 | CTRL, QUICK_LOAD = 76 | CTRL, SAVE_MENU = 83 | CTRL | SHIFT, LOAD_MENU = 76 | CTRL | SHIFT, BACKUP = 66 | CTRL, RESTORE = 66 | CTRL | SHIFT;
/** A plain key (keyCode) through Input, or a combo (keyCode | modifier bits) through the keydown listener; then one frame. */
const press = (code: number) => {
  const I = h.g.Input;
  if (code > 255) {
    I.keyEvent(code & 255, { ctrl: (code & CTRL) !== 0, shift: (code & SHIFT) !== 0, alt: (code & 1024) !== 0 });
    h.bridge._frame(); I.update(); I.keyUp(code & 255);
  } else { I.press(code); h.bridge._frame(); I.update(); }
};
const message = () => h.bridge._lastMessage as string | undefined;
const flush = () => new Promise((r) => setTimeout(r, 0));
const writeControl = (c: Record<string, unknown>) => {
  h.fs.dirs.add(DIR);
  h.fs.writeFileSync(CONTROL_PATH, JSON.stringify({ v: 1, t: h.clock.t, ...c }));
};
const poll = () => { h.clock.t += 1000; h.bridge._tick(); };
const assistOf = () => { h.bridge._snapshotNow(); return h.readLive().assist; };
/** The pushed scene becomes the current one and starts (SceneManager.changeScene + start). */
const changeScene = () => {
  const sm = h.g.SceneManager;
  if (sm._nextScene) { sm._scene = sm._nextScene; sm._nextScene = null; sm._scene._active = true; }
};

describe("quick save (1.21.0)", () => {
  it("Ctrl+S saves to the last slot on the map (MZ: 19, via setSavefileId / onBeforeSave / promise)", async () => {
    const e = game("MZ");
    expect(assistOf().hotkeys.quickSave).toBe(QUICK_SAVE);
    press(QUICK_SAVE);
    await flush();
    expect(h.saves[19]).toBeDefined();
    expect(e.calls).toEqual(["setSavefileId:19", "onBeforeSave"]);
    expect(message()).toBe("퀵 세이브했어요 (19번 칸)");
    expect(assistOf().quickSlot).toBe(19);
  });

  it("MV: last slot is maxSavefiles (20), synchronous save", () => {
    const e = game("MV");
    press(QUICK_SAVE);
    expect(h.saves[20]).toBeDefined();
    expect(e.calls).toEqual(["onBeforeSave"]);
    expect(message()).toBe("퀵 세이브했어요 (20번 칸)");
  });

  it("control.json quickSlot picks the slot; one past the last falls back to the last", () => {
    game("MV");
    writeControl({ quickSlot: 3 });
    h.bridge._tick();
    press(QUICK_SAVE);
    expect(h.saves[3]).toBeDefined();
    writeControl({ quickSlot: 50 });
    poll();
    expect(assistOf().quickSlot).toBe(20);
  });

  it("refuses when the game disabled saving, during an event / message, in battle, off the map", () => {
    const e = game("MV");
    e.system.saveEnabled = false;
    press(QUICK_SAVE);
    expect(message()).toBe("이 게임이 지금은 저장을 막아 두었어요");
    e.system.saveEnabled = true;
    h.g.$gameMessage._busy = true;
    press(QUICK_SAVE);
    expect(message()).toBe("이벤트가 끝난 뒤에 다시 눌러 주세요");
    h.g.$gameMessage._busy = false;
    h.g.$gameMap.isEventRunning = () => true;
    press(QUICK_SAVE);
    expect(message()).toBe("이벤트가 끝난 뒤에 다시 눌러 주세요");
    h.g.$gameMap.isEventRunning = () => false;
    h.g.SceneManager._scene = new h.g.Scene_Title();
    press(QUICK_SAVE);
    expect(message()).toBe("맵에서만 저장할 수 있어요");
    expect(h.saves).toEqual({});
  });

  it("waits up to 1 s while the player is mid-step, then saves", () => {
    game("MV");
    let moving = true;
    h.g.$gamePlayer.isMoving = () => moving;
    press(QUICK_SAVE);
    expect(h.saves[20]).toBeUndefined();
    moving = false;
    h.bridge._frame();
    expect(h.saves[20]).toBeDefined();
  });

  it("reports a failed save", () => {
    game("MV");
    h.g.DataManager.saveGame = () => false;
    press(QUICK_SAVE);
    expect(message()).toBe("퀵 세이브하지 못했어요");
  });
});

describe("quick load (1.21.0)", () => {
  it("Ctrl+L needs a second press within 2 s, then loads the slot through Scene_Load (MZ promise)", async () => {
    const e = game("MZ");
    h.saves[19] = h.g.DataManager.makeSaveContents();
    press(QUICK_LOAD);
    expect(message()).toBe("한 번 더 누르면 퀵 세이브(19번 칸)를 불러와요");
    expect(e.calls).toEqual([]);
    h.clock.t += 2500; // too late: arms again
    press(QUICK_LOAD);
    expect(e.calls).toEqual([]);
    h.clock.t += 500;
    press(QUICK_LOAD);
    expect(e.calls).toEqual(["push:Scene_Load"]);
    h.bridge._frame(); // load scene not up yet: waits
    changeScene();
    h.bridge._frame();
    await flush();
    expect(e.calls).toEqual(["push:Scene_Load", "onLoadSuccess", "goto:Scene_Map"]);
    expect(message()).toBe("퀵 로드했어요 (19번 칸)");
  });

  it("an empty slot says so and does not arm", () => {
    const e = game("MV");
    press(QUICK_LOAD);
    expect(message()).toBe("퀵 세이브(20번 칸)가 아직 없어요");
    press(QUICK_LOAD);
    expect(e.calls).toEqual([]);
  });

  it("works on the title screen (MV, synchronous load)", () => {
    const e = game("MV");
    h.saves[20] = h.g.DataManager.makeSaveContents();
    h.g.SceneManager._scene = new h.g.Scene_Title();
    press(QUICK_LOAD);
    press(QUICK_LOAD);
    changeScene();
    h.bridge._frame();
    expect(e.calls).toEqual(["push:Scene_Load", "onLoadSuccess", "goto:Scene_Map"]);
  });

  it("a failed load leaves the load screen to the player", () => {
    const e = game("MV");
    h.saves[20] = h.g.DataManager.makeSaveContents();
    h.g.DataManager.loadGame = () => false;
    press(QUICK_LOAD);
    press(QUICK_LOAD);
    changeScene();
    h.bridge._frame();
    expect(e.calls).toEqual(["push:Scene_Load", "onLoadFailure"]);
    expect(message()).toBe("퀵 로드하지 못했어요");
  });
});

describe("save / load commands from the viewer (1.21.0)", () => {
  it("quickSave / quickLoad (no second press) / saveMenu / loadMenu echo their id", () => {
    const e = game("MV");
    writeControl({ command: { id: "q-1", kind: "quickSave", at: h.clock.t } });
    h.bridge._tick();
    h.bridge._frame();
    expect(h.saves[20]).toBeDefined();
    expect(assistOf().lastCommand).toBe("q-1");
    writeControl({ command: { id: "q-2", kind: "quickLoad", at: h.clock.t + 1000 } });
    poll();
    h.bridge._frame();
    expect(e.calls).toContain("push:Scene_Load");
    changeScene();
    h.bridge._frame();
    expect(assistOf().lastCommand).toBe("q-2");
    h.g.SceneManager._scene = new h.g.Scene_Map();
    h.g.SceneManager._nextScene = null;
    writeControl({ command: { id: "q-3", kind: "saveMenu", at: h.clock.t + 1000 } });
    poll();
    h.bridge._frame();
    expect(e.calls[e.calls.length - 1]).toBe("push:Scene_Save");
    expect(assistOf().lastCommand).toBe("q-3");
  });

  it("ignored (with the reason on screen) when it can't run now; loadMenu works on the title", () => {
    const e = game("MV");
    h.g.$gameMap.isEventRunning = () => true;
    writeControl({ command: { id: "q-4", kind: "saveMenu", at: h.clock.t } });
    h.bridge._tick();
    h.bridge._frame();
    expect(assistOf().lastCommand).toBe("q-4:ignored");
    expect(message()).toBe("이벤트가 끝난 뒤에 다시 눌러 주세요");
    h.g.SceneManager._scene = new h.g.Scene_Title();
    writeControl({ command: { id: "q-5", kind: "loadMenu", at: h.clock.t + 1000 } });
    poll();
    h.bridge._frame();
    expect(e.calls).toEqual(["push:Scene_Load"]);
    h.g.SceneManager._scene = new h.g.Scene_Map(); // live.json is not written on the title
    expect(assistOf().lastCommand).toBe("q-5");
  });

  it("save / load menus default to Ctrl+Shift+S / Ctrl+Shift+L (1.22.0); plain keys work once set", () => {
    const e = game("MV");
    expect(assistOf().hotkeys).toMatchObject({ saveMenu: SAVE_MENU, loadMenu: LOAD_MENU });
    press(SAVE_MENU);
    expect(e.calls).toEqual(["push:Scene_Save"]);
    const f = game("MV");
    writeControl({ hotkeys: { saveMenu: 80, loadMenu: 79 } });
    h.bridge._tick();
    press(80);
    expect(f.calls).toEqual(["push:Scene_Save"]);
  });
});

describe("backup / restore requests to the viewer (1.21.0)", () => {
  it("Ctrl+B writes request.json and shows the viewer's answer once", () => {
    game("MV");
    expect(assistOf().hotkeys).toMatchObject({ backup: BACKUP, restore: RESTORE });
    press(BACKUP);
    const req = JSON.parse(h.fs.readFileSync(REQUEST_PATH));
    expect(req).toMatchObject({ v: 1, kind: "backup", at: h.clock.t });
    expect(typeof req.id).toBe("string");
    expect(message()).toBe("백업 요청했어요…");
    writeControl({ keyReply: { id: "other", n: 1, text: "남의 답" } });
    poll();
    expect(message()).toBe("백업 요청했어요…");
    writeControl({ keyReply: { id: req.id, n: 1, text: "백업했어요" } });
    poll();
    expect(message()).toBe("백업했어요");
    h.bridge._lastMessage = null;
    writeControl({ speed: 2, keyReply: { id: req.id, n: 1, text: "백업했어요" } }); // same answer again: not shown
    poll();
    expect(message()).toBeNull();
    h.clock.t += 10_000;
    h.bridge._frame();
    expect(message()).toBeNull(); // answered: no timeout notice
  });

  it("restore needs two presses within 2 s; no answer in 5 s says the viewer is not responding", () => {
    game("MV");
    press(RESTORE);
    expect(h.fs.existsSync(REQUEST_PATH)).toBe(false);
    expect(message()).toBe("한 번 더 누르면 마지막 백업으로 되돌려요");
    h.clock.t += 1000;
    press(RESTORE);
    expect(JSON.parse(h.fs.readFileSync(REQUEST_PATH))).toMatchObject({ kind: "restore" });
    expect(message()).toBe("마지막 백업으로 되돌리는 중…");
    h.clock.t += 5000;
    h.bridge._frame();
    expect(message()).toMatch(/RPG Viewer가 응답하지 않아요/);
  });

  it("works on the title screen too (live.json is not written there)", () => {
    game("MV");
    h.g.SceneManager._scene = new h.g.Scene_Title();
    press(BACKUP);
    expect(JSON.parse(h.fs.readFileSync(REQUEST_PATH)).kind).toBe("backup");
  });
});
