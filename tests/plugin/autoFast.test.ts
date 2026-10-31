import { afterEach, describe, expect, it } from "vitest";
import { cmd, createHarness, type Cmd, type Harness } from "./harness";

let h: Harness;
afterEach(() => { h?.bridge?._flushNow(); });

function setControl(fields: Record<string, unknown>) {
  h.fs.dirs.add("/game/www/rpg-viewer");
  h.fs.writeFileSync("/game/www/rpg-viewer/control.json", JSON.stringify({
    v: 1, t: h.clock.t, speed: 2, autoFast: true, autoSpeed: 8, ...fields,
  }));
  h.clock.t += 1000;
  h.bridge._tick();
}

function mapEvent(list: Cmd[]) {
  h.addMapEvent(3, [list]);
  const root = h.g.$gameMap._interpreter;
  root.setup(list, 3);
  return root;
}

function commonEvent(id: number, list: Cmd[]) {
  h.g.$dataCommonEvents[id] = { id, list };
  return list;
}

function battleEvent(list: Cmd[]) {
  h.g.$dataTroops[4] = { id: 4, name: "Synthetic troop", pages: [{ list }] };
  h.g.BattleManager.setup(4);
  h.g.SceneManager._scene = new h.g.Scene_Battle();
  const root = h.g.$gameTroop._interpreter;
  root.setup(list, 0);
  return root;
}

