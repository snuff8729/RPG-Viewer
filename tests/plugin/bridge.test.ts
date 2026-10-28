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
    expect(JSON.parse(h.fs.readFileSync(META_PATH))).toEqual({ nextRun: 2, nextBranch: 2, nextSeq: 3, lastStory: { "1": 0 } });
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
      expect(JSON.parse(h.fs.readFileSync(META_PATH)).lastStory).toEqual({ "1": 2 });
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

    it("keeps at most 200 branches in lastStory", () => {
      h = newGame();
      for (let i = 0; i < 230; i++) h.g.DataManager.extractSaveContents({});
      h.bridge._tick();
      expect(Object.keys(JSON.parse(h.fs.readFileSync(META_PATH)).lastStory)).toHaveLength(200);
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
      v: 1, t: 1_000_000, pluginVersion: "1.0.5", run: 1, branch: 1, seq: 4,
      mapId: 1, x: 3, y: 4, running: src, runningCmd: 1,
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

  it("exposes VERSION once with an RPG Maker plugin header", () => {
    const src = readFileSync(PLUGIN_PATH, "utf8");
    expect(src.match(/VERSION:\s*"1\.0\.5"/g)).toHaveLength(1);
    expect(src.startsWith("/*:")).toBe(true);
    expect(src).toContain("@target MZ MV");
    expect(src).toContain("@plugindesc RPG Viewer 기록 플러그인");
    expect(src).toContain("@author RPG Viewer");
    h = createHarness();
    expect(h.bridge.VERSION).toBe("1.0.5");
  });

  it("uses ES2015-compatible syntax only", () => {
    const src = readFileSync(PLUGIN_PATH, "utf8");
    expect(src).not.toMatch(/\?\.|\?\?|=>|\bclass\b|\basync\b|\bawait\b|^\s*(import|export)\b/m);
  });
});
