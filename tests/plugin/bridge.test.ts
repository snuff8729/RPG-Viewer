import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { noisyVariables } from "../../src/core/live/history";
import { cmd, createHarness, LIVE_PATH, LOG_PATH, META_PATH, MemFs, PLUGIN_PATH, type Harness } from "./harness";

let h: Harness;
afterEach(() => { h?.bridge?._flushNow(); });

// emits one story (message) record on the current branch
const say = (hh: Harness) => {
  const list = [cmd(101, ["", 0, 0, 2, ""]), cmd(401, ["hi"]), cmd(0)];
  hh.addMapEvent(3, [list], 0);
  const interp = hh.g.$gameMap._interpreter;
  interp.setup(list, 3);
  hh.runCommand(interp, 0);
  hh.bridge._flushNow();
};
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

  it("logs resolved Show Picture values, Move Picture targets and Erase Picture (1.15.0)", () => {
    h = newGame();
    h.g.$gameVariables.setValue(7, 300);
    h.g.$gameVariables.setValue(8, 40);
    const list = [
      cmd(231, [2, "Body", 1, 0, 408, 312, 100, 100, 0, 0]),
      cmd(231, [3, "Eyes", 0, 1, 7, 8, 50, 60, 200, 1]),
      cmd(232, [2, "", 1, 0, 400, 300, 100, 100, 255, 0, 30, false]),
      cmd(235, [3]),
      cmd(0),
    ];
    h.addMapEvent(3, [list], 0);
    const interp = h.g.$gameMap._interpreter;
    interp.setup(list, 3);
    for (let i = 0; i < 4; i++) h.runCommand(interp, i);
    const pics = h.readLog().filter((r) => r.type === "picture");
    expect(pics[0]).toMatchObject({ pictureId: 2, name: "Body", origin: 1, x: 408, y: 312, scaleX: 100, scaleY: 100, opacity: 0, blend: 0 });
    expect(pics[0].op).toBeUndefined();
    expect(pics[1]).toMatchObject({ pictureId: 3, name: "Eyes", origin: 0, x: 300, y: 40, scaleX: 50, scaleY: 60, opacity: 200, blend: 1 });
    expect(pics[2]).toMatchObject({ op: "move", pictureId: 2, name: "", origin: 1, x: 400, y: 300, opacity: 255, cmd: 2 });
    expect(pics[3]).toMatchObject({ op: "erase", pictureId: 3, name: "", cmd: 3 });
    expect(pics[3].x).toBeUndefined();
  });

  it("unknown list resolves to a null source", () => {
    h = newGame();
    const interp = h.newInterpreter();
    interp.setup([cmd(105, [2, false]), cmd(405, ["s1"]), cmd(405, ["s2"]), cmd(0)], 0);
    h.runCommand(interp, 0);
    expect(h.readLog()[1]).toMatchObject({ type: "scroll", src: null, cmd: 0, text: "s1\ns2" });
  });

  it("resolves a TemplateEvent original page run from a template page as an origin source", () => {
    h = newGame();
    const original = [cmd(101, ["", 0, 0, 2, ""]), cmd(401, ["found it"]), cmd(0)];
    const tplP0 = [cmd(0)];
    const tplP1 = [cmd(356, ["TE固有イベント呼び出し"]), cmd(0)];
    const ev = h.addMapEvent(5, [tplP0, tplP1], 1);
    ev.getOriginalPages = () => [{ list: [cmd(0)] }, { list: original }];
    const interp = h.g.$gameMap._interpreter;
    interp.setup(tplP1, 5);
    expect(interp._rpgvSrc).toEqual({ source: "map", mapId: 1, eventId: 5, page: 1 });
    interp.setupChild(original, 5);
    const child = interp._childInterpreter;
    expect(child._rpgvSrc).toEqual({ source: "map", mapId: 1, eventId: 5, page: 1, origin: 1 });
    h.runCommand(child, 0);
    expect(h.readLog()[1]).toMatchObject({
      type: "message", src: { source: "map", mapId: 1, eventId: 5, page: 1, origin: 1 }, cmd: 0, text: "found it",
    });
  });

  it("origin page not called from the same event uses page = origin", () => {
    h = newGame();
    const original = [cmd(101, ["", 0, 0, 2, ""]), cmd(401, ["x"]), cmd(0)];
    const ev = h.addMapEvent(5, [[cmd(0)], [cmd(0)]], 1);
    ev.getOriginalPages = () => [{ list: [cmd(0)] }, { list: original }];
    const interp = h.newInterpreter();
    interp.setup(original, 5);
    expect(interp._rpgvSrc).toEqual({ source: "map", mapId: 1, eventId: 5, page: 1, origin: 1 });
    // 다른 이벤트가 이름으로 부름: KeepEventId 꺼짐(대상 id) / 켜짐(부른 이벤트 id)
    const mine = [cmd(356, ["TE_CALL_MAP_EVENT 2 EV5"]), cmd(0)];
    h.addMapEvent(4, [mine]);
    const caller = h.g.$gameMap._interpreter;
    caller.setup(mine, 4);
    caller.setupChild(original, 5);
    expect(caller._childInterpreter._rpgvSrc).toEqual({ source: "map", mapId: 1, eventId: 5, page: 1, origin: 1 });
    caller.setupChild(original, 4);
    expect(caller._childInterpreter._rpgvSrc).toEqual({ source: "map", mapId: 1, eventId: 5, page: 1, origin: 1 });
  });

  it("resolves another map event's page run by this event (TE_CALL_MAP_EVENT)", () => {
    h = newGame();
    const other = [cmd(101, ["", 0, 0, 2, ""]), cmd(401, ["other"]), cmd(0)];
    h.addMapEvent(2, [[cmd(0)], other]);
    const mine = [cmd(356, ["TE_CALL_MAP_EVENT 2 2"]), cmd(0)];
    h.addMapEvent(4, [mine]);
    const interp = h.g.$gameMap._interpreter;
    interp.setup(mine, 4);
    interp.setupChild(other, 4);
    expect(interp._childInterpreter._rpgvSrc).toEqual({ source: "map", mapId: 1, eventId: 2, page: 1 });
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

  describe("frequent variable throttling", () => {
    const varChanges = (log: any[], id: number) =>
      log.filter((r) => r.type === "state").flatMap((r) => r.changes).filter((c: any) => c.kind === "variable" && c.id === id);

    it("limits a per-frame variable to ~30 + one per 10s and keeps the last value", () => {
      h = newGame();
      let v = 0;
      for (let f = 0; f < 7500; f++) { // 2 minutes at 16ms
        h.g.$gameVariables.setValue(1, ++v);
        h.g.$gameSwitches.setValue(2, f % 2 === 0);
        h.clock.t += 16;
        h.bridge._tick();
      }
      h.bridge._tick();
      const log = h.readLog();
      const ch = varChanges(log, 1);
      expect(ch.length).toBeGreaterThanOrEqual(30);
      expect(ch.length).toBeLessThanOrEqual(30 + 14 + 3);
      expect(ch[ch.length - 1].value).toBeGreaterThan(v - 700); // within the last ~10s
      expect(log.filter((r) => r.type === "state").flatMap((r) => r.changes).filter((c: any) => c.kind === "switch")).toHaveLength(7500);
    });

    it("marks every change emitted in throttled mode (incl. released pending) as throttled", () => {
      h = newGame();
      for (let i = 1; i <= 40; i++) { h.g.$gameVariables.setValue(1, i); h.bridge._tick(); h.clock.t += 16; }
      h.clock.t += 1000;
      h.g.$gameVariables.setValue(1, 100); // pending
      h.clock.t += 10_000;
      h.bridge._tick(); // released
      h.clock.t += 10_000;
      h.g.$gameVariables.setValue(1, 200); // still frequent, admitted directly after 10s
      h.bridge._tick();
      const ch = varChanges(h.readLog(), 1);
      expect(ch.slice(0, 30).every((c: any) => c.throttled === undefined)).toBe(true);
      const later = ch.slice(30);
      expect(later.length).toBeGreaterThanOrEqual(2);
      expect(later.every((c: any) => c.throttled === true)).toBe(true);
      expect(later.some((c: any) => c.value === 100)).toBe(true);
    });

    it("realistic cadence (change every 16ms, tick every 250ms, 3 min) -> viewer treats it as noisy", () => {
      h = newGame();
      let v = 0;
      for (let f = 0; f < 11_250; f++) { // 3 minutes at 16ms
        h.g.$gameVariables.setValue(1, ++v);
        h.g.$gameSwitches.setValue(2, f % 2 === 0);
        h.clock.t += 16;
        if (f % 16 === 15) h.bridge._tick(); // ~250ms
      }
      h.bridge._tick();
      const log = h.readLog();
      const noisy = noisyVariables(log);
      expect(noisy.has(1)).toBe(true);
      const sw = log.filter((r) => r.type === "state").flatMap((r) => r.changes).filter((c: any) => c.kind === "switch");
      expect(sw.length).toBeGreaterThan(0);
      expect(sw.every((c: any) => c.throttled === undefined)).toBe(true);
    });

    const throttle = () => {
      for (let i = 1; i <= 40; i++) { h.g.$gameVariables.setValue(1, i); h.bridge._tick(); h.clock.t += 16; }
      h.g.$gameVariables.setValue(1, 999); // held back
    };

    it("writes held-back values before the save stamp's seq", async () => {
      h = newGame();
      throttle();
      await h.g.DataManager.saveGame(1);
      const rec = h.readLog().find((r) => r.type === "state" && r.changes.some((c: any) => c.value === 999));
      expect(rec).toBeDefined();
      expect(rec.seq).toBeLessThanOrEqual(h.saves[1].rpgViewer.seq);
    });

    it("writes held-back values before the next branchStart", async () => {
      h = newGame();
      await h.g.DataManager.saveGame(1);
      say(h);
      throttle();
      h.g.DataManager.setupNewGame();
      let log = h.readLog();
      let idx = log.findIndex((r) => r.type === "state" && r.changes.some((c: any) => c.value === 999));
      expect(idx).toBeGreaterThan(0);
      expect(log[idx].branch).toBe(1);
      expect(log[idx + 1]).toMatchObject({ type: "branchStart", reason: "newGame" });
      h.clock.t += 20;
      throttle();
      await h.g.DataManager.loadGame(1);
      log = h.readLog();
      idx = log.map((r) => r.type === "state" && r.changes.some((c: any) => c.value === 999)).lastIndexOf(true);
      expect(log[idx + 1]).toMatchObject({ type: "branchStart", reason: "load" });
    });

    it("emits the pending latest value once 10s passed, and releases when slow", () => {
      h = newGame();
      for (let i = 1; i <= 40; i++) { h.g.$gameVariables.setValue(1, i); h.bridge._tick(); h.clock.t += 16; }
      h.clock.t += 1000;
      h.g.$gameVariables.setValue(1, 100); // throttled (last emit < 10s ago)
      h.bridge._tick();
      expect(varChanges(h.readLog(), 1).some((c: any) => c.value === 100)).toBe(false);
      h.clock.t += 10_000;
      h.bridge._tick();
      expect(varChanges(h.readLog(), 1).some((c: any) => c.value === 100)).toBe(true);
      // slow changes: window count drops to <= 30 -> every change recorded again
      h.clock.t += 61_000;
      const before = varChanges(h.readLog(), 1).length;
      for (let i = 0; i < 5; i++) { h.g.$gameVariables.setValue(1, 200 + i); h.bridge._tick(); h.clock.t += 1000; }
      expect(varChanges(h.readLog(), 1).length).toBe(before + 5);
    });
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
    h.g.BattleManager._escaped = true;
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
      say(h);
      h.clock.t += 5000;
      const loaded = await h.g.DataManager.loadGame(1);
      expect(loaded).toBe(engine === "MZ" ? 0 : true);
      const log = h.readLog();
      expect(types(log)).toEqual(["branchStart", "state", "save", "message", "branchStart", "load"]);
      expect(log[2]).toMatchObject({ seq: 3, run: 1, branch: 1, slot: 1 });
      expect(log[4]).toEqual({
        v: 1, seq: 5, t: 1_005_000, run: 1, branch: 2, type: "branchStart", reason: "load", parentBranch: 1, fromSeq: 2,
      });
      expect(log[5]).toMatchObject({ seq: 6, run: 1, branch: 2, type: "load", slot: 1 });
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
    expect(JSON.parse(h.fs.readFileSync(META_PATH))).toEqual({ nextRun: 2, nextBranch: 2, nextSeq: 3, lastStory: { "1": { run: 1, seq: 0 } } });
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

  it("starting with a stale meta.json never reuses seqs from the log tail", () => {
    h = newGame();
    h.g.$gameVariables.setValue(1, 1);
    h.readLog();
    const fs = h.fs;
    const last = h.readLog().at(-1).seq;
    fs.files.set(META_PATH, JSON.stringify({ nextRun: 1, nextBranch: 1, nextSeq: 1 }));
    h = newGame("MZ", fs);
    const log = h.readLog();
    const seqs = log.map((r) => r.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(log.at(-1)).toMatchObject({ run: 2, branch: 2 });
    expect(log.at(-1).seq).toBeGreaterThan(last);
  });

  it("only reads the tail of a large log and ignores the cut first line", () => {
    const fs = new MemFs();
    fs.dirs.add("/game/www/rpg-viewer");
    const filler = Array.from({ length: 4000 }, (_, i) => JSON.stringify({ v: 1, seq: i + 1, run: 1, branch: 1, type: "state", pad: "x".repeat(30) }));
    filler.push(JSON.stringify({ v: 1, seq: 5000, run: 3, branch: 4, type: "state" }));
    fs.files.set(LOG_PATH, filler.join("\n") + "\n");
    fs.files.set(META_PATH, JSON.stringify({ nextRun: 1, nextBranch: 1, nextSeq: 1 }));
    h = newGame("MZ", fs);
    const rec = h.readLog().at(-1);
    expect(rec.seq).toBe(5001);
    expect(rec).toMatchObject({ run: 4, branch: 5 });
  });

  describe("fd tail read", () => {
    class FdFs extends MemFs {
      reads: { len: number; pos: number }[] = [];
      closed = 0;
      failRead = false;
      statSync(p: string) { return { size: Buffer.byteLength(this.readFileSync(p)) }; }
      openSync(p: string) { this.readFileSync(p); return 7; }
      readSync(_fd: number, buf: Buffer, off: number, len: number, pos: number) {
        this.reads.push({ len, pos });
        if (this.failRead) throw new Error("EIO");
        Buffer.from(this.readFileSync(LOG_PATH)).copy(buf, off, pos, pos + len);
        return len;
      }
      closeSync() { this.closed++; }
    }
    const bigLog = () => {
      const lines = Array.from({ length: 4000 }, (_, i) => JSON.stringify({ v: 1, seq: i + 1, run: 1, branch: 1, type: "state", pad: "한".repeat(5) }));
      lines.push(JSON.stringify({ v: 1, seq: 5000, run: 3, branch: 4, type: "state" }));
      return lines.join("\n") + "\n";
    };

    it("reads only the last 64KB, drops the cut first line, closes the fd", () => {
      const fs = new FdFs();
      fs.dirs.add("/game/www/rpg-viewer");
      const text = bigLog();
      fs.files.set(LOG_PATH, text);
      fs.files.set(META_PATH, JSON.stringify({ nextRun: 1, nextBranch: 1, nextSeq: 1 }));
      const size = Buffer.byteLength(text);
      h = newGame("MZ", fs);
      expect(fs.reads).toEqual([{ len: 65536, pos: size - 65536 }]);
      expect(fs.closed).toBe(1);
      expect(h.readLog().at(-1)).toMatchObject({ seq: 5001, run: 4, branch: 5 });
    });

    it("meta.json missing + large log: only the tail is read and counters recover", () => {
      const fs = new FdFs();
      fs.dirs.add("/game/www/rpg-viewer");
      const text = bigLog();
      fs.files.set(LOG_PATH, text);
      const spy = vi.spyOn(fs, "readFileSync");
      h = newGame("MZ", fs);
      expect(fs.reads).toEqual([{ len: 65536, pos: Buffer.byteLength(text) - 65536 }]);
      expect(spy.mock.calls.filter((c) => c[0] === LOG_PATH).length).toBeLessThanOrEqual(3); // stat/open helpers + fake readSync
      expect(h.readLog().at(-1)).toMatchObject({ seq: 5001, run: 4, branch: 5 });
    });

    it("handles a short read by decoding only the bytes read", () => {
      const fs = new FdFs();
      fs.dirs.add("/game/www/rpg-viewer");
      fs.files.set(LOG_PATH, bigLog());
      fs.readSync = function (_fd: number, buf: Buffer, off: number, len: number, pos: number) {
        this.reads.push({ len, pos });
        const n = len - 200; // last 200 bytes "not read"; the rest of buf stays uninitialised-looking junk
        buf.fill(0x7a);
        Buffer.from(this.readFileSync(LOG_PATH)).copy(buf, off, pos, pos + n);
        return n;
      };
      h = newGame("MZ", fs);
      const rec = h.readLog().at(-1);
      expect(rec.seq).toBeGreaterThan(3500); // recovered from the lines that were read
      expect(rec.seq).toBeLessThanOrEqual(5001);
    });

    it("closes the fd when readSync throws and does not read the whole log", () => {
      const fs = new FdFs();
      fs.dirs.add("/game/www/rpg-viewer");
      fs.files.set(LOG_PATH, bigLog());
      fs.files.set(META_PATH, JSON.stringify({ nextRun: 1, nextBranch: 1, nextSeq: 1 }));
      fs.failRead = true;
      const spy = vi.spyOn(fs, "readFileSync");
      h = newGame("MZ", fs);
      expect(fs.closed).toBe(1);
      const logReads = spy.mock.calls.filter((c) => c[0] === LOG_PATH).length;
      expect(logReads).toBeLessThanOrEqual(2); // statSync/openSync helpers only, no readFileSync of the log by the plugin
      expect(h.g.$gameMap).toBeDefined();
    });
  });

  describe("continue vs new branch on load", () => {
    it("save -> only state records -> load keeps the branch (no branchStart)", async () => {
      h = newGame();
      h.g.$gameSwitches.setValue(1, true);
      await h.g.DataManager.saveGame(1);
      h.g.$gameSwitches.setValue(2, true);
      await h.g.DataManager.loadGame(1);
      const log = h.readLog();
      expect(types(log)).toEqual(["branchStart", "state", "save", "state", "load"]);
      expect(log.at(-1)).toMatchObject({ type: "load", run: 1, branch: 1 });
    });

    it("save -> message -> load starts a new branch", async () => {
      h = newGame();
      await h.g.DataManager.saveGame(1);
      say(h);
      await h.g.DataManager.loadGame(1);
      const log = h.readLog();
      expect(log.filter((r) => r.type === "branchStart")).toHaveLength(2);
      expect(log.at(-2)).toMatchObject({ type: "branchStart", reason: "load", parentBranch: 1 });
    });

    it("persists lastStory across a restart (resume after quit and continue)", async () => {
      h = newGame();
      say(h);
      await h.g.DataManager.saveGame(1);
      const stamp = h.saves[1];
      h.bridge._tick();
      expect(JSON.parse(h.fs.readFileSync(META_PATH)).lastStory).toEqual({ "1": { run: 1, seq: 2 } });
      const fs = h.fs;
      h = newGame("MZ", fs); // restart + a new game (branch 2) before continuing
      h.saves[1] = stamp;
      await h.g.DataManager.loadGame(1);
      const log = h.readLog();
      expect(log.filter((r) => r.type === "branchStart")).toHaveLength(2); // 1 old + the restart's newGame
      expect(log.at(-1).branch).toBe(1);
    });

    it("recovers lastStory from the log tail when meta.json lacks it; unknown -> new branch", () => {
      h = newGame();
      say(h);
      const fs = h.fs;
      h.bridge._flushNow();
      fs.files.set(META_PATH, JSON.stringify({ nextRun: 1, nextBranch: 1, nextSeq: 1 })); // no lastStory
      h = newGame("MZ", fs);
      const nb = h.readLog().filter((r) => r.type === "branchStart").length;
      h.g.DataManager.extractSaveContents({ rpgViewer: { run: 1, branch: 1, seq: 5 } }); // story seq 2 <= 5: resume
      expect(h.readLog().filter((r) => r.type === "branchStart")).toHaveLength(nb);
      h.g.DataManager.extractSaveContents({ rpgViewer: { run: 1, branch: 1, seq: 1 } }); // story after stamp: new branch
      expect(h.readLog().filter((r) => r.type === "branchStart")).toHaveLength(nb + 1);
      h.g.DataManager.extractSaveContents({ rpgViewer: { run: 1, branch: 77, seq: 5 } }); // never seen: safe default
      expect(h.readLog().filter((r) => r.type === "branchStart")).toHaveLength(nb + 2);
    });

    it("continues the branch when run and seq match (no branchStart)", () => {
      h = newGame();
      say(h);
      h.bridge._flushNow();
      const nb = h.readLog().filter((r) => r.type === "branchStart").length;
      h.g.DataManager.extractSaveContents({ rpgViewer: { run: 1, branch: 1, seq: 5 } });
      expect(h.readLog().filter((r) => r.type === "branchStart")).toHaveLength(nb);
    });

    it("starts a new branch when the branch id exists with a different run", () => {
      h = newGame();
      say(h);
      h.bridge._flushNow();
      const nb = h.readLog().filter((r) => r.type === "branchStart").length;
      h.g.DataManager.extractSaveContents({ rpgViewer: { run: 9, branch: 1, seq: 5 } });
      expect(h.readLog().filter((r) => r.type === "branchStart")).toHaveLength(nb + 1);
    });

    it("treats a legacy numeric lastStory entry by the seq rule only", () => {
      h = newGame();
      const fs = h.fs;
      fs.files.set(META_PATH, JSON.stringify({ nextRun: 2, nextBranch: 2, nextSeq: 10, lastStory: { "1": 2 } }));
      fs.files.set(LOG_PATH, "");
      h = newGame("MZ", fs);
      const nb = h.readLog().filter((r) => r.type === "branchStart").length;
      h.g.DataManager.extractSaveContents({ rpgViewer: { run: 42, branch: 1, seq: 5 } }); // run unknown: 2 <= 5 resumes
      expect(h.readLog().filter((r) => r.type === "branchStart")).toHaveLength(nb);
      h.g.DataManager.extractSaveContents({ rpgViewer: { run: 42, branch: 1, seq: 1 } }); // 2 > 1: new branch
      expect(h.readLog().filter((r) => r.type === "branchStart")).toHaveLength(nb + 1);
    });

    it("rebuilds lastStory with run from the log tail", () => {
      h = newGame();
      say(h);
      const fs = h.fs;
      h.bridge._flushNow();
      fs.files.set(META_PATH, JSON.stringify({ nextRun: 1, nextBranch: 1, nextSeq: 1 }));
      h = newGame("MZ", fs);
      h.bridge._tick();
      expect(JSON.parse(h.fs.readFileSync(META_PATH)).lastStory["1"]).toEqual({ run: 1, seq: 2 });
    });

    it("keeps at most 200 branches in lastStory", () => {
      h = newGame();
      for (let i = 0; i < 230; i++) h.g.DataManager.extractSaveContents({});
      h.bridge._tick();
      expect(Object.keys(JSON.parse(h.fs.readFileSync(META_PATH)).lastStory)).toHaveLength(200);
    });
  });

  describe("plugin commands", () => {
    const plugins = (log: any[]) => log.filter((r) => r.type === "plugin");
    const runList = (hh: Harness, list: any[], eventId = 5, index = 0) => {
      const interp = hh.g.$gameMap._interpreter;
      interp.setup(list, eventId);
      hh.runCommand(interp, index);
      return interp;
    };

    it("records a 356 plugin command with src, cmd and trimmed text (MV)", () => {
      h = newGame("MV");
      const list = [cmd(0), cmd(356, ["  ShowExamine door 3  "]), cmd(0)];
      h.addMapEvent(5, [[cmd(0)], list], 1);
      const interp = runList(h, list, 5, 1);
      expect(interp.pluginCalls).toBe(1); // original still ran
      expect(plugins(h.readLog())).toEqual([{
        v: 1, seq: 2, t: 1_000_000, run: 1, branch: 1, type: "plugin",
        src: { source: "map", mapId: 1, eventId: 5, page: 1 }, cmd: 1, code: 356, text: "ShowExamine door 3",
        name: "ShowExamine", args: ["door", "3"],
      }]);
    });

    it("caps 356 text at 500 characters", () => {
      h = newGame("MV");
      const list = [cmd(356, ["x".repeat(800)]), cmd(0)];
      h.addMapEvent(5, [list]);
      runList(h, list);
      expect(plugins(h.readLog())[0].text).toHaveLength(500);
    });

    it("records a 357 plugin command as plugin, command and string args (MZ)", () => {
      h = newGame("MZ");
      const args = { text: "A note on the desk", id: 3, empty: "", n: "2" };
      const list = [cmd(357, ["TextPlugin", "show", "Show text", args]), cmd(0)];
      h.g.$dataCommonEvents[2] = { id: 2, trigger: 0, list };
      const interp = h.newInterpreter();
      interp.setup(list, 0);
      h.runCommand(interp, 0);
      expect(interp.pluginCalls).toBe(1);
      expect(plugins(h.readLog())).toEqual([expect.objectContaining({
        src: { source: "common", commonEventId: 2 }, cmd: 0, code: 357, text: "TextPlugin show A note on the desk 2",
        plugin: "TextPlugin", name: "show", args: { text: "A note on the desk", id: 3, empty: "", n: "2" },
      })]);
    });

    it("caps 357 text at 500 characters", () => {
      h = newGame("MZ");
      const list = [cmd(357, ["P", "c", "", { a: "y".repeat(400), b: "z".repeat(400) }]), cmd(0)];
      h.addMapEvent(5, [list]);
      runList(h, list);
      expect(plugins(h.readLog())[0].text).toHaveLength(500);
    });

    it("records under the innermost (common event) source when called from an event", () => {
      h = newGame("MZ");
      const ceList = [cmd(357, ["P", "c", "", {}]), cmd(0)];
      h.g.$dataCommonEvents[1] = { id: 1, trigger: 0, list: ceList };
      const list = [cmd(117, [1]), cmd(0)];
      h.addMapEvent(2, [list]);
      const interp = runList(h, list, 2);
      h.runCommand(interp._childInterpreter, 0);
      expect(plugins(h.readLog())).toEqual([
        expect.objectContaining({ src: { source: "common", commonEventId: 1 }, cmd: 0, code: 357, text: "P c" }),
      ]);
    });

    it("records a TemplateEvent original page's plugin command with the origin source", () => {
      h = newGame("MV");
      const original = [cmd(356, ["TMng Search 종이 상자"]), cmd(0)];
      const tplP1 = [cmd(356, ["TE固有イベント呼び出し"]), cmd(0)];
      const ev = h.addMapEvent(5, [[cmd(0)], tplP1], 1);
      ev.getOriginalPages = () => [{ list: [cmd(0)] }, { list: original }];
      const interp = runList(h, tplP1, 5, 0);
      interp.setupChild(original, 5);
      h.runCommand(interp._childInterpreter, 0);
      expect(plugins(h.readLog())).toEqual([
        expect.objectContaining({ src: { source: "map", mapId: 1, eventId: 5, page: 1 }, cmd: 0, text: "TE固有イベント呼び出し" }),
        expect.objectContaining({ src: { source: "map", mapId: 1, eventId: 5, page: 1, origin: 1 }, cmd: 0, text: "TMng Search 종이 상자" }),
      ]);
    });

    it("skips parallel map events and parallel common events (and their children)", () => {
      h = newGame("MV");
      const list = [cmd(356, ["Par"]), cmd(117, [1]), cmd(0)];
      const ev = h.addMapEvent(4, [list]);
      ev._trigger = 4;
      ev._interpreter = h.newInterpreter();
      ev._interpreter.setup(list, 4);
      h.runCommand(ev._interpreter, 0);
      const ceList = [cmd(356, ["ParCE"]), cmd(0)];
      h.g.$dataCommonEvents[1] = { id: 1, trigger: 2, list: ceList };
      h.runCommand(ev._interpreter, 1); // common event called by a parallel event
      h.runCommand(ev._interpreter._childInterpreter, 0);
      const ce = { _interpreter: h.newInterpreter() };
      h.g.$gameMap._commonEvents = [ce];
      ce._interpreter.setup(ceList, 0);
      h.runCommand(ce._interpreter, 0);
      expect(plugins(h.readLog())).toEqual([]);
      // the same list run by the map interpreter (autorun / player-started) is recorded
      runList(h, list, 4);
      expect(plugins(h.readLog())).toEqual([expect.objectContaining({ cmd: 0, text: "Par" })]);
    });

    it("records a src+cmd once per interpreter run and once per 2 s", () => {
      h = newGame("MV");
      const list = [cmd(356, ["Look"]), cmd(0)];
      h.addMapEvent(5, [list]);
      const interp = runList(h, list);
      h.clock.t += 3000;
      h.runCommand(interp, 0); // same run (a loop): not again
      expect(plugins(h.readLog())).toHaveLength(1);
      runList(h, list); // new run, 3 s after the record
      expect(plugins(h.readLog())).toHaveLength(2);
      h.clock.t += 1000;
      runList(h, list); // new run 1 s later: within 2 s
      expect(plugins(h.readLog())).toHaveLength(2);
      h.clock.t += 1000;
      runList(h, list);
      expect(plugins(h.readLog())).toHaveLength(3);
    });

    it("records at most 20 plugin commands per second", () => {
      h = newGame("MV");
      const list: any[] = [];
      for (let i = 0; i < 30; i++) list.push(cmd(356, ["C" + i]));
      list.push(cmd(0));
      h.addMapEvent(5, [list]);
      const interp = h.g.$gameMap._interpreter;
      interp.setup(list, 5);
      for (let i = 0; i < 30; i++) h.runCommand(interp, i);
      expect(interp.pluginCalls).toBe(30);
      expect(plugins(h.readLog()).map((r) => r.cmd)).toEqual([...Array(20).keys()]);
      h.clock.t += 1000;
      for (let i = 0; i < 30; i++) h.runCommand(interp, i); // dropped ones were not marked seen
      expect(plugins(h.readLog())).toHaveLength(30);
    });

    it("is not a story record: a plugin record after a save does not force a new branch on load", async () => {
      h = newGame("MV");
      await h.g.DataManager.saveGame(1);
      const list = [cmd(356, ["Look"]), cmd(0)];
      h.addMapEvent(5, [list]);
      runList(h, list);
      await h.g.DataManager.loadGame(1);
      const log = h.readLog();
      expect(types(log)).toEqual(["branchStart", "save", "plugin", "load"]);
      expect(log.at(-1)).toMatchObject({ run: 1, branch: 1 });
    });
  });

  it("writes meta.json on the tick, not on scheduled flushes", () => {
    h = newGame();
    h.bridge._tick();
    const metaWrites: string[] = [];
    const orig = h.fs.writeFileSync.bind(h.fs);
    h.fs.writeFileSync = (p: string, d: string) => { if (p === META_PATH) metaWrites.push(d); orig(p, d); };
    h.clock.t += 100;
    h.g.$gamePlayer.reserveTransfer(1, 5, 6);
    h.g.$gamePlayer.performTransfer();
    h.bridge._runScheduled();
    expect(metaWrites).toHaveLength(0);
    h.bridge._tick();
    expect(metaWrites).toHaveLength(1);
    h.bridge._tick();
    expect(metaWrites).toHaveLength(1); // unchanged -> no rewrite
  });

  it("reports runningCmd from the innermost interpreter", () => {
    h = newGame();
    h.g.$dataCommonEvents[1] = { id: 1, list: [cmd(121, [5, 5, 0]), cmd(121, [6, 6, 0]), cmd(0)] };
    const list = [cmd(121, [1, 1, 0]), cmd(117, [1]), cmd(0)];
    h.addMapEvent(1, [list]);
    h.g.$gamePlayer.performTransfer();
    h.bridge._snapshotNow();
    expect(h.readLive()).toMatchObject({ running: null, runningCmd: null });
    const interp = h.g.$gameMap._interpreter;
    interp.setup(list, 1);
    interp._index = 1;
    h.bridge._snapshotNow();
    expect(h.readLive()).toMatchObject({ running: { source: "map", mapId: 1, eventId: 1, page: 0 }, runningCmd: 1 });
    h.runCommand(interp, 1);
    interp._childInterpreter._index = 1;
    h.bridge._snapshotNow();
    expect(h.readLive()).toMatchObject({ running: { source: "common", commonEventId: 1 }, runningCmd: 1 });
  });

  it("reports the innermost of common events nested two levels deep", () => {
    h = newGame();
    h.g.$dataCommonEvents[2] = { id: 2, list: [cmd(121, [7, 7, 0]), cmd(121, [8, 8, 0]), cmd(121, [9, 9, 0]), cmd(0)] };
    h.g.$dataCommonEvents[1] = { id: 1, list: [cmd(121, [5, 5, 0]), cmd(117, [2]), cmd(0)] };
    const list = [cmd(121, [1, 1, 0]), cmd(117, [1]), cmd(0)];
    h.addMapEvent(1, [list]);
    h.g.$gamePlayer.performTransfer();
    const interp = h.g.$gameMap._interpreter;
    interp.setup(list, 1);
    h.runCommand(interp, 1);                 // map → CE1
    const ce1 = interp._childInterpreter;
    h.runCommand(ce1, 1);                    // CE1 → CE2
    const ce2 = ce1._childInterpreter;
    ce2._index = 2;
    h.bridge._snapshotNow();
    expect(h.readLive()).toMatchObject({ running: { source: "common", commonEventId: 2 }, runningCmd: 2 });
  });

  it("a finished child still attached reports the parent", () => {
    h = newGame();
    h.g.$dataCommonEvents[1] = { id: 1, list: [cmd(121, [5, 5, 0]), cmd(0)] };
    const list = [cmd(121, [1, 1, 0]), cmd(117, [1]), cmd(121, [2, 2, 0]), cmd(0)];
    h.addMapEvent(1, [list]);
    h.g.$gamePlayer.performTransfer();
    const interp = h.g.$gameMap._interpreter;
    interp.setup(list, 1);
    h.runCommand(interp, 1);                 // _index → 2, child attached
    const child = interp._childInterpreter;
    child._list = null;                      // child finished, not yet detached
    h.bridge._snapshotNow();
    expect(interp._childInterpreter).toBe(child);
    expect(h.readLive()).toMatchObject({ running: { source: "map", mapId: 1, eventId: 1, page: 0 }, runningCmd: 2 });
  });

  it("in battle, running is the troop page source", () => {
    h = newGame();
    h.g.$gamePlayer.performTransfer();
    const list = [cmd(121, [1, 1, 0]), cmd(121, [2, 2, 0]), cmd(0)];
    h.g.$dataTroops[4] = { id: 4, pages: [{ list: [] }, { list }] };
    h.g.$gameTroop._troopId = 4;
    h.g.$gameParty._inBattle = true;
    const troopInterp = h.g.$gameTroop._interpreter;
    troopInterp.setup(list, 0);
    h.runCommand(troopInterp, 0);
    h.bridge._snapshotNow();
    expect(h.readLive()).toMatchObject({ running: { source: "troop", troopId: 4, page: 1 }, runningCmd: 1, inBattle: true });
  });

  it("follows the troop interpreter in battle", () => {
    h = newGame();
    h.g.$gamePlayer.performTransfer();
    h.g.$gameParty._inBattle = true;
    h.g.$gameTroop._interpreter.setup([cmd(121, [1, 1, 0]), cmd(0)], 0);
    h.g.$gameTroop._interpreter._index = 1;
    h.bridge._snapshotNow();
    expect(h.readLive()).toMatchObject({ runningCmd: 1, inBattle: true });
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
      v: 1, t: 1_000_000, pluginVersion: "1.20.1", run: 1, branch: 1, seq: 4,
      mapId: 1, x: 3, y: 4, running: src, runningCmd: 1,
      events: [{ eventId: 1, page: 0 }, { eventId: 2, page: -1 }],
      switches: [3], variables: { 4: 9 }, selfSwitches: ["1,2,B"],
      items: { 1: 2 }, weapons: { 3: 1 }, armors: {}, gold: 120, party: [1, 4],
      choice: { src, cmd: 0, options: ["Go", "Stay"] }, inBattle: false,
      assist: {
        speed: 1, effectiveSpeed: 1, skipSeen: false, troopId: null, canEscape: false, canLose: false,
        lastCommand: null, controlT: null, capturePictures: false, captureMenuScenes: false, captureNotices: false, notices: [], htmlNotices: false, extensions: [],
        hotkeys: { speed: 117, skip: 118, win: 121, lose: 122, hpFull: 36, hpLow: 35 },
      },
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

  it("reports live event positions and direction, and rewrites live.json when an event moves", () => {
    h = newGame();
    const ev = h.addMapEvent(1, [[cmd(0)]]);
    Object.assign(ev, { x: 5, y: 6, _direction: 4 });
    h.bridge._snapshotNow();
    expect(h.readLive().events).toEqual([{ eventId: 1, page: 0, x: 5, y: 6, d: 4 }]);
    ev.x = 7; // only the NPC moves
    h.clock.t += 1000;
    h.bridge._tick();
    expect(h.readLive().events).toEqual([{ eventId: 1, page: 0, x: 7, y: 6, d: 4 }]);
  });

  it("marks events spawned at runtime with their source (1.16.0): EventReSpawn fields, identity lookup, template", () => {
    h = newGame();
    const g = h.g;
    const ev1 = h.addMapEvent(1, [[cmd(0)]]);
    const ev2 = h.addMapEvent(2, [[cmd(0)]]);
    const tplEvent = { id: 3, name: "TplEnemy", pages: [{ list: [cmd(0)] }] };
    g.$dataTemplateEvents = [null, null, null, tplEvent];
    g.$dataMap = { events: [null, ev1._data, ev2._data] };
    // TemplateEvent swaps event() of a map event: still an event of the map data
    ev2._data = tplEvent;
    // EventReSpawn Game_PrefabEvent: event() is $dataMap.events[originalEventId]
    const prefab = h.addMapEvent(6, [[cmd(0)]]);
    Object.assign(prefab, { _originalEventId: 1, _isTemplate: false, _data: g.$dataMap.events[1], x: 4, y: 5 });
    const prefabTpl = h.addMapEvent(7, [[cmd(0)]]);
    Object.assign(prefabTpl, { _originalEventId: 3, _isTemplate: true, _data: tplEvent });
    // another spawn plugin: no fields, event() is the data object of event 1 / a template event / unknown
    const copy = h.addMapEvent(8, [[cmd(0)]]);
    copy._data = g.$dataMap.events[1];
    const copyTpl = h.addMapEvent(9, [[cmd(0)]]);
    copyTpl._data = tplEvent;
    const unknown = h.addMapEvent(10, [[cmd(0)]]);
    unknown._data = { id: 1, name: "Mystery", pages: [{ list: [cmd(0)] }] };
    h.bridge._snapshotNow();
    const byId = new Map(h.readLive().events.map((e: any) => [e.eventId, e]));
    expect(byId.get(1)).toEqual({ eventId: 1, page: 0 });
    expect(byId.get(2)).toEqual({ eventId: 2, page: 0 });
    expect(byId.get(6)).toEqual({ eventId: 6, page: 0, x: 4, y: 5, spawn: { from: 1, tpl: false } });
    expect(byId.get(7)).toMatchObject({ spawn: { from: 3, tpl: true } });
    expect(byId.get(8)).toMatchObject({ spawn: { from: 1, tpl: false } });
    expect(byId.get(9)).toMatchObject({ spawn: { from: 3, tpl: true } });
    expect(byId.get(10)).toMatchObject({ spawn: { name: "Mystery" } });
    delete g.$dataMap;
    delete g.$dataTemplateEvents;
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

  it("flushes dialogue records at the end of the frame, once per frame", () => {
    h = newGame();
    const raw = () => h.fs.files.get(LOG_PATH) ?? "";
    const list = [cmd(101, ["", 0, 0, 2, ""]), cmd(401, ["hi"]), cmd(0)];
    h.addMapEvent(3, [list], 0);
    const interp = h.g.$gameMap._interpreter;
    interp.setup(list, 3);
    h.runCommand(interp, 0);
    expect(raw()).not.toContain('"type":"message"'); // not before the frame ends
    h.bridge._runScheduled();
    expect(raw()).toContain('"type":"message"');
    const before = raw();
    h.bridge._runScheduled(); // nothing scheduled -> no-op
    expect(raw()).toBe(before);
  });

  it("writes live.json at once when runningCmd changes, keeps the floor otherwise", () => {
    h = newGame();
    h.bridge._tick();
    const live = () => JSON.parse(h.fs.files.get(LIVE_PATH)!);
    h.clock.t += 10;
    h.g.$gameSwitches.setValue(8, true);
    h.bridge._tick();
    expect(live().t).toBe(1_000_000); // other change: still floored
    const list = [cmd(121, [1, 1, 0]), cmd(0)];
    h.addMapEvent(1, [list]);
    h.g.$gameMap._interpreter.setup(list, 1);
    h.g.$gameMap._interpreter._index = 1;
    h.clock.t += 10;
    h.bridge._tick();
    expect(live()).toMatchObject({ t: 1_000_020, runningCmd: 1 });
    h.clock.t += 10;
    h.g.$gameMap._interpreter._index = 0;
    h.bridge._tick();
    expect(live()).toMatchObject({ t: 1_000_030, runningCmd: 0 });
  });

  it("coalesces scheduled flushes: one append per frame, 50ms minimum gap, seq order kept", () => {
    h = newGame();
    const raw = () => h.fs.files.get(LOG_PATH) ?? "";
    const lines = () => raw().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    h.bridge._flushNow();
    h.clock.t += 100;
    const append = vi.spyOn(h.fs, "appendFileSync");
    h.g.$gameSwitches.setValue(5, true); // state change before the message
    const list = [cmd(101, ["", 0, 0, 2, ""]), cmd(401, ["a"]), cmd(101, ["", 0, 0, 2, ""]), cmd(401, ["b"]), cmd(0)];
    h.addMapEvent(3, [list], 0);
    const interp = h.g.$gameMap._interpreter;
    interp.setup(list, 3);
    h.runCommand(interp, 0);
    h.g.$gameMessage._texts = []; // free the window for the second message
    h.runCommand(interp, 2);
    h.bridge._runScheduled();
    expect(append).toHaveBeenCalledTimes(1);
    const recs = lines();
    const st = recs.find((r) => r.type === "state");
    const msg = recs.find((r) => r.type === "message");
    expect(st).toBeDefined();
    expect(st.seq).toBeLessThan(msg.seq);
    h.bridge._tick();
    expect(JSON.parse(h.fs.files.get(META_PATH)!).nextSeq).toBeGreaterThan(msg.seq);
    // a new message within 50ms of the flush stays pending until the gap passes
    h.clock.t += 10;
    h.g.$gamePlayer.reserveTransfer(1, 5, 6);
    h.g.$gamePlayer.performTransfer();
    h.bridge._runScheduled();
    expect(append).toHaveBeenCalledTimes(1);
    h.clock.t += 40;
    h.bridge._runScheduled();
    expect(append).toHaveBeenCalledTimes(2);
  });

  describe("game assist", () => {
    const CONTROL_PATH = "/game/www/rpg-viewer/control.json";
    const writeControl = (hh: Harness, c: Record<string, unknown>) => {
      hh.fs.dirs.add("/game/www/rpg-viewer");
      hh.fs.writeFileSync(CONTROL_PATH, JSON.stringify({ v: 1, t: hh.clock.t, ...c }));
    };
    const poll = (hh: Harness) => { hh.clock.t += 1000; hh.bridge._tick(); };
    const assistOf = (hh: Harness) => { hh.bridge._snapshotNow(); return hh.readLive().assist; };
    const onMap = (hh: Harness) => { hh.g.SceneManager._scene = new hh.g.Scene_Map(); };
    const battler = (hh: Harness) => new hh.g.Game_Battler();
    const startBattle = (hh: Harness, phase = "input") => {
      hh.g.BattleManager.setup(4);
      hh.g.BattleManager._phase = phase;
      hh.g.SceneManager._scene = new hh.g.Scene_Battle();
      hh.g.$gameTroop._enemies = [battler(hh), battler(hh)];
      hh.g.$gameParty._battlers = [battler(hh), battler(hh)];
    };
    // run event 3 page 0 of map 1 until its message at cmd `at` is set up
    const showMessage = (hh: Harness, list: any[], at: number) => {
      if (!hh.g.$gameMap.event(3)) hh.addMapEvent(3, [list], 0);
      const interp = hh.g.$gameMap._interpreter;
      interp.setup(list, 3);
      hh.g.$gameMessage.clear();
      hh.runCommand(interp, at);
      return interp;
    };
    const pressOkCount = (w: any, frames: number) => { for (let i = 0; i < frames; i++) w.updateInput(); return w.advanced; };

    it("polls control.json at most once per second, re-reads on mtime change, ignores bad input", () => {
      h = newGame();
      onMap(h);
      writeControl(h, { speed: 4 });
      h.bridge._tick();
      expect(h.bridge._frame()).toBe(4);
      writeControl(h, { speed: 2 });
      h.clock.t += 500;
      h.bridge._tick();
      expect(h.bridge._frame()).toBe(4); // within the 1s poll gap
      poll(h);
      expect(h.bridge._frame()).toBe(2);
      const reads = vi.spyOn(h.fs, "readFileSync");
      poll(h);
      expect(reads.mock.calls.filter((c) => c[0] === CONTROL_PATH)).toHaveLength(0); // mtime unchanged
      h.fs.writeFileSync(CONTROL_PATH, "{\"v\":1,\"speed\":8"); // half-written
      poll(h);
      writeControl(h, { speed: 3, skipSeen: "yes" });
      poll(h);
      writeControl(h, { v: 2, speed: 8 });
      poll(h);
      expect(h.bridge._frame()).toBe(2);
      expect(assistOf(h)).toMatchObject({ speed: 2, effectiveSpeed: 2, skipSeen: false });
    });

    it("updates the scene speed times per frame on the map, once in menus or during a scene change", () => {
      h = newGame();
      onMap(h);
      const sm = h.g.SceneManager;
      writeControl(h, { speed: 4 });
      h.bridge._tick();
      sm.updateScene();
      expect(sm.sceneUpdates).toBe(4);
      expect(h.g.Input.updates).toBe(3); // a key press is seen by the first update only
      sm._scene = new h.g.Scene_Title();
      sm.updateScene();
      expect(sm.sceneUpdates).toBe(5);
      onMap(h);
      sm._nextScene = {};
      sm.updateScene();
      expect(sm.sceneUpdates).toBe(6);
      sm._nextScene = null;
      // re-entrant call: runs the original once, no extra repeats
      let nested = false;
      sm.onSceneUpdate = () => { if (!nested) { nested = true; sm.updateScene(); nested = false; } };
      sm.sceneUpdates = 0;
      sm.updateScene();
      expect(sm.sceneUpdates).toBe(8); // 4 outer updates + 4 single nested ones
    });

    it("shows a seen message fast and advances it after 6 updates; unseen messages and choices wait", () => {
      h = newGame();
      const list = [
        cmd(101, ["", 0, 0, 2, ""]), cmd(401, ["seen"]),
        cmd(101, ["", 0, 0, 2, ""]), cmd(401, ["new"]),
        cmd(101, ["", 0, 0, 2, ""]), cmd(401, ["Q?"]), cmd(102, [["A", "B"], 1, 0, 2, 0]),
        cmd(0),
      ];
      writeControl(h, { skipSeen: true, seenMessages: ["map:1:3:0#0", "map:1:3:0#4"] });
      h.bridge._tick();
      const w = new h.g.Window_Message();
      showMessage(h, list, 0);
      w.startMessage();
      expect([w._showFast, w._lineShowFast]).toEqual([true, true]);
      w.newPage(); // next page of a long message keeps the fast flags
      expect(w._showFast).toBe(true);
      w.pause = true;
      expect(pressOkCount(w, 5)).toBe(0);
      expect(pressOkCount(w, 1)).toBe(1);

      showMessage(h, list, 2); // unseen
      w.startMessage();
      expect(w._showFast).toBe(false);
      w.pause = true;
      expect(pressOkCount(w, 30)).toBe(1);

      showMessage(h, list, 4); // seen, but with a choice
      expect(h.g.$gameMessage.isChoice()).toBe(true);
      w.startMessage();
      expect(w._showFast).toBe(false);
      w.pause = true;
      expect(pressOkCount(w, 30)).toBe(1);
    });

    it("does not skip seen messages when skipSeen is off", () => {
      h = newGame();
      writeControl(h, { skipSeen: false, seenMessages: ["map:1:3:0#0"] });
      h.bridge._tick();
      const w = new h.g.Window_Message();
      showMessage(h, [cmd(101, ["", 0, 0, 2, ""]), cmd(401, ["x"]), cmd(0)], 0);
      w.startMessage();
      w.pause = true;
      expect(w._showFast).toBe(false);
      expect(pressOkCount(w, 30)).toBe(0);
    });

    it("auto speed while a fully seen event runs outside battle; never in battle (seenTroops ignored)", () => {
      h = newGame();
      onMap(h);
      writeControl(h, { speed: 2, autoFast: true, autoSpeed: 8, seenPages: ["map:1:3:0"], seenTroops: [4] });
      h.bridge._tick();
      expect(h.bridge._frame()).toBe(2); // nothing running
      const list = [cmd(121, [1, 1, 0]), cmd(0)];
      h.addMapEvent(3, [list, [cmd(121, [2, 2, 0]), cmd(0)]], 0);
      h.g.$gameMap._interpreter.setup(list, 3);
      expect(h.bridge._frame()).toBe(8);
      expect(assistOf(h)).toMatchObject({ speed: 2, effectiveSpeed: 8 });
      h.g.$gameMap._interpreter.setup(h.g.$gameMap.event(3).event().pages[1].list, 3); // page 1 not seen
      expect(h.bridge._frame()).toBe(2);
      h.g.$gameMap._interpreter.clear();
      startBattle(h);
      h.g.$gameTroop._interpreter.setup([cmd(0)], 0);
      expect(h.bridge._frame()).toBe(2);
      writeControl(h, { autoFast: false });
      poll(h);
      h.g.$gameParty._inBattle = false;
      onMap(h);
      h.g.$gameMap._interpreter.setup(list, 3);
      expect(h.bridge._frame()).toBe(2);
    });

    it("win: kills alive enemies and runs the battle end check, once per command id", () => {
      h = newGame();
      startBattle(h);
      writeControl(h, { command: { id: "c-1", kind: "win" } });
      h.bridge._tick();
      h.bridge._frame();
      expect(h.g.$gameTroop._enemies.map((e: any) => [e.isAlive(), e._collapsed])).toEqual([[false, true], [false, true]]);
      expect(h.g.BattleManager.calls).toEqual(["victory"]);
      expect(assistOf(h).lastCommand).toBe("c-1");
      startBattle(h);
      writeControl(h, { speed: 2, command: { id: "c-1", kind: "win" } }); // same command rewritten
      poll(h);
      h.bridge._frame();
      expect(h.g.BattleManager.calls).toEqual(["victory"]);
    });

    it("ignores stale commands and commands outside battle; waits while a message is open", () => {
      h = newGame();
      startBattle(h);
      writeControl(h, { t: h.clock.t - 11_000, command: { id: "old", kind: "win" } });
      h.bridge._tick();
      h.bridge._frame();
      expect(h.g.BattleManager.calls).toEqual([]);
      expect(assistOf(h).lastCommand).toBe("old:ignored");
      h.g.$gameMessage._busy = true;
      writeControl(h, { command: { id: "c-2", kind: "lose" } });
      poll(h);
      h.bridge._frame();
      expect(h.g.BattleManager.calls).toEqual([]);
      h.g.$gameMessage._busy = false;
      h.bridge._frame();
      expect(h.g.BattleManager.calls).toEqual(["defeat:0"]); // party killed first
      h.g.$gameParty._inBattle = false;
      writeControl(h, { command: { id: "c-3", kind: "win" } });
      poll(h);
      h.bridge._frame();
      expect(h.g.BattleManager.calls).toEqual(["defeat:0"]);
      expect(assistOf(h).lastCommand).toBe("c-3:ignored");
    });

    it("escape always succeeds when escaping is allowed, else is ignored; canEscape / canLose reported", () => {
      h = newGame();
      startBattle(h);
      expect(assistOf(h)).toMatchObject({ canEscape: true, canLose: false });
      writeControl(h, { command: { id: "e-1", kind: "escape" } });
      h.bridge._tick();
      h.bridge._frame();
      expect(h.g.BattleManager.calls).toEqual(["escape:1", "abort"]);
      expect(h.g.BattleManager._escapeRatio).toBe(0.5);
      expect(assistOf(h)).toMatchObject({ lastCommand: "e-1", canEscape: false, canLose: false }); // battle over
      startBattle(h);
      h.g.BattleManager._canEscape = false;
      h.g.BattleManager._canLose = true;
      expect(assistOf(h)).toMatchObject({ canEscape: false, canLose: true });
      writeControl(h, { command: { id: "e-2", kind: "escape" } });
      poll(h);
      h.bridge._frame();
      expect(h.g.BattleManager.calls).toEqual(["escape:1", "abort"]);
      expect(h.g.$gameParty.inBattle()).toBe(true);
      expect(assistOf(h).lastCommand).toBe("e-2:ignored");
    });

    it("reports a command that throws as failed", () => {
      h = newGame();
      startBattle(h);
      h.g.BattleManager.checkBattleEnd = () => { throw new Error("broken"); };
      writeControl(h, { command: { id: "f-1", kind: "win" } });
      h.bridge._tick();
      h.bridge._frame();
      expect(assistOf(h).lastCommand).toBe("f-1:failed");
    });

    it("uses the command's own issue time; never applies a command issued before the battle started", () => {
      h = newGame();
      onMap(h);
      writeControl(h, { command: { id: "a-1", kind: "win", at: h.clock.t - 11_000 } }); // file t fresh, command old
      h.bridge._tick();
      expect(assistOf(h).lastCommand).toBe("a-1:ignored");
      const issued = h.clock.t;
      h.clock.t += 2000;
      startBattle(h); // a new battle started after the command was issued
      writeControl(h, { t: h.clock.t, command: { id: "a-2", kind: "win", at: issued } });
      poll(h);
      h.bridge._frame();
      expect(h.g.BattleManager.calls).toEqual([]);
      expect(assistOf(h).lastCommand).toBe("a-2:ignored");
      writeControl(h, { command: { id: "a-3", kind: "win", at: h.clock.t } });
      poll(h);
      h.bridge._frame();
      expect(h.g.BattleManager.calls).toEqual(["victory"]);
      expect(assistOf(h).lastCommand).toBe("a-3");
    });

    it("ignores a control.json left from an earlier session; applies only later writes and echoes their t", () => {
      const fs = new MemFs();
      fs.dirs.add("/game/www/rpg-viewer");
      fs.writeFileSync(CONTROL_PATH, JSON.stringify({ v: 1, t: 5, speed: 8, skipSeen: true, command: { id: "old", kind: "win", at: 1_000_000 } }));
      h = newGame("MZ", fs);
      onMap(h);
      startBattle(h);
      h.bridge._tick();
      poll(h);
      expect(h.bridge._frame()).toBe(1);
      expect(h.g.BattleManager.calls).toEqual([]);
      expect(assistOf(h)).toMatchObject({ speed: 1, skipSeen: false, lastCommand: null, controlT: null });
      writeControl(h, { speed: 2 });
      poll(h);
      expect(assistOf(h)).toMatchObject({ speed: 2, controlT: h.clock.t - 1000 });
    });

    it("re-maps the hotkeys when another plugin replaces Input.keyMapper", () => {
      h = newGame();
      const km2: Record<number, string> = { 13: "ok", 117: "otherPlugin" };
      h.g.Input.keyMapper = km2;
      expect(assistOf(h).hotkeys).toEqual({ speed: null, skip: null, win: null, lose: null, hpFull: null, hpLow: null });
      poll(h);
      expect(km2).toEqual({ 13: "ok", 117: "otherPlugin", 118: "rpgvSkip", 121: "rpgvWin", 122: "rpgvLose", 36: "rpgvHpFull", 35: "rpgvHpLow" });
      expect(assistOf(h).hotkeys).toEqual({ speed: null, skip: 118, win: 121, lose: 122, hpFull: 36, hpLow: 35 });
    });

    it("never auto-advances a message added without a text 101 (stale seen key is dropped)", () => {
      h = newGame();
      writeControl(h, { skipSeen: true, seenMessages: ["map:1:3:0#0"] });
      h.bridge._tick();
      showMessage(h, [cmd(101, ["", 0, 0, 2, ""]), cmd(0)], 0); // seen 101 without text: no window start
      h.g.$gameMessage.clear();
      h.g.$gameMessage.add("The enemy appears!"); // battle text, added directly
      const w = new h.g.Window_Message();
      w.startMessage();
      w.pause = true;
      expect(w._showFast).toBe(false);
      expect(pressOkCount(w, 30)).toBe(0);
    });

    describe("extra updates are input-neutral", () => {
      // one real frame: the engine's updateInputData, then updateScene (hooked)
      const holdFrames = (speed: number, frames: number, down: (hh: Harness) => void) => {
        const hh = newGame();
        onMap(hh);
        writeControl(hh, { speed });
        hh.bridge._tick();
        const sm = hh.g.SceneManager, I = hh.g.Input, TI = hh.g.TouchInput;
        const seen = { ok: 0, okTriggered: 0, okLong: 0, touch: 0, touchTriggered: 0 };
        sm.onSceneUpdate = () => {
          if (I.isRepeated("ok")) seen.ok++;
          if (I.isTriggered("ok")) seen.okTriggered++;
          if (I.isLongPressed("ok")) seen.okLong++;
          if (TI.isRepeated()) seen.touch++;
          if (TI.isTriggered()) seen.touchTriggered++;
        };
        down(hh);
        for (let f = 0; f < frames; f++) { sm.updateInputData(); sm.updateScene(); }
        return { seen, inputTime: I._pressedTime, touchTime: TI._pressedTime, updates: sm.sceneUpdates };
      };

      it("a 6-frame OK hold at x8 yields exactly one OK repeat-trigger, same as x1", () => {
        const x1 = holdFrames(1, 6, (hh) => hh.g.Input.keyDown(13));
        const x8 = holdFrames(8, 6, (hh) => hh.g.Input.keyDown(13));
        expect(x1.seen).toMatchObject({ ok: 1, okTriggered: 1, okLong: 0 });
        expect(x8.seen).toEqual(x1.seen);
        expect(x8.inputTime).toBe(x1.inputTime);
        expect(x8.inputTime).toBe(5);
        expect(x8.updates).toBe(48);
      });

      it("a 6-frame touch hold at x8 yields exactly one repeat-trigger, same as x1", () => {
        const x1 = holdFrames(1, 6, (hh) => hh.g.TouchInput.touchDown());
        const x8 = holdFrames(8, 6, (hh) => hh.g.TouchInput.touchDown());
        expect(x1.seen).toMatchObject({ touch: 1, touchTriggered: 1 });
        expect(x8.seen).toEqual(x1.seen);
        expect(x8.touchTime).toBe(x1.touchTime);
      });

      it("a long hold repeats at the engine's real-frame rate at x8", () => {
        const x1 = holdFrames(1, 40, (hh) => hh.g.Input.keyDown(13));
        const x8 = holdFrames(8, 40, (hh) => hh.g.Input.keyDown(13));
        expect(x1.seen.ok).toBe(4); // frame 1, then pressedTime 24, 30, 36
        expect(x8.seen).toEqual(x1.seen);
      });
    });

    it("does not run a command when the battle is already ending", () => {
      h = newGame();
      startBattle(h, "battleEnd");
      writeControl(h, { command: { id: "c-9", kind: "win" } });
      h.bridge._tick();
      h.bridge._frame();
      expect(h.g.BattleManager.calls).toEqual([]);
      expect(h.g.$gameTroop._enemies[0].isAlive()).toBe(true);
    });

    it("F6 cycles speed, F7 toggles seen skip; a control rewrite with the same values keeps them", () => {
      h = newGame();
      onMap(h);
      writeControl(h, { speed: 1, skipSeen: false });
      h.bridge._tick();
      const press = (code: number) => { h.g.Input.press(code); h.bridge._frame(); h.g.Input.update(); };
      press(117);
      press(117);
      press(118);
      expect(assistOf(h)).toMatchObject({ speed: 4, effectiveSpeed: 4, skipSeen: true });
      writeControl(h, { speed: 1, skipSeen: false, seenMessages: ["x"] }); // coverage rewrite
      poll(h);
      expect(assistOf(h)).toMatchObject({ speed: 4, skipSeen: true });
      writeControl(h, { speed: 8, skipSeen: false });
      poll(h);
      press(117);
      expect(assistOf(h)).toMatchObject({ speed: 1, skipSeen: true }); // skipSeen unchanged in control: hotkey value stays
      writeControl(h, { speed: 8, skipSeen: true });
      poll(h);
      expect(assistOf(h)).toMatchObject({ speed: 1, skipSeen: true });
      writeControl(h, { speed: 2, skipSeen: false });
      poll(h);
      expect(assistOf(h)).toMatchObject({ speed: 2, skipSeen: false });
    });

    it("F10 wins and F11 loses only in battle, reported as lastCommand", () => {
      h = newGame();
      onMap(h);
      const press = (code: number) => { h.g.Input.press(code); h.bridge._frame(); h.g.Input.update(); };
      press(121);
      expect(h.g.BattleManager.calls).toEqual([]);
      startBattle(h);
      press(121);
      expect(h.g.BattleManager.calls).toEqual(["victory"]);
      expect(assistOf(h).lastCommand).toBe("key-win-" + h.clock.t);
      startBattle(h);
      press(122);
      expect(h.g.BattleManager.calls).toEqual(["victory", "defeat:0"]);
    });

    it("remaps hotkeys from control.json: invalid/reserved -> default, null disables, others' keys untouched", () => {
      h = newGame();
      const km = h.g.Input.keyMapper;
      expect([km[117], km[118], km[121], km[122]]).toEqual(["rpgvSpeed", "rpgvSkip", "rpgvWin", "rpgvLose"]);
      km[66] = "otherPlugin";
      writeControl(h, { hotkeys: { speed: 65, skip: null, win: 116, lose: 66 } });
      h.bridge._tick();
      expect(km[65]).toBe("rpgvSpeed");
      expect([km[117], km[118]]).toEqual([undefined, undefined]);
      expect(km[116]).toBeUndefined(); // F5 (reserved) rejected -> default F10
      expect(km[121]).toBe("rpgvWin");
      expect(km[66]).toBe("otherPlugin"); // never overwritten
      expect(km[13]).toBe("ok");
      expect(assistOf(h).hotkeys).toEqual({ speed: 65, skip: null, win: 121, lose: null, hpFull: 36, hpLow: 35 });
      onMap(h);
      h.g.Input.press(117);
      h.bridge._frame();
      expect(assistOf(h).speed).toBe(1); // old F6 no longer bound
      writeControl(h, { hotkeys: { speed: 999, skip: 13, win: "x" } }); // all invalid / missing -> defaults
      poll(h);
      expect(km[65]).toBeUndefined();
      expect([km[117], km[118], km[121], km[122]]).toEqual(["rpgvSpeed", "rpgvSkip", "rpgvWin", "rpgvLose"]);
      expect(assistOf(h).hotkeys).toEqual({ speed: 117, skip: 118, win: 121, lose: 122, hpFull: 36, hpLow: 35 });
    });

    describe("party HP commands (1.12.0)", () => {
      // three actors: 100/100, 50/250 and one dead (hp 0)
      const party = (hh: Harness) => {
        const a = battler(hh), b = battler(hh), dead = battler(hh);
        b._mhp = 250; b._hp = 50;
        dead._hp = 0; dead.addNewState(1);
        hh.g.$gameParty._battlers = [a, b, dead];
        return [a, b, dead];
      };
      const hpOf = (ms: any[]) => ms.map((m) => [m.hp, m.isAlive()]);

      it("hpFull on the map revives the dead and fills every member's HP", () => {
        h = newGame();
        onMap(h);
        const ms = party(h);
        writeControl(h, { command: { id: "h-1", kind: "hpFull" } });
        h.bridge._tick();
        h.bridge._frame();
        expect(hpOf(ms)).toEqual([[100, true], [250, true], [100, true]]);
        expect(assistOf(h).lastCommand).toBe("h-1");
        expect(h.g.BattleManager.calls).toEqual([]); // no battle refresh on the map
      });

      it("hpLow sets alive members to 1% (at least 1) and leaves the dead dead", () => {
        h = newGame();
        onMap(h);
        const ms = party(h);
        ms[0]._mhp = 50; // 1% of 50 floors to 0 -> 1
        writeControl(h, { command: { id: "h-2", kind: "hpLow" } });
        h.bridge._tick();
        h.bridge._frame();
        expect(hpOf(ms)).toEqual([[1, true], [2, true], [0, false]]);
        expect(assistOf(h).lastCommand).toBe("h-2");
      });

      it("works in battle (even while a message is open) and refreshes the status window", () => {
        h = newGame();
        startBattle(h);
        const ms = party(h);
        h.g.$gameMessage._busy = true;
        writeControl(h, { command: { id: "h-3", kind: "hpLow" } });
        h.bridge._tick();
        h.bridge._frame();
        expect(hpOf(ms)).toEqual([[1, true], [2, true], [0, false]]);
        expect(h.g.BattleManager.calls).toEqual(["refreshStatus"]);
        writeControl(h, { command: { id: "h-4", kind: "hpFull" } });
        poll(h);
        h.bridge._frame();
        expect(hpOf(ms)).toEqual([[100, true], [250, true], [100, true]]);
        expect(h.g.BattleManager.calls).toEqual(["refreshStatus", "refreshStatus"]);
        expect(assistOf(h).lastCommand).toBe("h-4");
        expect(h.g.$gameParty.inBattle()).toBe(true); // the battle goes on
      });

      it("a command issued before the battle started still applies (not tied to a battle)", () => {
        h = newGame();
        onMap(h);
        const issued = h.clock.t;
        h.clock.t += 2000;
        startBattle(h);
        const ms = party(h);
        writeControl(h, { command: { id: "h-5", kind: "hpFull", at: issued } });
        h.bridge._tick();
        h.bridge._frame();
        expect(ms[2].isAlive()).toBe(true);
        expect(assistOf(h).lastCommand).toBe("h-5");
      });

      it("ignored without a party or when stale; failed when an actor throws; never throws", () => {
        h = newGame();
        onMap(h);
        writeControl(h, { command: { id: "h-6", kind: "hpFull" } });
        h.bridge._tick();
        h.bridge._frame();
        expect(assistOf(h).lastCommand).toBe("h-6:ignored");
        const ms = party(h);
        writeControl(h, { command: { id: "h-7", kind: "hpFull", at: h.clock.t - 11_000 } });
        poll(h);
        h.bridge._frame();
        expect(assistOf(h).lastCommand).toBe("h-7:ignored");
        expect(ms[2].isAlive()).toBe(false);
        ms[1].setHp = () => { throw new Error("broken"); };
        writeControl(h, { command: { id: "h-8", kind: "hpLow" } });
        poll(h);
        expect(() => h.bridge._frame()).not.toThrow();
        expect(assistOf(h).lastCommand).toBe("h-8:failed");
        h.g.$gameParty._battlers = [];
        writeControl(h, { command: { id: "h-9", kind: "hpLow" } });
        poll(h);
        expect(() => h.bridge._frame()).not.toThrow();
        expect(assistOf(h).lastCommand).toBe("h-9:ignored");
      });

      it("HP hotkeys default to Home / End (1.20.0), null disables them; configured keys work on the map and in battle", () => {
        h = newGame();
        const km = h.g.Input.keyMapper;
        expect([km[36], km[35]]).toEqual(["rpgvHpFull", "rpgvHpLow"]);
        onMap(h);
        const ms = party(h);
        writeControl(h, { hotkeys: { hpFull: 72, hpLow: 76 } });
        h.bridge._tick();
        expect([km[72], km[76]]).toEqual(["rpgvHpFull", "rpgvHpLow"]);
        expect(assistOf(h).hotkeys).toEqual({ speed: 117, skip: 118, win: 121, lose: 122, hpFull: 72, hpLow: 76 });
        const press = (code: number) => { h.g.Input.press(code); h.bridge._frame(); h.g.Input.update(); };
        press(76);
        expect(hpOf(ms)).toEqual([[1, true], [2, true], [0, false]]);
        expect(assistOf(h).lastCommand).toBe("key-hpLow-" + h.clock.t);
        startBattle(h);
        h.g.$gameParty._battlers = ms;
        press(72);
        expect(hpOf(ms)).toEqual([[100, true], [250, true], [100, true]]);
        expect(h.g.BattleManager.calls).toEqual(["refreshStatus"]);
        writeControl(h, { hotkeys: { hpFull: 72, hpLow: 72 } }); // duplicate -> second one gets its default (End)
        poll(h);
        expect(assistOf(h).hotkeys).toMatchObject({ hpFull: 72, hpLow: 35 });
        expect(km[76]).toBeUndefined();
        expect(km[35]).toBe("rpgvHpLow");
        writeControl(h, { hotkeys: { hpFull: null, hpLow: null } }); // explicit null -> off
        poll(h);
        expect(assistOf(h).hotkeys).toMatchObject({ hpFull: null, hpLow: null });
        expect(Object.values(km)).not.toContain("rpgvHpFull");
        expect(Object.values(km)).not.toContain("rpgvHpLow");
      });
    });

    it("never throws into the game when assist hooks fail", () => {
      h = newGame();
      onMap(h);
      h.g.Input.isTriggered = () => { throw new Error("boom"); };
      startBattle(h);
      writeControl(h, { command: { id: "c-x", kind: "win" } });
      h.bridge._tick();
      h.g.$gameTroop.aliveMembers = () => { throw new Error("troop"); };
      expect(() => h.g.SceneManager.updateScene()).not.toThrow();
      expect(h.g.SceneManager.sceneUpdates).toBe(1);
    });
  });

  it("exposes VERSION once with an RPG Maker plugin header", () => {
    const src = readFileSync(PLUGIN_PATH, "utf8");
    expect(src.match(/VERSION:\s*"1.20.1"/g)).toHaveLength(1);
    expect(src.startsWith("/*:")).toBe(true);
    expect(src).toContain("@target MZ MV");
    expect(src).toContain("@plugindesc RPG Viewer 기록 플러그인");
    expect(src).toContain("@author RPG Viewer");
    h = createHarness();
    expect(h.bridge.VERSION).toBe("1.20.1");
  });

  it("uses ES2015-compatible syntax only", () => {
    const src = readFileSync(PLUGIN_PATH, "utf8");
    expect(src).not.toMatch(/\?\.|\?\?|=>|\bclass\b|\basync\b|\bawait\b|^\s*(import|export)\b/m);
    expect(src).not.toMatch(/`|^\s*(let|const)\s|\bfor\s*\(\s*(let|const)\b/m); // ES5 for old NW.js (MV)
  });
});

describe("screen picture capture (1.6.0 / 1.7.0)", () => {
  const CONTROL_PATH = "/game/www/rpg-viewer/control.json";
  const setCapture = (hh: Harness, on: boolean) => {
    hh.fs.dirs.add("/game/www/rpg-viewer");
    hh.fs.writeFileSync(CONTROL_PATH, JSON.stringify({ v: 1, t: hh.clock.t, capturePictures: on }));
    hh.clock.t += 1000;
    hh.bridge._tick();
  };
  const talk = (hh: Harness, text = "hi", draw = true) => {
    const list = [cmd(101, ["", 0, 0, 2, ""]), cmd(401, [text]), cmd(0)];
    if (!hh.g.$gameMap.event(3)) hh.addMapEvent(3, [list], 0);
    const interp = hh.g.$gameMap._interpreter;
    interp.setup(list, 3);
    hh.g.$gameMessage.clear();
    hh.runCommand(interp, 0);
    if (draw) hh.drawMessageText();
  };
  const messages = (hh: Harness) => hh.readLog().filter((r) => r.type === "message");
  /** log lines on disk without forcing a flush */
  const onDisk = (hh: Harness) => (hh.fs.files.get(LOG_PATH) ?? "").split("\n").filter((l) => l).map((l) => JSON.parse(l));

  for (const engine of ["MZ", "MV"] as const) {
    it(`attaches the on-screen pictures to messages, then picsSame while unchanged (${engine})`, () => {
      h = newGame(engine);
      setCapture(h, true);
      const s = h.g.$gameScreen;
      s.maxPictures = () => 150; // games drawing standing pictures at ids 110~150 raise the picture count
      s.showPicture(120, "stand/body", 1, 400, 624, 100, 100, 255, 0);
      s.showPicture(110, "submit/2", 0, 10, 20, 50, 50, 128, 1);
      talk(h);
      talk(h);
      s.erasePicture(110);
      talk(h);
      const m = messages(h);
      expect(m[0].pics).toEqual([[110, "submit/2", 0, 10, 20, 50, 50, 128, 1], [120, "stand/body", 1, 400, 624, 100, 100, 255, 0]]);
      expect(m[0]).not.toHaveProperty("picsSame");
      expect(m[1]).toMatchObject({ picsSame: true });
      expect(m[1]).not.toHaveProperty("pics");
      expect(m[2].pics).toEqual([[120, "stand/body", 1, 400, 624, 100, 100, 255, 0]]);
    });
  }

  it("tags records written on a menu scene and keeps the map snapshot aside (1.17.0)", () => {
    h = newGame();
    setCapture(h, true);
    const s = h.g.$gameScreen;
    s.showPicture(1, "stand_a", 0, 0, 0, 100, 100, 255, 0);
    h.g.SceneManager._scene = new h.g.Scene_Map();
    talk(h, "map 1");
    // the menu opens; MenuCommonEvent runs a common event that erases the stand and shows another
    function Scene_Menu(this: any) {}
    h.g.SceneManager._scene = new (Scene_Menu as any)();
    const interp = h.newInterpreter();
    const list = [cmd(235, [1]), cmd(231, [2, "menu_stand", 0, 0, 0, 100, 100, 255, 0, 0]), cmd(0)];
    interp.setup(list, 0);
    h.runCommand(interp, 0);
    h.runCommand(interp, 1);
    talk(h, "in menu");
    // the game puts the stand back before the menu closes
    s.erasePicture(2);
    s.showPicture(1, "stand_a", 0, 0, 0, 100, 100, 255, 0);
    h.g.SceneManager._scene = new h.g.Scene_Map();
    talk(h, "map 2");
    const log = h.readLog();
    const pics = log.filter((r) => r.type === "picture");
    expect(pics).toHaveLength(2);
    for (const p of pics) expect(p.scene).toBe("menu");
    const m = messages(h);
    expect(m[0]).not.toHaveProperty("scene");
    expect(m[0].pics).toHaveLength(1);
    expect(m[1]).toMatchObject({ scene: "menu" });
    expect(m[1]).not.toHaveProperty("pics");
    expect(m[1]).not.toHaveProperty("picsSame");
    expect(m[2]).not.toHaveProperty("scene");
    expect(m[2]).toMatchObject({ picsSame: true });
  });

  it("is off by default and when turned off; turning on again writes a full snapshot", () => {
    h = newGame();
    h.g.$gameScreen.showPicture(1, "a", 0, 0, 0, 100, 100, 255, 0);
    talk(h);
    setCapture(h, true);
    talk(h);
    setCapture(h, false);
    talk(h);
    setCapture(h, true);
    talk(h);
    const m = messages(h);
    expect(m[0]).not.toHaveProperty("pics");
    expect(m[0]).not.toHaveProperty("picsSame");
    expect(m[1].pics).toHaveLength(1);
    expect(m[2]).not.toHaveProperty("pics");
    expect(m[2]).not.toHaveProperty("picsSame");
    expect(m[3].pics).toHaveLength(1);
    h.bridge._snapshotNow();
    expect(h.readLive().assist.capturePictures).toBe(true);
  });

  it("uses target values of moving pictures, tone and angle; an empty screen is []", () => {
    h = newGame();
    setCapture(h, true);
    talk(h);
    const s = h.g.$gameScreen;
    s.showPicture(5, "x", 0, 0, 0, 100, 100, 255, 0);
    s.movePicture(5, 1, 300.456, 200, 80, 80, 40, 2, 30);
    s.picture(5)._tone = [10, -20, 0, 0];
    s.picture(5)._angle = 15;
    s.showPicture(6, "", 0, 0, 0, 100, 100, 255, 0); // no name: skipped
    s.showPicture(7, "fading", 0, 0, 0, 100, 100, 255, 0);
    s.movePicture(7, 0, 0, 0, 100, 100, 0, 0, 30); // fading out: gone while the message shows
    s.showPicture(8, "clear", 0, 0, 0, 100, 100, 0, 0); // opacity 0: not recorded
    talk(h);
    const m = messages(h);
    expect(m[0].pics).toEqual([]);
    expect(m[1].pics).toEqual([[5, "x", 1, 300.46, 200, 80, 80, 40, 2, [10, -20, 0, 0], 15]]);
  });

  it("bounds the snapshot: at most 60 pictures, names clipped to 200 chars", () => {
    h = newGame();
    setCapture(h, true);
    for (let id = 1; id <= 80; id++) h.g.$gameScreen.showPicture(id, "p" + id + "x".repeat(300), 0, 0, 0, 100, 100, 255, 0);
    talk(h);
    const pics = messages(h)[0].pics;
    expect(pics).toHaveLength(60);
    expect(pics[0][1]).toHaveLength(200);
  });

  it("dedupes per branch: a load writes the snapshot again", () => {
    h = newGame("MV");
    setCapture(h, true);
    h.g.$gameScreen.showPicture(1, "a", 0, 0, 0, 100, 100, 255, 0);
    talk(h);
    h.g.DataManager.saveGame(1);
    talk(h);
    h.g.DataManager.loadGame(1);
    talk(h);
    const m = messages(h);
    expect(m[0].pics).toHaveLength(1);
    expect(m[1].picsSame).toBe(true);
    expect(m[2].pics).toHaveLength(1);
    expect(m[2].branch).not.toBe(m[0].branch);
  });

  it("a choice without a message carries changed pictures; battle messages too (1.8.0)", () => {
    h = newGame();
    setCapture(h, true);
    talk(h);
    h.g.$gameScreen.showPicture(2, "b", 0, 0, 0, 100, 100, 255, 0);
    const list = [cmd(102, [["yes", "no"], 1]), cmd(0)];
    h.addMapEvent(4, [list], 0);
    const interp = h.g.$gameMap._interpreter;
    interp.setup(list, 4);
    h.g.$gameMessage.clear();
    h.runCommand(interp, 0);
    const choices = h.readLog().filter((r) => r.type === "choices");
    expect(choices[0].pics).toEqual([[2, "b", 0, 0, 0, 100, 100, 255, 0]]);
    h.g.BattleManager.setup(4);
    talk(h);
    const last = messages(h).at(-1);
    expect(last).toMatchObject({ picsSame: true });
  });

  for (const engine of ["MZ", "MV"] as const) {
    it(`1.7.0 records what the picture sprites draw: hidden / transparent sprites left out (${engine})`, () => {
      h = newGame(engine);
      setCapture(h, true);
      const s = h.g.$gameScreen;
      s.maxPictures = () => 200;
      const ss = h.mountSpriteset(200);
      h.setBitmapSize("Cut_bath", 1024, 768);
      h.setBitmapSize("actor01_pose01_body_0003", 922, 922);
      h.setBitmapSize("Guage", 278, 60);
      s.showPicture(60, "Cut_bath", 0, 0, 0, 100, 100, 255, 0);
      s.showPicture(102, "Guage", 0, 746, 2, 100, 100, 255, 0);
      s.showPicture(111, "actor01_pose01_body_0003", 0, 380, 0, 100, 100, 255, 0);
      s.showPicture(112, "hair/01_1", 0, 380, 0, 100, 100, 255, 0);
      s.showPicture(113, "organ/01v", 0, 380, 0, 100, 100, 4, 0);
      s.showPicture(114, "under/01_1", 1, 380.4, 0, 50, 50, 240, 1);
      ss.update();
      // a plugin hides the stand at the sprite level while the event picture shows
      ss.sprites[110].visible = false;   // 111
      ss.sprites[111].opacity = 0;       // 112
      // a layer plugin moves 114 above the windows; its parent layer is visible, rotated and tinted
      const layer = ss.scene.addChild(new h.g.Sprite());
      layer.alpha = 0.5;
      layer.addChild(ss.sprites[113]);
      ss.sprites[113].rotation = Math.PI / 2;
      ss.sprites[113]._colorTone = [0, 0, 0, 68];
      // a hidden layer hides 102 with its parent
      const hiddenLayer = ss.scene.addChild(new h.g.Sprite());
      hiddenLayer.visible = false;
      hiddenLayer.addChild(ss.sprites[101]);
      talk(h);
      expect(messages(h)[0].pics).toEqual([
        [60, "Cut_bath", 0, 0, 0, 100, 100, 255, 0, 0, 0, 1024, 768],
        [113, "organ/01v", 0, 380, 0, 100, 100, 4, 0, 0, 0, 100, 100],
        [114, "under/01_1", 1, 380, 0, 50, 50, 120, 1, [0, 0, 0, 68], 90, 100, 100],
      ]);
    });
  }

  it("1.7.0 keeps target values of a moving picture while its sprite follows it, other anchors as [x, y]", () => {
    h = newGame();
    setCapture(h, true);
    const ss = h.mountSpriteset(10);
    const s = h.g.$gameScreen;
    s.showPicture(1, "a", 0, 0, 0, 100, 100, 0, 0);
    s.movePicture(1, 0, 300, 50, 100, 100, 255, 0, 20); // fading in from 0
    s.showPicture(2, "b", 0, 10, 10, 100, 100, 255, 0);
    ss.update();
    ss.sprites[1].anchor = { x: 0.5, y: 1 };
    talk(h);
    expect(messages(h)[0].pics).toEqual([
      [1, "a", 0, 300, 50, 100, 100, 255, 0, 0, 0, 100, 100],
      [2, "b", [0.5, 1], 10, 10, 100, 100, 255, 0, 0, 0, 100, 100],
    ]);
  });

  it("falls back to Game_Screen pictures when the scene has no picture sprites", () => {
    h = newGame();
    setCapture(h, true);
    h.g.SceneManager._scene = Object.assign(new h.g.Scene_Map(), { _spriteset: { children: [] }, children: [] });
    h.g.$gameScreen.showPicture(3, "c", 0, 1, 2, 100, 100, 255, 0);
    talk(h);
    expect(messages(h)[0].pics).toEqual([[3, "c", 0, 1, 2, 100, 100, 255, 0]]);
  });

  it("1.7.0 takes the snapshot when the text starts drawing; flushes wait for it at most 1 s", () => {
    h = newGame();
    setCapture(h, true);
    const ss = h.mountSpriteset(10);
    const s = h.g.$gameScreen;
    s.showPicture(1, "stand", 0, 0, 0, 100, 100, 255, 0);
    s.showPicture(2, "cg", 0, 0, 0, 100, 100, 255, 0);
    ss.update();
    talk(h, "a", false);
    h.bridge._runScheduled();
    h.bridge._tick();
    expect(onDisk(h).filter((r) => r.type === "message")).toHaveLength(0); // waiting for the window
    // the same frame's event commands erase the stand before the window draws
    s.erasePicture(1);
    ss.update();
    h.drawMessageText();
    h.clock.t += 100;
    h.bridge._runScheduled();
    const m = onDisk(h).filter((r) => r.type === "message");
    expect(m).toHaveLength(1);
    expect(m[0].pics.map((p: any[]) => p[1])).toEqual(["cg"]);
    // a message whose window never draws is written after 1 s with the pictures of that moment
    talk(h, "b", false);
    h.clock.t += 500;
    h.bridge._tick();
    expect(onDisk(h).filter((r) => r.type === "message")).toHaveLength(1);
    h.clock.t += 600;
    h.bridge._tick();
    const m2 = onDisk(h).filter((r) => r.type === "message");
    expect(m2).toHaveLength(2);
    expect(m2[1].picsSame).toBe(true);
    // records keep their order behind a held message
    const seqs = onDisk(h).map((r) => r.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });

  it("a choice shown with a held message leaves the pictures to the message", () => {
    h = newGame();
    setCapture(h, true);
    h.g.$gameScreen.showPicture(1, "a", 0, 0, 0, 100, 100, 255, 0);
    const list = [cmd(101, ["", 0, 0, 2, ""]), cmd(401, ["pick"]), cmd(102, [["yes", "no"], 1]), cmd(0)];
    h.addMapEvent(5, [list], 0);
    const interp = h.g.$gameMap._interpreter;
    interp.setup(list, 5);
    h.g.$gameMessage.clear();
    h.runCommand(interp, 0);
    h.drawMessageText();
    const log = h.readLog();
    const msg = log.find((r) => r.type === "message");
    const ch = log.find((r) => r.type === "choices");
    expect(msg.pics).toHaveLength(1);
    expect(ch).not.toHaveProperty("pics");
    expect(msg.seq).toBeLessThan(ch.seq);
    expect(log.indexOf(msg)).toBeLessThan(log.indexOf(ch));
  });

  it("a broken $gameScreen never breaks the message", () => {
    h = newGame();
    setCapture(h, true);
    h.g.$gameScreen = { picture() { throw new Error("boom"); }, maxPictures() { return 3; } };
    talk(h);
    const log = h.readLog();
    expect(log.filter((r) => r.type === "message")).toHaveLength(1);
    expect(log.some((r) => r.type === "error")).toBe(true);
  });
});