for (const engine of ["MV", "MZ"] as const) {
  describe(`autoFast seen stretches (${engine})`, () => {
    function newGame() {
      h = createHarness({ engine });
      h.g.DataManager.setupNewGame();
      h.g.SceneManager._scene = new h.g.Scene_Map();
    }

    for (const code of [101, 105]) {
      for (const seen of [true, false]) {
        it(`speeds an animation and its textless child only before ${seen ? "seen" : "unseen"} ${code}`, () => {
          newGame();
          commonEvent(7, [cmd(231), cmd(230, [60]), cmd(0)]);
          const list = [cmd(231), cmd(230, [60]), cmd(117, [7]), cmd(code), cmd(code === 101 ? 401 : 405, ["dialogue"]), cmd(0)];
          const root = mapEvent(list);
          setControl({ seenMessages: seen ? ["map:1:3:0#3"] : [], seenPages: ["map:1:3:0"] });
          expect(h.bridge._frame()).toBe(seen ? 8 : 2);
          h.runCommand(root, 2);
          expect(root._index).toBe(3); // MV/MZ advance past 117 before the child runs.
          expect(root._childInterpreter._eventId).toBe(3);
          expect(root._childInterpreter._rpgvSrc).toEqual({ source: "common", commonEventId: 7 });
          expect(h.bridge._frame()).toBe(seen ? 8 : 2);
          const before = h.g.SceneManager.sceneUpdates;
          h.frame();
          expect(h.g.SceneManager.sceneUpdates - before).toBe(seen ? 8 : 2);
          h.bridge._snapshotNow();
          expect(h.readLive().assist).toMatchObject({ speed: 2, effectiveSpeed: seen ? 8 : 2, skipSeen: false });
        });
      }
    }

    it("stops at choices before text, even if the page and a synthetic choice key are seen", () => {
      newGame();
      mapEvent([cmd(231), cmd(102, [["A", "B"]]), cmd(101), cmd(401, ["seen"]), cmd(0)]);
      setControl({ seenPages: ["map:1:3:0"], seenMessages: ["map:1:3:0#1", "map:1:3:0#2"] });
      expect(h.bridge._frame()).toBe(2);
    });

    it("finds the first dialogue rather than a later seen one on a partially seen page", () => {
      newGame();
      const root = mapEvent([cmd(230), cmd(101), cmd(401, ["new"]), cmd(230), cmd(101), cmd(401, ["seen"]), cmd(0)]);
      setControl({ seenMessages: ["map:1:3:0#4"] });
      expect(h.bridge._frame()).toBe(2);
      root._index = 3;
      expect(h.bridge._frame()).toBe(8);
    });

    it("climbs multiple textless children and invalidates the cache when only a parent index changes", () => {
      newGame();
      const root = mapEvent([cmd(117, [7]), cmd(101), cmd(401, ["seen"]), cmd(101), cmd(401, ["new"]), cmd(0)]);
      commonEvent(7, [cmd(230), cmd(117, [8]), cmd(0)]);
      commonEvent(8, [cmd(231), cmd(230), cmd(0)]);
      h.runCommand(root, 0);
      h.runCommand(root._childInterpreter, 1);
      const leaf = root._childInterpreter._childInterpreter;
      setControl({ seenMessages: ["map:1:3:0#1"] });
      expect(h.bridge._frame()).toBe(8);
      root._index = 3;
      expect(h.bridge._frame()).toBe(2);
      expect(leaf._index).toBe(0);
      root._index = 1;
      expect(h.bridge._frame()).toBe(8);
      // Save-restored child chains work without setupChild having linked parent pointers.
      const restored = h.newInterpreter();
      restored.setup(leaf._list, 3);
      root._childInterpreter._childInterpreter = restored;
      expect(h.bridge._frame()).toBe(8);
    });

    it("uses a child's own dialogue key ahead of its parent's and ignores completed children", () => {
      newGame();
      const root = mapEvent([cmd(117, [7]), cmd(101), cmd(401, ["parent"]), cmd(0)]);
      commonEvent(7, [cmd(230), cmd(105), cmd(405, ["child"]), cmd(0)]);
      h.runCommand(root, 0);
      setControl({ seenMessages: ["map:1:3:0#1"], seenPages: ["common:7"] });
      expect(h.bridge._frame()).toBe(2);
      setControl({ seenMessages: ["common:7#1"] });
      expect(h.bridge._frame()).toBe(8);
      root._childInterpreter.clear();
      expect(h.bridge._frame()).toBe(2);
    });

    it("stops at a parent's choice after a textless child", () => {
      newGame();
      const root = mapEvent([cmd(117, [7]), cmd(102), cmd(101), cmd(0)]);
      commonEvent(7, [cmd(230), cmd(0)]);
      h.runCommand(root, 0);
      setControl({ seenMessages: ["map:1:3:0#2"], seenPages: ["common:7", "map:1:3:0"] });
      expect(h.bridge._frame()).toBe(2);
    });

    it("keeps seenPages fallback for the innermost page when the entire chain has no dialogue", () => {
      newGame();
      const root = mapEvent([cmd(117, [7]), cmd(230), cmd(0)]);
      commonEvent(7, [cmd(231), cmd(230), cmd(0)]);
      setControl({ seenPages: ["map:1:3:0"] });
      expect(h.bridge._frame()).toBe(8);
      h.runCommand(root, 0);
      expect(h.bridge._frame()).toBe(2);
      setControl({ seenPages: ["common:7"] });
      expect(h.bridge._frame()).toBe(8);
      setControl({ seenPages: [] });
      expect(h.bridge._frame()).toBe(2);
      root.clear();
      expect(h.bridge._frame()).toBe(2);
    });

    it("speeds running battle common events with seen text and stops after the troop interpreter finishes", () => {
      newGame();
      // A suspended seen map event must not lend its seen status to battle actions.
      mapEvent([cmd(101), cmd(0)]);
      commonEvent(7, [cmd(231), cmd(230), cmd(101), cmd(401, ["defeat"]), cmd(0)]);
      const root = battleEvent([cmd(117, [7]), cmd(0)]);
      h.runCommand(root, 0);
      setControl({ seenMessages: ["common:7#2", "map:1:3:0#0"], seenPages: ["common:7", "map:1:3:0"], seenTroops: [4] });
      expect(h.bridge._frame()).toBe(8);
      setControl({ seenMessages: ["map:1:3:0#0"] });
      expect(h.bridge._frame()).toBe(2); // unseen child overrides seenPages
      setControl({ seenMessages: ["common:7#2"] });
      expect(h.bridge._frame()).toBe(8);
      root.clear();
      for (const phase of ["input", "turn", "action"]) {
        h.g.BattleManager._phase = phase;
        expect(h.bridge._frame()).toBe(2);
      }
      // Missing troop objects also cannot fall back to the suspended map event.
      h.g.$gameTroop = null;
      expect(h.bridge._frame()).toBe(2);
    });

    it("climbs from a battle animation child to the troop's seen dialogue key", () => {
      newGame();
      commonEvent(7, [cmd(231), cmd(230), cmd(0)]);
      const root = battleEvent([cmd(117, [7]), cmd(105), cmd(405, ["troop text"]), cmd(0)]);
      h.runCommand(root, 0);
      setControl({ seenMessages: ["troop:4:0#1"] });
      expect(h.bridge._frame()).toBe(8);
      root._index = 3;
      setControl({ seenMessages: [], seenPages: ["common:7"] });
      expect(h.bridge._frame()).toBe(8); // no text remains: seenPages fallback
    });

    it("caches scans across frames while allowing coverage changes at the same index", () => {
      newGame();
      let reads = 0;
      const wait = cmd(230);
      Object.defineProperty(wait, "code", { get() { reads++; return 230; } });
      mapEvent([wait, cmd(101), cmd(401, ["seen"]), cmd(0)]);
      setControl({ seenMessages: ["map:1:3:0#1"] });
      expect(h.bridge._frame()).toBe(8);
      const afterScan = reads;
      expect(afterScan).toBeGreaterThan(0);
      for (let i = 0; i < 5; i++) expect(h.bridge._frame()).toBe(8);
      expect(reads).toBe(afterScan);
      setControl({ seenMessages: [] });
      expect(h.bridge._frame()).toBe(2);
      setControl({ seenMessages: ["map:1:3:0#1"] });
      expect(h.bridge._frame()).toBe(8);
      setControl({ autoFast: false });
      expect(h.bridge._frame()).toBe(2);
      setControl({ autoFast: true, speed: 8, autoSpeed: 4 });
      expect(h.bridge._frame()).toBe(8); // auto speed never lowers manual speed
    });

    it("invalidates a cached target when the interpreter switches lists at the same index", () => {
      newGame();
      const root = mapEvent([cmd(230), cmd(101), cmd(0)]);
      commonEvent(7, [cmd(230), cmd(105), cmd(0)]);
      setControl({ seenMessages: ["map:1:3:0#1"] });
      expect(h.bridge._frame()).toBe(8);
      root.setup(h.g.$dataCommonEvents[7].list, 3);
      expect(h.bridge._frame()).toBe(2);
    });

    it("uses full origin keys and invalidates the cache when only the source changes", () => {
      newGame();
      const root = mapEvent([cmd(230), cmd(101), cmd(0)]);
      root._rpgvSrc = { source: "map", mapId: 1, eventId: 3, page: 0, origin: 2 };
      setControl({ seenMessages: ["map:1:3:0:o2#1"] });
      expect(h.bridge._frame()).toBe(8);
      root._rpgvSrc = null;
      expect(h.bridge._frame()).toBe(2);
    });

    it("caps the total scan and does not treat an incomplete scan as a seen page", () => {
      newGame();
      const root = mapEvent([...Array.from({ length: 2000 }, () => cmd(230)), cmd(101), cmd(0)]);
      setControl({ seenMessages: ["map:1:3:0#2000"], seenPages: ["map:1:3:0"] });
      expect(h.bridge._frame()).toBe(2);
      root._index = 1; // text is now the 2000th scanned command
      expect(h.bridge._frame()).toBe(8);
      const animation = commonEvent(7, Array.from({ length: 2000 }, () => cmd(230)));
      root._index = 2000;
      root.setupChild(animation, 3);
      expect(h.bridge._frame()).toBe(2); // budget is shared across child and parent
    });

    it("bounds cyclic child chains", () => {
      newGame();
      const root = mapEvent([cmd(101), cmd(0)]);
      setControl({ seenMessages: ["map:1:3:0#0"] });
      root._childInterpreter = root;
      expect(h.bridge._frame()).toBe(2);
      root._childInterpreter = null;
    });

    it("reports scan failures and preserves manual speed without interrupting the engine", () => {
      newGame();
      const broken = cmd(230);
      Object.defineProperty(broken, "code", { get() { throw new Error("synthetic auto scan failure"); } });
      mapEvent([broken, cmd(101), cmd(0)]);
      setControl({ seenMessages: ["map:1:3:0#1"] });
      expect(() => h.frame()).not.toThrow();
      expect(h.g.SceneManager.sceneUpdates).toBe(2);
      expect(h.readLog().filter(r => r.type === "error")).toEqual([
        expect.objectContaining({ message: expect.stringContaining("synthetic auto scan failure") }),
      ]);
    });
  });
}
