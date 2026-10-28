import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cmd, createHarness, LIVE_PATH, LOG_PATH, META_PATH, MemFs, PLUGIN_PATH, type Harness } from "./harness";

let h: Harness;
afterEach(() => { h?.bridge?._flushNow(); });

const types = (log: any[]) => log.map((r) => r.type);

function newGame(engine: "MZ" | "MV" = "MZ", fs?: MemFs): Harness {
  const harness = createHarness({ engine, fs });
  harness.g.DataManager.setupNewGame();
  return harness;
}

describe("RPGViewerBridge", () => {
  it("writes nothing before a branch starts", () => {
    h = createHarness();
    h.g.$gameSwitches.setValue(1, true);
    h.g.$gameVariables.setValue(2, 5);
    expect(h.readLog()).toEqual([]);
    h.bridge._snapshotNow();
    expect(h.readLive()).toBeUndefined();
  });

  it("ignores setupNewGame during Scene_Boot", () => {
    h = createHarness();
    h.g.SceneManager._scene = new h.g.Scene_Boot();
    h.g.DataManager.setupNewGame();
    expect(h.readLog()).toEqual([]);
  });

  it("new game starts run 1 branch 1", () => {
    h = newGame();
    const log = h.readLog();
    expect(log).toEqual([
      { v: 1, seq: 1, t: 1_000_000, run: 1, branch: 1, type: "branchStart", reason: "newGame", parentBranch: null, fromSeq: null },
    ]);
  });

  it("records transfers after performTransfer", () => {
    h = newGame();
    h.g.$gamePlayer.performTransfer();
    h.g.$gamePlayer.performTransfer(); // not transferring any more -> nothing
    const log = h.readLog();
    expect(log.slice(1)).toEqual([expect.objectContaining({ type: "transfer", mapId: 1, x: 3, y: 4 })]);
  });

  for (const engine of ["MZ", "MV"] as const) {
    it(`records a message with source and cmd (${engine})`, () => {
      h = newGame(engine);
      // MV's 101 has 4 parameters; MZ adds the speaker name as params[4].
      const params = engine === "MZ" ? ["Actor1", 2, 0, 2, "Harold"] : ["Actor1", 2, 0, 2];
      const list = [cmd(101, params), cmd(401, ["a"]), cmd(401, ["b"]), cmd(0)];
      h.addMapEvent(3, [[cmd(0)], list], 1);
      const interp = h.g.$gameMap._interpreter;
      interp.setup(list, 3);
      h.runCommand(interp, 0);
      const msg = h.readLog().find((r) => r.type === "message");
      expect(msg).toEqual({
        v: 1, seq: 2, t: 1_000_000, run: 1, branch: 1, type: "message",
        src: { source: "map", mapId: 1, eventId: 3, page: 1 }, cmd: 0,
        face: "Actor1", faceIndex: 2, speaker: engine === "MZ" ? "Harold" : "", text: "a\nb",
      });
    });
  }

  it("does not record a message while the message window is busy", () => {
    h = newGame();
    const list = [cmd(101, ["", 0, 0, 2, ""]), cmd(401, ["x"]), cmd(0)];
    const interp = h.newInterpreter();
    interp.setup(list, 0);
    h.g.$gameMessage._busy = true;
    h.runCommand(interp, 0);
    expect(types(h.readLog())).toEqual(["branchStart"]);
  });

  it("resolves common event source by list identity", () => {
    h = newGame();
    const list = [cmd(101, ["", 0, 0, 2, ""]), cmd(401, ["hello"]), cmd(0)];
    h.g.$dataCommonEvents[1] = { id: 1, list };
    const interp = h.newInterpreter();
    interp.setup(list, 0);
    expect(interp._rpgvSrc).toEqual({ source: "common", commonEventId: 1 });
    h.runCommand(interp, 0);
    expect(h.readLog()[1]).toMatchObject({ type: "message", src: { source: "common", commonEventId: 1 }, text: "hello" });
  });

  it("resolves troop source by list identity", () => {
    h = newGame();
    const list = [cmd(231, [1, "pic"]), cmd(0)];
    h.g.$dataTroops[4] = { id: 4, pages: [{ list: [] }, { list }] };
    h.g.$gameTroop._troopId = 4;
    const interp = h.newInterpreter();
    interp.setup(list, 0);
    h.runCommand(interp, 0);
    expect(h.readLog()[1]).toMatchObject({
      type: "picture", src: { source: "troop", troopId: 4, page: 1 }, cmd: 0, pictureId: 1, name: "pic",
    });
  });

  it("unknown list resolves to a null source", () => {
    h = newGame();
    const interp = h.newInterpreter();
    interp.setup([cmd(105, [2, false]), cmd(405, ["s1"]), cmd(405, ["s2"]), cmd(0)], 0);
    h.runCommand(interp, 0);
    expect(h.readLog()[1]).toMatchObject({ type: "scroll", src: null, cmd: 0, text: "s1\ns2" });
  });

  for (const engine of ["MZ", "MV"] as const) {
    it(`records choices and the picked index (${engine})`, () => {
      h = newGame(engine);
      const list = [cmd(102, [["Yes", "No"], -2, 0, 2, 0]), cmd(0)];
      h.addMapEvent(1, [list]);
      const interp = h.g.$gameMap._interpreter;
      interp.setup(list, 1);
      h.runCommand(interp, 0);
      h.g.$gameMessage.onChoice(1);
      expect(interp._branch[0]).toBe(1); // original callback still ran
      h.runCommand(interp, 0);
      h.g.$gameMessage.onChoice(-2);
      expect(interp._branch[0]).toBe(-2);
      const src = { source: "map", mapId: 1, eventId: 1, page: 0 };
      expect(h.readLog().slice(1)).toEqual([
        expect.objectContaining({ type: "choices", src, cmd: 0, options: ["Yes", "No"] }),
        expect.objectContaining({ type: "choice", src, cmd: 0, picked: 1 }),
        expect.objectContaining({ type: "choices", src, cmd: 0 }),
        expect.objectContaining({ type: "choice", src, cmd: 0, picked: -2 }),
      ]);
    });
  }

  it("records choices shown inline after a message (101 -> 102)", () => {
    h = newGame();
    const list = [cmd(101, ["", 0, 0, 2, ""]), cmd(401, ["Q?"]), cmd(102, [["A", "B"], 1, 0, 2, 0]), cmd(0)];
    const interp = h.newInterpreter();
    interp.setup(list, 0);
    h.runCommand(interp, 0);
    h.g.$gameMessage.onChoice(0);
    expect(h.readLog().slice(1)).toEqual([
      expect.objectContaining({ type: "message", cmd: 0, text: "Q?" }),
      expect.objectContaining({ type: "choices", cmd: 2, options: ["A", "B"] }),
      expect.objectContaining({ type: "choice", cmd: 2, picked: 0 }),
    ]);
  });

  it("groups state changes per frame with source", () => {
    h = newGame();
    const list = [cmd(121, [1, 2, 0]), cmd(123, ["A", 0]), cmd(0)];
    h.addMapEvent(2, [list]);
    const interp = h.g.$gameMap._interpreter;
    interp.setup(list, 2);
    h.runCommand(interp, 0);
    h.runCommand(interp, 1);
    const src = { source: "map", mapId: 1, eventId: 2, page: 0 };
    expect(h.readLog().slice(1)).toEqual([
      { v: 1, seq: 2, t: 1_000_000, run: 1, branch: 1, type: "state", src, cmd: 0, changes: [
        { kind: "switch", id: 1, value: true }, { kind: "switch", id: 2, value: true },
      ] },
      { v: 1, seq: 3, t: 1_000_000, run: 1, branch: 1, type: "state", src, cmd: 1, changes: [
        { kind: "selfSwitch", id: "1,2,A", value: true },
      ] },
    ]);
  });

  it("state outside an interpreter has null src/cmd and closes before the next record", () => {
    h = newGame();
    h.g.$gameVariables.setValue(5, 10);
    h.g.$gameVariables.setValue(6, 1);
    h.g.$gamePlayer.performTransfer();
    expect(h.readLog().slice(1)).toEqual([
      expect.objectContaining({ type: "state", src: null, cmd: null, changes: [
        { kind: "variable", id: 5, value: 10 }, { kind: "variable", id: 6, value: 1 },
      ] }),
      expect.objectContaining({ type: "transfer" }),
    ]);
  });

  // A "set variable" command for the fake engine (MZ passes params, MV reads this._params).
  function addCommand122(harness: Harness) {
    harness.g.Game_Interpreter.prototype.command122 = function (this: any, params?: any[]) {
      const p = params ?? this._params;
      harness.g.$gameVariables.setValue(p[0], p[1]);
      return true;
    };
  }

  it("groups a flush window's state changes by src+cmd, last value per variable wins", () => {
    h = newGame();
    addCommand122(h);
    const listA = [cmd(122, [1, 0]), cmd(0)];
    const listB = [cmd(122, [2, 0]), cmd(0)];
    h.addMapEvent(2, [listA]);
    h.addMapEvent(3, [listB]);
    const a = h.newInterpreter(), b = h.newInterpreter();
    a.setup(listA, 2);
    b.setup(listB, 3);
    // two parallel events alternating every frame for 250ms (one flush window)
    for (let f = 1; f <= 15; f++) {
      listA[0].parameters[1] = f;
      listB[0].parameters[1] = f * 10;
      h.runCommand(a, 0);
      h.runCommand(b, 0);
      h.clock.t += 16;
    }
    const states = h.readLog().filter((r) => r.type === "state");
    expect(states.length).toBeLessThanOrEqual(2);
    expect(states).toEqual([
      expect.objectContaining({ src: { source: "map", mapId: 1, eventId: 2, page: 0 }, cmd: 0, changes: [{ kind: "variable", id: 1, value: 15 }] }),
      expect.objectContaining({ src: { source: "map", mapId: 1, eventId: 3, page: 0 }, cmd: 0, changes: [{ kind: "variable", id: 2, value: 150 }] }),
    ]);
  });

  it("keeps grouped state ordered relative to other records", () => {
    h = newGame();
    addCommand122(h);
    const list = [cmd(122, [1, 1]), cmd(101, ["", 0, 0, 2, ""]), cmd(401, ["hi"]), cmd(122, [1, 2]), cmd(0)];
    h.addMapEvent(2, [list]);
    const interp = h.newInterpreter();
    interp.setup(list, 2);
    h.runCommand(interp, 0);
    h.runCommand(interp, 1);
    h.g.$gameMessage._busy = false;
    h.runCommand(interp, 3);
    h.g.$gameVariables.setValue(7, 1);
    h.runCommand(interp, 0);
    expect(h.readLog().slice(1).map((r) => [r.type, r.cmd ?? null, r.changes ?? null])).toEqual([
      ["state", 0, [{ kind: "variable", id: 1, value: 1 }]],
      ["message", 1, null],
      ["state", 3, [{ kind: "variable", id: 1, value: 2 }]],
      ["state", null, [{ kind: "variable", id: 7, value: 1 }]],
      ["state", 0, [{ kind: "variable", id: 1, value: 1 }]],
    ]);
  });

  it("logs only numeric or boolean variable values", () => {
    h = newGame();
    h.g.$gameVariables.setValue(1, "text");
    h.g.$gameVariables.setValue(2, [1, 2]);
    h.g.$gameVariables.setValue(3, true);
    h.g.$gameVariables.setValue(4, 5);
    expect(h.readLog().slice(1)).toEqual([
      expect.objectContaining({ type: "state", changes: [{ kind: "variable", id: 3, value: true }, { kind: "variable", id: 4, value: 5 }] }),
    ]);
  });

  it("ignores setValue with unchanged value", () => {
    h = newGame();
    h.g.$gameSwitches.setValue(1, false);
    h.g.$gameVariables.setValue(1, 0);
    h.g.$gameSelfSwitches.setValue([1, 1, "A"], false);
    h.g.$gameVariables.setValue(2, 3);
    h.g.$gameVariables.setValue(2, 3);
    const log = h.readLog();
    expect(log).toHaveLength(2);
    expect(log[1].changes).toEqual([{ kind: "variable", id: 2, value: 3 }]);
  });

  it("records battle start and end", () => {
    h = newGame();
    h.g.BattleManager.setup(7, true, false);
    h.g.BattleManager.endBattle(1);
    expect(h.readLog().slice(1)).toEqual([
      expect.objectContaining({ type: "battle", phase: "start", troopId: 7 }),
      expect.objectContaining({ type: "battle", phase: "end", troopId: 7, result: "escape" }),
    ]);
  });

  for (const engine of ["MZ", "MV"] as const) {
    it(`stamps saves and branches on load (${engine})`, async () => {
      h = newGame(engine);
      h.g.$gameSwitches.setValue(1, true);
      await h.g.DataManager.saveGame(1);
      expect(h.saves[1].rpgViewer).toEqual({ run: 1, branch: 1, seq: 2 });
      h.clock.t += 5000;
      const loaded = await h.g.DataManager.loadGame(1);
      expect(loaded).toBe(engine === "MZ" ? 0 : true);
      const log = h.readLog();
      expect(types(log)).toEqual(["branchStart", "state", "save", "branchStart", "load"]);
      expect(log[2]).toMatchObject({ seq: 3, run: 1, branch: 1, slot: 1 });
      expect(log[3]).toEqual({
        v: 1, seq: 4, t: 1_005_000, run: 1, branch: 2, type: "branchStart", reason: "load", parentBranch: 1, fromSeq: 2,
      });
      expect(log[4]).toMatchObject({ seq: 5, run: 1, branch: 2, type: "load", slot: 1 });
    });
  }

  for (const engine of ["MZ", "MV"] as const) {
    it(`flushes the log right after a successful save (${engine})`, async () => {
      h = newGame(engine);
      h.g.$gameSwitches.setValue(1, true);
      await h.g.DataManager.saveGame(1);
      // read the file directly: no _flushNow()
      const onDisk = (h.fs.files.get(LOG_PATH) ?? "").trim().split("\n").map((l) => JSON.parse(l));
      expect(onDisk.map((r) => r.type)).toEqual(["branchStart", "state", "save"]);
      expect(onDisk[1].seq).toBe(h.saves[1].rpgViewer.seq);
      expect(JSON.parse(h.fs.readFileSync(META_PATH)).nextSeq).toBe(4);
    });
  }

  it("does not log a load when loading fails", async () => {
    h = newGame("MZ");
    await expect(h.g.DataManager.loadGame(9)).rejects.toThrow("no save");
    expect(types(h.readLog())).toEqual(["branchStart"]);
  });

  it("unknown save starts a new run", () => {
    h = newGame();
    h.g.DataManager.extractSaveContents({});
    const log = h.readLog();
    expect(log[1]).toMatchObject({ run: 2, branch: 2, type: "branchStart", reason: "unknownSave", parentBranch: null, fromSeq: null });
  });

  it("loading a stamp from a later run keeps run/branch counters ahead of it", () => {
    h = createHarness();
    h.g.DataManager.extractSaveContents({ rpgViewer: { run: 5, branch: 9, seq: 40 } });
    h.g.DataManager.setupNewGame();
    const log = h.readLog();
    expect(log[0]).toMatchObject({ seq: 41, run: 5, branch: 10, reason: "load", parentBranch: 9, fromSeq: 40 });
    expect(log[1]).toMatchObject({ seq: 42, run: 6, branch: 11, reason: "newGame" });
  });

  it("continues seq across restarts via meta.json", () => {
    h = newGame();
    h.g.$gameVariables.setValue(1, 1);
    h.readLog();
    expect(JSON.parse(h.fs.readFileSync(META_PATH))).toEqual({ nextRun: 2, nextBranch: 2, nextSeq: 3 });
    const fs = h.fs;
    h = newGame("MZ", fs);
    const log = h.readLog();
    expect(log.map((r) => [r.seq, r.run, r.branch])).toEqual([[1, 1, 1], [2, 1, 1], [3, 2, 2]]);
  });

  it("recovers counters from the log when meta.json is missing", () => {
    h = newGame();
    h.g.$gameVariables.setValue(1, 1);
    h.readLog();
    const fs = h.fs;
    fs.files.delete(META_PATH);
    h = newGame("MZ", fs);
    expect(h.readLog()[2]).toMatchObject({ seq: 3, run: 2, branch: 2 });
  });

  it("writes live snapshot atomically", () => {
    h = newGame();
    const list = [cmd(102, [["Go", "Stay"], -1, 0, 2, 0]), cmd(0)];
    h.addMapEvent(1, [list]);
    h.addMapEvent(2, [[cmd(0)]], -1);
    const interp = h.g.$gameMap._interpreter;
    interp.setup(list, 1);
    h.runCommand(interp, 0);
    h.g.$gamePlayer.performTransfer();
    h.g.$gameSwitches.setValue(3, true);
    h.g.$gameVariables.setValue(4, 9);
    h.g.$gameSelfSwitches.setValue([1, 2, "B"], true);
    Object.assign(h.g.$gameParty, { _items: { 1: 2, 2: 0 }, _weapons: { 3: 1 }, _armors: {}, _gold: 120, _actors: [1, 4] });
    h.bridge._flushNow();
    h.bridge._snapshotNow();
    expect(h.fs.existsSync(LIVE_PATH + ".tmp")).toBe(false);
    const src = { source: "map", mapId: 1, eventId: 1, page: 0 };
    expect(h.readLive()).toEqual({
      v: 1, t: 1_000_000, pluginVersion: "1.0.1", run: 1, branch: 1, seq: 4,
      mapId: 1, x: 3, y: 4, running: src,
      events: [{ eventId: 1, page: 0 }, { eventId: 2, page: -1 }],
      switches: [3], variables: { 4: 9 }, selfSwitches: ["1,2,B"],
      items: { 1: 2 }, weapons: { 3: 1 }, armors: {}, gold: 120, party: [1, 4],
      choice: { src, cmd: 0, options: ["Go", "Stay"] }, inBattle: false,
    });
  });

  it("snapshots on change at most once per second, heartbeat every 2 seconds", () => {
    h = newGame();
    const liveT = () => JSON.parse(h.fs.files.get(LIVE_PATH)!).t;
    h.bridge._tick();
    expect(liveT()).toBe(1_000_000);
    h.clock.t += 500;
    h.bridge._tick(); // unchanged, < 2s
    expect(liveT()).toBe(1_000_000);
    h.g.$gameSwitches.setValue(8, true);
    h.bridge._tick(); // changed but < 1s since last write -> throttled
    expect(liveT()).toBe(1_000_000);
    h.clock.t += 499;
    h.bridge._tick();
    expect(liveT()).toBe(1_000_000);
    h.clock.t += 1;
    h.bridge._tick(); // 1000ms since last write -> change written
    expect(JSON.parse(h.fs.files.get(LIVE_PATH)!)).toMatchObject({ t: 1_001_000, switches: [8] });
    h.clock.t += 1999;
    h.bridge._tick();
    expect(liveT()).toBe(1_001_000);
    h.clock.t += 1;
    h.bridge._tick(); // heartbeat
    expect(liveT()).toBe(1_003_000);
  });

  it("does not write live.json on the title screen and a title transfer starts no run", () => {
    h = newGame();
    h.g.SceneManager._scene = new h.g.Scene_Title(); // "To Title" after play
    h.bridge._snapshotNow();
    h.clock.t += 5000;
    h.bridge._tick();
    expect(h.readLive()).toBeUndefined();
    h.g.SceneManager._scene = new h.g.Scene_Map();
    h.bridge._snapshotNow();
    expect(h.readLive()).toMatchObject({ run: 1 });

    h = createHarness();
    h.g.SceneManager._scene = new h.g.Scene_Boot();
    h.g.DataManager.setupNewGame(); // boot call: deferred
    h.g.SceneManager._scene = new h.g.Scene_Title();
    h.g.$gamePlayer.performTransfer();
    expect(h.readLog()).toEqual([]);
  });

  it("removes a leftover live.json.tmp on startup", () => {
    const fs = new MemFs();
    fs.mkdirSync("/game/www/rpg-viewer");
    fs.writeFileSync(LIVE_PATH + ".tmp", "{");
    h = createHarness({ fs });
    expect(fs.existsSync(LIVE_PATH + ".tmp")).toBe(false);
  });

  it("writes an identical error message once and rate-limits different ones", () => {
    h = newGame();
    const interp = h.newInterpreter();
    const failWith = (m: string) => { h.g.$gameMap.event = () => { throw new Error(m); }; interp.setup([cmd(0)], 1); };
    failWith("same");                  // t0: written
    h.clock.t += 1500; failWith("same");  // same message again: suppressed
    h.clock.t += 100; failWith("other");  // different, > 1s since last write: written
    h.clock.t += 100; failWith("third");  // < 1s since last write: rate-limited
    h.clock.t += 5000; failWith("other"); // repeat of the last written message: suppressed
    h.clock.t += 2000; failWith("same");  // alternating repeat within 60s of its write: suppressed
    const errors = h.readLog().filter((r) => r.type === "error").map((r) => r.message);
    expect(errors).toEqual(["same", "other"]);
  });

  it("allows an identical error message again after 60 seconds", () => {
    h = newGame();
    const interp = h.newInterpreter();
    const failWith = (m: string) => { h.g.$gameMap.event = () => { throw new Error(m); }; interp.setup([cmd(0)], 1); };
    failWith("same");                     // t0: written
    h.clock.t += 59_000; failWith("same");  // within 60s: suppressed
    h.clock.t += 1_000; failWith("same");   // 60s after the write: written again
    h.clock.t += 30_000; failWith("same");  // within 60s of the second write: suppressed
    const errors = h.readLog().filter((r) => r.type === "error");
    expect(errors.map((r) => r.t)).toEqual([1_000_000, 1_060_000]);
  });

  it("marks the install flag non-enumerable", () => {
    h = createHarness();
    const d = Object.getOwnPropertyDescriptor(h.g.Game_Interpreter.prototype, "__rpgvInstalled");
    expect(d).toMatchObject({ value: true, enumerable: false });
  });

  it("documents the save-preview caveat in the header", () => {
    const header = readFileSync(PLUGIN_PATH, "utf8").split("*/")[0];
    expect(header).toContain("extractSaveContents");
  });

  it("never throws from hooks", () => {
    h = newGame();
    h.g.$gameMap.event = () => { throw new Error("boom"); };
    const list = [cmd(101, ["", 0, 0, 2, ""]), cmd(401, ["still shown"]), cmd(0)];
    const interp = h.newInterpreter();
    expect(() => interp.setup(list, 5)).not.toThrow();
    expect(interp._list).toBe(list);
    expect(() => h.runCommand(interp, 0)).not.toThrow();
    expect(h.g.$gameMessage._texts).toEqual(["still shown"]);
    h.g.$gameMap.events = () => { throw new Error("boom2"); };
    expect(() => h.bridge._snapshotNow()).not.toThrow();
    const log = h.readLog();
    expect(log.filter((r) => r.type === "error")).toEqual([
      expect.objectContaining({ run: 1, branch: 1, message: expect.stringContaining("boom") }),
    ]); // second error within the same second is rate-limited
    expect(log.find((r) => r.type === "message")).toMatchObject({ src: null, text: "still shown" });
  });

  it("keeps the game running when the log cannot be written", () => {
    h = newGame();
    h.fs.appendFileSync = () => { throw new Error("disk full"); };
    expect(() => h.bridge._flushNow()).not.toThrow();
    expect(() => h.g.$gameSwitches.setValue(1, true)).not.toThrow();
    expect(h.g.$gameSwitches.value(1)).toBe(true);
  });

  it("exposes VERSION once with an RPG Maker plugin header", () => {
    const src = readFileSync(PLUGIN_PATH, "utf8");
    expect(src.match(/VERSION:\s*"1\.0\.1"/g)).toHaveLength(1);
    expect(src.startsWith("/*:")).toBe(true);
    expect(src).toContain("@target MZ MV");
    expect(src).toContain("@plugindesc RPG Viewer 기록 플러그인");
    expect(src).toContain("@author RPG Viewer");
    h = createHarness();
    expect(h.bridge.VERSION).toBe("1.0.1");
  });

  it("uses ES2015-compatible syntax only", () => {
    const src = readFileSync(PLUGIN_PATH, "utf8");
    expect(src).not.toMatch(/\?\.|\?\?|=>|\bclass\b|\basync\b|\bawait\b|^\s*(import|export)\b/m);
  });
});
