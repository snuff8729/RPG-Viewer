import { afterEach, describe, expect, it } from "vitest";
import { seenKey } from "../../src/core/live/coverage";
import type { Location } from "../../src/core/types";
import { cmd, createHarness, type Harness, type MemFs } from "./harness";

// 1.24.0 랜덤 전투 끄기 · 전투 건너뛰기 · 잡아 본 적만
let h: Harness;
afterEach(() => { h?.bridge?._flushNow(); });

const DIR = "/game/www/rpg-viewer";
const CONTROL_PATH = DIR + "/control.json";
const DEFEATED_PATH = DIR + "/defeated.json";

function newGame(engine: "MZ" | "MV" = "MZ", fs?: MemFs): Harness {
  const hh = createHarness({ engine, fs });
  hh.g.DataManager.setupNewGame();
  hh.g.$dataActors = [null, { name: "해롤드" }, { name: "테레즈" }];
  hh.g.$dataItems = [null, { id: 1, name: "포션" }];
  hh.g.$gameParty._battlers = [hh.g.$gameActors.actor(1), hh.g.$gameActors.actor(2)];
  return hh;
}
function setControl(hh: Harness, fields: Record<string, unknown>) {
  hh.fs.dirs.add(DIR);
  hh.fs.writeFileSync(CONTROL_PATH, JSON.stringify({ v: 1, t: hh.clock.t, ...fields }));
  hh.clock.t += 1000;
  hh.bridge._tick();
}
/** troop 5: slime (id 1, 10 exp, 5 gold, drops a potion) + bat (id 2, 140 exp, 7 gold); pages = battle event lists */
function setTroop(hh: Harness, troopId = 5, pages: any[][] = [[cmd(0)]], enemyIds = [1, 2]) {
  hh.g.$dataTroops[troopId] = { id: troopId, name: "슬라임과 박쥐", pages: pages.map((list) => ({ list })) };
  const opts: Record<number, any> = {
    1: { exp: 10, gold: 5, drops: [hh.g.$dataItems[1]], name: "슬라임" },
    2: { exp: 140, gold: 7, name: "박쥐" },
    3: { exp: 1, gold: 1, name: "유령" },
  };
  hh.g.$gameTroop._enemies = enemyIds.map((id) => new hh.g.Game_Enemy(id, opts[id]));
  return hh.g.$gameTroop._enemies;
}
/** Battle Processing (command301): setup, event callback (the If Win / If Lose branch), push Scene_Battle */
function eventBattle(hh: Harness, troopId = 5) {
  const branch: { n?: number } = {};
  hh.g.BattleManager.setup(troopId, false, false);
  hh.g.BattleManager.setEventCallback((n: number) => { branch.n = n; });
  hh.g.SceneManager.push(hh.g.Scene_Battle);
  return branch;
}
const battleRecs = (hh: Harness) => hh.readLog().filter((r) => r.type === "battle");
const defeatedOnDisk = (hh: Harness) => {
  const t = hh.fs.files.get(DEFEATED_PATH);
  return t === undefined ? undefined : JSON.parse(t);
};

const mapSource: Location = { source: "map", mapId: 1, eventId: 3, page: 0 };
const dialogue = (text = "aftermath") => [cmd(101, ["", 0, 0, 2]), cmd(401, [text])];
function aftermathList(win = dialogue("win"), escape = dialogue("escape"), lose = dialogue("lose"), canEscape = true, canLose = true) {
  // Prefix + enclosing indent catch accidental branch-relative indices and hard-coded indent 0.
  return [cmd(108, ["prefix"]), cmd(301, [0, 5, canEscape, canLose], 2),
    ...[win, escape, lose].flatMap((body, result) => [cmd(601 + result, [], 2), ...body.map(c => ({ ...c, indent: c.indent + 3 }))]),
    cmd(604, [], 2), cmd(0)];
}
function seenOutcomes(list: ReturnType<typeof aftermathList>, results: number[], src = mapSource) {
  let result = -1;
  return list.flatMap((c, i) => {
    if (c.indent === 2 && c.code >= 601 && c.code <= 603) result = c.code - 601;
    return results.includes(result) && [101, 102, 105].includes(c.code) ? [seenKey(src, i)] : [];
  });
}
function runAftermath(list: ReturnType<typeof aftermathList>, src = mapSource) {
  const interp = h.newInterpreter();
  if (src.source === "map") h.addMapEvent(src.eventId, [list], 0);
  else if (src.source === "common") h.g.$dataCommonEvents[src.commonEventId] = { list };
  else {
    h.g.$dataTroops[src.troopId] = { pages: [{ list }] };
    h.g.$gameTroop._troopId = src.troopId;
  }
  interp.setup(list, src.source === "map" ? src.eventId : 0);
  // Origin pages already have resolver coverage elsewhere; preserve the complete source in this test.
  if (src.source === "map" && typeof src.origin === "number") interp._rpgvSrc = src;
  h.runCommand(interp, 1);
  return interp;
}

function conditional(params: any[], yes = dialogue("then"), no?: ReturnType<typeof dialogue>) {
  const nested = (body: ReturnType<typeof dialogue>) => body.map(c => ({ ...c, indent: c.indent + 1 }));
  return [cmd(111, params), ...nested(yes), ...(no ? [cmd(411), ...nested(no)] : []), cmd(412)];
}

describe("battle skip seen story (1.29.0)", () => {
  function prepare(engine: "MZ" | "MV" = "MZ", enemies = [1, 2], seenMessages = ["common:999#0"]) {
    h = newGame(engine);
    h.fs.dirs.add(DIR);
    h.fs.writeFileSync(DEFEATED_PATH, JSON.stringify({ v: 1, enemies }));
    setControl(h, { skipBattles: true, seenMessages });
  }

  it("writes why a battle was not skipped on its end record (1.29.1)", () => {
    prepare("MZ", []);
    setControl(h, { skipBattles: true, seenMessages: ["common:999#0"] });
    setTroop(h, 5, [[cmd(101), cmd(0)]]);
    expect(eventBattle(h).n).toBeUndefined();
    h.g.BattleManager.endBattle(0);
    expect(battleRecs(h).at(-1)).toMatchObject({ phase: "end", notSkipped: { reason: "unseen", key: "troop:5:0#0", seen: 1, known: false } });
    prepare("MZ", [1, 2], ["troop:5:0#0"]);
    setTroop(h, 5, [[cmd(101), cmd(0)]]);
    expect(eventBattle(h).n).toBe(0);
    expect(battleRecs(h).at(-1).notSkipped).toBeUndefined();
  });

  for (const engine of ["MV", "MZ"] as const) {
    it.each([101, 105])(`an unseen defeat page (actor HP) blocks only a never-beaten troop (${engine}, %s)`, code => {
      prepare(engine, []);
      const pages = [[cmd(0)], [cmd(108), cmd(code), cmd(code), cmd(0)]];
      const setup = () => {
        setTroop(h, 5, pages);
        h.g.$dataTroops[5].pages[1].conditions = { actorValid: true, actorId: 1, actorHp: 0 };
      };
      setControl(h, { skipBattles: true, seenMessages: ["troop:5:0#1", "troop:5:1#2"] });
      setup();
      expect(eventBattle(h).n).toBeUndefined();
      expect(h.bridge._lastMessage).toBe("처음 보는 대화가 있어 그대로 싸워요");
      h.g.BattleManager.endBattle(0);
      // the same troop once beaten: a defeat page (often never reached when the game loses through a skill) no longer blocks
      prepare(engine, [1, 2], ["troop:5:0#1", "troop:5:1#2"]);
      setup();
      expect(eventBattle(h).n).toBe(0);
      expect(battleRecs(h).at(-1)).toMatchObject({ skipped: true, result: "win" });
    });

    it(`uses exact troop page keys for a page without an actor HP condition (${engine})`, () => {
      prepare(engine);
      const pages = [[cmd(0)], [cmd(108), cmd(101), cmd(101), cmd(0)]];
      setControl(h, { skipBattles: true, seenMessages: ["troop:5:0#1", "troop:5:1#2"] });
      setTroop(h, 5, pages);
      expect(eventBattle(h).n).toBeUndefined();
      h.g.BattleManager.endBattle(0);
      setControl(h, { skipBattles: true, seenMessages: ["troop:5:1#1", "troop:5:1#2"] });
      setTroop(h, 5, pages);
      expect(eventBattle(h).n).toBe(0);
    });

    it(`follows the current count through nested branches and their matching Else / End (${engine})`, () => {
      prepare(engine);
      const list = [cmd(108), ...conditional([1, 7, 0, 3, 0],
        conditional([0, 8, 0], [], dialogue("nested else")), dialogue("outer else")), cmd(0)];
      // Only the outer Else is seen. Nested 411/412 must not close the outer 111.
      const outerText = list.findIndex(c => c.code === 401 && c.parameters[0] === "outer else") - 1;
      setControl(h, { skipBattles: true, seenMessages: [`troop:5:0#${outerText}`] });
      h.g.$gameVariables.setValue(7, 2);
      setTroop(h, 5, [list]);
      expect(eventBattle(h).n).toBe(0);
      h.g.$gameVariables.setValue(7, 3);
      setTroop(h, 5, [list]);
      expect(eventBattle(h).n).toBeUndefined();
      expect(h.bridge._lastMessage).toBe("처음 보는 대화가 있어 그대로 싸워요");
      h.g.$gameSwitches.setValue(8, true);
      setTroop(h, 5, [list]);
      expect(eventBattle(h).n).toBe(0);
    });

    for (const operandType of [0, 1]) {
      // For each operator, one true and one false comparison (including equality boundaries).
      for (const [op, yes, no] of [[0, 5, 4], [1, 5, 4], [2, 5, 6], [3, 6, 5], [4, 4, 5], [5, 4, 5]]) {
        it(`evaluates variable comparison ${op}, operand type ${operandType} (${engine})`, () => {
          prepare(engine);
          h.g.$gameVariables.setValue(8, 5);
          const list = conditional([1, 7, operandType, operandType === 0 ? 5 : 8, op]);
          h.g.$gameVariables.setValue(7, no);
          setTroop(h, 5, [list]);
          expect(eventBattle(h).n).toBe(0);
          h.g.$gameVariables.setValue(7, yes);
          setTroop(h, 5, [list]);
          expect(eventBattle(h).n).toBeUndefined();
        });
      }
    }

    it.each([0, 1])(`evaluates switch ON / OFF conditions without an Else (${engine}, %s)`, onOff => {
      prepare(engine);
      const list = conditional([0, 7, onOff]);
      h.g.$gameSwitches.setValue(7, onOff === 1);
      setTroop(h, 5, [list]);
      expect(eventBattle(h).n).toBe(0);
      h.g.$gameSwitches.setValue(7, onOff === 0);
      setTroop(h, 5, [list]);
      expect(eventBattle(h).n).toBeUndefined();
    });
  }

  it("uses strict engine equality for variable comparisons", () => {
    prepare();
    h.g.$gameVariables.setValue(7, "5");
    setTroop(h, 5, [conditional([1, 7, 0, 5, 0])]);
    expect(eventBattle(h).n).toBe(0);
    setTroop(h, 5, [conditional([1, 7, 0, 5, 5])]);
    expect(eventBattle(h).n).toBeUndefined();
  });

  it.each([[4, 1, 0], [2, "A", 0], [12, "throw new Error('must not execute')"]])("scans both arms of unknown conditions (%j)", (...params) => {
    prepare();
    h.g.$gameSelfSwitches.setValue([1, 3, "A"], true);
    const list = conditional(params, dialogue("seen"), dialogue("unseen"));
    setControl(h, { skipBattles: true, seenMessages: ["troop:5:0#1"] });
    setTroop(h, 5, [list]);
    expect(eventBattle(h).n).toBeUndefined();
    setControl(h, { skipBattles: true, seenMessages: ["troop:5:0#4"] });
    setTroop(h, 5, [list]);
    expect(eventBattle(h).n).toBeUndefined();
    setControl(h, { skipBattles: true, seenMessages: ["troop:5:0#1", "troop:5:0#4"] });
    setTroop(h, 5, [list]);
    expect(eventBattle(h).n).toBe(0);
  });

  it("scans text after End and never executes earlier switch or variable changes", () => {
    prepare();
    const list = [cmd(121, [7, 7, 0]), cmd(122, [8, 8, 0, 0, 5]),
      ...conditional([0, 7, 0]), ...conditional([1, 8, 0, 5, 0]), ...dialogue("after End")];
    setControl(h, { skipBattles: true, seenMessages: [`troop:5:0#${list.length - 2}`] });
    setTroop(h, 5, [list]);
    expect(eventBattle(h).n).toBe(0);
    expect(h.g.$gameSwitches.value(7)).toBe(false);
    expect(h.g.$gameVariables.value(8)).toBe(0);
    setControl(h, { skipBattles: true, seenMessages: ["common:999#0"] });
    setTroop(h, 5, [list]);
    expect(eventBattle(h).n).toBeUndefined();
  });

  it("follows reachable nested common events with their own keys, cycles and missing calls", () => {
    prepare();
    h.g.$dataCommonEvents[1] = { list: [cmd(117, [2]), cmd(117, [999])] };
    h.g.$dataCommonEvents[2] = { list: [cmd(117, [1]), ...conditional([1, 7, 0, 3, 0], [cmd(105)])] };
    const setup = () => setTroop(h, 5, [[cmd(117, [1])]]);
    setup();
    expect(eventBattle(h).n).toBe(0);
    h.g.$gameVariables.setValue(7, 3);
    setControl(h, { skipBattles: true, seenMessages: ["troop:5:0#2", "common:1#2"] });
    setup();
    expect(eventBattle(h).n).toBeUndefined();
    setControl(h, { skipBattles: true, seenMessages: ["common:2#2"] });
    setup();
    expect(eventBattle(h).n).toBe(0);
  });

  it("respects the common-event depth limit and revisits a shallower call on another page", () => {
    prepare();
    for (let id = 1; id <= 5; id++) h.g.$dataCommonEvents[id] = { list: [cmd(117, [id + 1])] };
    h.g.$dataCommonEvents[6] = { list: dialogue() };
    setTroop(h, 5, [[cmd(117, [1])]]);
    expect(eventBattle(h).n).toBe(0);
    setTroop(h, 5, [[cmd(117, [1])], [cmd(117, [2])]]);
    expect(eventBattle(h).n).toBeUndefined();
  });

  it.each([333, 336, 340, 353, 354])("allows battle-changing command %s only after every enemy was beaten", code => {
    for (const enemies of [[], [1], [1, 2]]) {
      prepare("MZ", enemies);
      h.g.$dataCommonEvents[1] = { list: [cmd(code)] };
      setTroop(h, 5, [[cmd(117, [1])]]);
      expect(eventBattle(h).n).toBe(enemies.length === 2 ? 0 : undefined);
      if (enemies.length !== 2) expect(h.bridge._lastMessage).toBe("대화가 있는 전투라 그대로 싸워요");
    }
  });

  it("ignores unreachable battle changes even for new enemies; reachable unseen text still blocks beaten troops", () => {
    prepare("MZ", []);
    setTroop(h, 5, [conditional([0, 7, 0], [cmd(340)])]);
    expect(eventBattle(h).n).toBe(0);
    setTroop(h, 5, [[cmd(336), ...dialogue()]]);
    expect(eventBattle(h).n).toBeUndefined();
    expect(h.bridge._lastMessage).toBe("처음 보는 대화가 있어 그대로 싸워요");
  });

  it("allows choices / input alone, but keeps the old rule with empty or unloaded seen data", () => {
    prepare("MZ", [], ["common:999#0"]);
    setTroop(h, 5, [[cmd(102), cmd(103), cmd(104)]]);
    expect(eventBattle(h).n).toBe(0);
    for (const seenMessages of [undefined, []]) {
      for (const code of [101, 102, 103, 104, 105, 333, 336, 340, 353, 354]) {
        h = newGame();
        h.fs.dirs.add(DIR);
        h.fs.writeFileSync(DEFEATED_PATH, JSON.stringify({ v: 1, enemies: [1, 2] }));
        setControl(h, { skipBattles: true, ...(seenMessages ? { seenMessages } : {}) });
        h.g.$dataCommonEvents[1] = { list: conditional([0, 7, 0], [cmd(code)]) };
        setTroop(h, 5, [[cmd(117, [1])]]);
        expect(eventBattle(h).n).toBeUndefined();
        expect(h.bridge._lastMessage).toBe("대화가 있는 전투라 그대로 싸워요");
      }
    }
  });

  it("retains lose > escape > win selection with reachable aftermath text and map self switches", () => {
    prepare();
    const list = aftermathList([], conditional([0, 7, 1]), conditional([2, "A", 0]));
    h.g.$gameSelfSwitches.setValue([1, 3, "A"], false);
    setTroop(h);
    expect(runAftermath(list)._branch[2]).toBe(1);
    h.g.$gameSelfSwitches.setValue([1, 3, "A"], true);
    setTroop(h);
    expect(runAftermath(list)._branch[2]).toBe(2);
  });

  it("keeps common-event self switches unknown even when called by a map event", () => {
    prepare();
    h.g.$dataCommonEvents[1] = { list: conditional([2, "A", 0]) };
    h.g.$gameSelfSwitches.setValue([1, 3, "A"], false);
    setTroop(h);
    expect(runAftermath(aftermathList([], [], [cmd(117, [1])]))._branch[2]).toBe(2);
  });

  it("still selects an unseen lose aftermath when a beaten story troop becomes skippable", () => {
    prepare("MZ", [1, 2], ["troop:5:1#1"]);
    setTroop(h, 5, [[cmd(336)], [cmd(340), ...dialogue("seen battle text")]]);
    expect(runAftermath(aftermathList([], [], dialogue()))._branch[2]).toBe(2);
    expect(h.g.SceneManager.pushed).toEqual([]);
    expect(battleRecs(h).at(-1)).toMatchObject({ skipped: true, result: "lose" });
    expect(h.g.$gameParty._gold).toBe(0);
  });

  it("scans conservatively when a conditional End is missing", () => {
    prepare();
    const list = conditional([0, 7, 0]);
    list.pop();
    setTroop(h, 5, [list]);
    expect(eventBattle(h).n).toBeUndefined();
  });

  it("reports a failing condition accessor and opens the normal battle scene", () => {
    prepare();
    setTroop(h, 5, [conditional([1, 7, 0, 3, 0])]);
    h.g.$gameVariables.value = () => { throw new Error("condition accessor failed"); };
    expect(eventBattle(h).n).toBeUndefined();
    expect(h.g.SceneManager.pushed).toEqual([h.g.Scene_Battle]);
    expect(h.readLog().filter(r => r.type === "error")).toContainEqual(expect.objectContaining({ message: "condition accessor failed" }));
  });
});

describe("battle skip unseen aftermath (1.25.0)", () => {
  for (const engine of ["MZ", "MV"] as const) {
    for (const [seen, expected] of [[[], 2], [[0], 2], [[1], 2], [[2], 1], [[0, 1], 2], [[0, 2], 1], [[1, 2], 0], [[0, 1, 2], 0]] as const) {
      it(`chooses allowed unseen lose > allowed unseen escape > win (${engine}, seen ${seen})`, () => {
        h = newGame(engine);
        const list = aftermathList();
        setControl(h, { skipBattles: true, seenMessages: ["common:999#0", ...seenOutcomes(list, [...seen])] });
        const enemies = setTroop(h);
        if (expected !== 0) {
          h.g.$gameParty._battlers[0]._hp = 3;
          h.g.$gameParty._battlers[1].addNewState(1); // a defeated party member must stay defeated
        }
        const actorsBefore = JSON.stringify(h.g.$gameParty._battlers);
        const interp = runAftermath(list);
        expect(interp._branch[2]).toBe(expected);
        expect(h.g.SceneManager.pushed).toEqual([]);
        expect(h.g.BattleManager._phase).toBeNull();
        const end = battleRecs(h).at(-1);
        expect(end).toMatchObject({ phase: "end", skipped: true, result: ["win", "escape", "lose"][expected] });
        if (expected !== 0) {
          expect(enemies.every((e: any) => e.isAlive())).toBe(true);
          expect(JSON.stringify(h.g.$gameParty._battlers)).toBe(actorsBefore);
          expect(h.g.$gameParty._gold).toBe(0);
          expect(h.g.$gameParty._items).toEqual({});
          expect(h.g.BattleManager._rewards).toBeNull();
          expect(h.g.BattleManager.wins).toBe(0);
          expect(defeatedOnDisk(h)).toBeUndefined();
          expect(end).not.toHaveProperty("rewards");
          const hint = [0, 2, 1].filter(result => result !== expected && !(seen as readonly number[]).includes(result))
            .map(result => ` · ${["승리", "도망", "패배"][result]} 장면은 아직 안 봄`).join("");
          expect(h.bridge._lastMessage).toBe((expected === 2 ? "전투 건너뜀(짐) — 처음 보는 패배 장면" : "전투 건너뜀(도망) — 처음 보는 도망 장면") + hint);
        } else {
          expect(h.bridge._lastMessage).not.toContain("아직 안 봄");
        }
        // Continue through the actual 601/602/603 handlers; only the selected dialogue runs.
        while (interp._index < list.length) {
          h.runCommand(interp, interp._index);
          if (h.g.$gameMessage.isBusy()) h.g.$gameMessage.clear();
        }
        expect(h.readLog().filter(r => r.type === "message").map(r => r.text)).toEqual([["win", "escape", "lose"][expected]]);
      });
    }
  }

  it.each([undefined, []])("keeps winning with unknown / empty seen data (%s)", seenMessages => {
    h = newGame();
    setControl(h, { skipBattles: true, ...(seenMessages ? { seenMessages } : {}) });
    setTroop(h);
    expect(runAftermath(aftermathList([], dialogue(), dialogue()))._branch[2]).toBe(0);
    expect(h.bridge._lastMessage).not.toContain("아직 안 봄");
  });

  it.each([[false, true, 1], [true, false, 2], [false, false, 0]])("respects canLose=%s, canEscape=%s", (canLose, canEscape, result) => {
    h = newGame();
    setControl(h, { skipBattles: true, seenMessages: ["common:999#0"] });
    setTroop(h);
    expect(runAftermath(aftermathList(dialogue(), dialogue(), dialogue(), !!canEscape, !!canLose))._branch[2]).toBe(result);
  });

  it("tells a winning player about both unseen alternative routes", () => {
    h = newGame();
    setControl(h, { skipBattles: true, seenMessages: ["common:999#0"] });
    setTroop(h);
    expect(runAftermath(aftermathList(undefined, undefined, undefined, false, false))._branch[2]).toBe(0);
    expect(h.bridge._lastMessage).toContain(" · 패배 장면은 아직 안 봄 · 도망 장면은 아직 안 봄");
  });

  for (const source of [mapSource, { ...mapSource, origin: 1 }, { source: "common", commonEventId: 9 }, { source: "troop", troopId: 9, page: 0 }] as Location[]) {
    it(`uses viewer seen keys for ${JSON.stringify(source)}`, () => {
      h = newGame();
      const list = aftermathList();
      setControl(h, { skipBattles: true, seenMessages: seenOutcomes(list, [0, 1, 2], source) });
      setTroop(h);
      expect(runAftermath(list, source)._branch[2]).toBe(0);
      expect(h.bridge._lastMessage).not.toContain("아직 안 봄");
    });
  }

  it("ignores choices (the viewer sends no choice keys): a choice-only branch is never new", () => {
    h = newGame();
    const list = aftermathList([], [], [cmd(102)]);
    setControl(h, { skipBattles: true, seenMessages: ["common:999#0"] });
    setTroop(h);
    expect(runAftermath(list)._branch[2]).toBe(0);
  });

  it.each([101, 105])("detects unseen command %s using its exact command index", code => {
    h = newGame();
    const list = aftermathList([], [], [cmd(code)]);
    setControl(h, { skipBattles: true, seenMessages: ["common:999#0"] });
    setTroop(h);
    expect(runAftermath(list)._branch[2]).toBe(2);
    setControl(h, { skipBattles: true, seenMessages: seenOutcomes(list, [2]) });
    setTroop(h);
    expect(runAftermath(list)._branch[2]).toBe(0);
  });

  it("uses each nested common event's own key; seen calls do not make a branch new", () => {
    h = newGame();
    h.g.$dataCommonEvents[1] = { list: [cmd(117, [2]), cmd(0)] };
    h.g.$dataCommonEvents[2] = { list: [cmd(105), cmd(405, ["nested"]), cmd(0)] };
    const list = aftermathList([], [], [cmd(117, [1])]);
    // A map key at the common event's index must not hide its dialogue.
    setControl(h, { skipBattles: true, seenMessages: [seenKey(mapSource, 0)] });
    setTroop(h);
    expect(runAftermath(list)._branch[2]).toBe(2);
    setControl(h, { skipBattles: true, seenMessages: ["common:2#0"] });
    setTroop(h);
    expect(runAftermath(list)._branch[2]).toBe(0);
  });

  it("handles common-event cycles, missing events and empty branches", () => {
    h = newGame();
    setControl(h, { skipBattles: true, seenMessages: ["common:999#0"] });
    h.g.$dataCommonEvents[1] = { list: [cmd(117, [2]), cmd(0)] };
    h.g.$dataCommonEvents[2] = { list: [cmd(117, [1]), cmd(117, [999]), cmd(121, [1, 1, 0]), cmd(0)] };
    setTroop(h);
    expect(runAftermath(aftermathList([], [], [cmd(117, [1])]))._branch[2]).toBe(0);
    h.g.$dataCommonEvents[2].list.push(...dialogue());
    setTroop(h);
    expect(runAftermath(aftermathList([], [], [cmd(117, [1])]))._branch[2]).toBe(2);
  });

  it("scans up to STORY_SCAN_DEPTH=5, including a later call with a shallower path", () => {
    h = newGame();
    setControl(h, { skipBattles: true, seenMessages: ["common:999#0"] });
    for (let id = 1; id <= 5; id++) h.g.$dataCommonEvents[id] = { list: [cmd(117, [id + 1]), cmd(0)] };
    h.g.$dataCommonEvents[6] = { list: dialogue() };
    setTroop(h);
    expect(runAftermath(aftermathList([], [], [cmd(117, [1])]))._branch[2]).toBe(0);
    setTroop(h);
    expect(runAftermath(aftermathList([], [], [cmd(117, [1]), cmd(117, [2])]))._branch[2]).toBe(2);
  });

  it("does not mix visited common events between outcomes", () => {
    h = newGame();
    h.g.$dataCommonEvents[1] = { list: dialogue() };
    setControl(h, { skipBattles: true, seenMessages: ["common:999#0"] });
    setTroop(h);
    expect(runAftermath(aftermathList([cmd(117, [1])], [], [cmd(117, [1])]))._branch[2]).toBe(2);
    expect(h.bridge._lastMessage).toContain("승리 장면은 아직 안 봄");
    expect(h.bridge._lastMessage).not.toContain("패배 장면은 아직 안 봄");
  });

  it.each([604, 108, -1])("stops at branch end / unrelated command / outer indent (%s)", boundary => {
    h = newGame();
    setControl(h, { skipBattles: true, seenMessages: ["common:999#0"] });
    const list = aftermathList([], [], []);
    list.splice(3, list.length, cmd(boundary === -1 ? 603 : boundary, [], boundary === -1 ? 1 : 2), cmd(603, [], 2), ...dialogue().map(c => ({ ...c, indent: 3 })), cmd(604, [], 2));
    setTroop(h);
    expect(runAftermath(list)._branch[2]).toBe(0);
  });

  it("nested battle markers cannot create an outer lose branch", () => {
    h = newGame();
    const list = aftermathList([cmd(603), ...dialogue().map(c => ({ ...c, indent: 1 })), cmd(604)], [], []);
    setControl(h, { skipBattles: true, seenMessages: seenOutcomes(list, [0]) });
    setTroop(h);
    expect(runAftermath(list)._branch[2]).toBe(0);
    expect(h.bridge._lastMessage).not.toContain("아직 안 봄");
  });

  it("no outcome markers means no aftermath to select", () => {
    h = newGame();
    setControl(h, { skipBattles: true, seenMessages: ["common:999#0"] });
    setTroop(h);
    expect(runAftermath([cmd(108), cmd(301, [0, 5, true, true]), ...dialogue(), cmd(0)])._branch[0]).toBe(0);
  });

  it.each([1, 2])("falls back to cb(result=%s) exactly once when endBattle omits the callback", result => {
    h = newGame();
    setControl(h, { skipBattles: true, seenMessages: ["common:999#0"] });
    const BM = h.g.BattleManager, end = BM.endBattle;
    let calls = 0;
    const setCallback = BM.setEventCallback;
    BM.setEventCallback = function (cb: (n: number) => void) { setCallback.call(this, (n: number) => { calls++; cb(n); }); };
    BM.endBattle = function (n: number) {
      const cb = this._eventCallback;
      this._eventCallback = null;
      try { end.call(this, n); } finally { this._eventCallback = cb; }
    };
    setTroop(h);
    expect(runAftermath(aftermathList([], result === 1 ? dialogue() : [], result === 2 ? dialogue() : []))._branch[2]).toBe(result);
    expect(calls).toBe(1);
    expect(battleRecs(h).at(-1)).toMatchObject({ result: result === 1 ? "escape" : "lose", skipped: true });
  });

  it("clears event context when command301 returns, including battles that were fought normally", () => {
    h = newGame();
    setControl(h, { seenMessages: ["common:999#0"] });
    setTroop(h);
    runAftermath(aftermathList([], [], dialogue())); // not skipped
    h.g.BattleManager.endBattle(0);
    setControl(h, { skipBattles: true });
    setTroop(h);
    expect(eventBattle(h).n).toBe(0); // symbol encounter: no command301 context
  });

  it("clears event context when command301 throws", () => {
    h = newGame();
    setControl(h, { skipBattles: true, seenMessages: ["common:999#0"] });
    setTroop(h);
    const BM = h.g.BattleManager, setup = BM.setup;
    BM.setup = () => { throw new Error("setup failed"); };
    expect(() => runAftermath(aftermathList([], [], dialogue()))).toThrow("setup failed");
    BM.setup = setup;
    expect(eventBattle(h).n).toBe(0);
  });

  it("preserves the story-troop and unknown-enemy rules even with an unseen lose branch", () => {
    h = newGame();
    setControl(h, { skipBattles: true, seenMessages: ["common:999#0"] });
    setTroop(h, 5, [dialogue()]);
    expect(runAftermath(aftermathList([], [], dialogue()))._branch[2]).toBeUndefined();
    h.g.BattleManager.endBattle(0);
    setControl(h, { skipBattles: true, skipKnownOnly: true, seenMessages: ["common:999#0"] });
    setTroop(h);
    expect(runAftermath(aftermathList([], [], dialogue()))._branch[2]).toBeUndefined();
    expect(h.g.SceneManager.pushed).toHaveLength(2);
  });
});

describe("battle skip (1.24.0)", () => {
  for (const engine of ["MZ", "MV"] as const) {
    it(`a skipped battle is a win with the engine's rewards, no battle scene, the event's win branch (${engine})`, () => {
      h = newGame(engine);
      setControl(h, { skipBattles: true });
      const enemies = setTroop(h);
      const [a1, a2] = h.g.$gameParty._battlers;
      const branch = eventBattle(h);
      expect(h.g.SceneManager.pushed).toEqual([]);
      expect(branch.n).toBe(0);
      expect(enemies.map((e: any) => e.isAlive())).toEqual([false, false]);
      expect(h.g.$gameParty._gold).toBe(12);
      expect(h.g.$gameParty._items).toEqual({ 1: 1 });
      expect([a1._exp, a2._exp]).toEqual([250, 250]); // 150 exp each: level 1 -> 2
      expect([a1.lastShow, a2.lastShow]).toEqual([false, false]); // no level-up message on the map
      expect(Object.prototype.hasOwnProperty.call(a1, "shouldDisplayLevelUp")).toBe(false);
      expect(h.g.BattleManager._phase).toBeNull();
      expect(h.g.BattleManager.wins).toBe(1);
      expect(h.g.BattleManager._eventCallback).not.toBeNull(); // the original callback stays (no wrapper left)
      const [start, end] = battleRecs(h);
      expect(start).toMatchObject({ phase: "start", troopId: 5, troopName: "슬라임과 박쥐" });
      expect(end).toMatchObject({ phase: "end", troopId: 5, result: "win", skipped: true, rewards: { exp: 150, gold: 12, items: ["포션"] } });
      expect(defeatedOnDisk(h)).toEqual({ v: 1, enemies: [1, 2] });
      expect(h.bridge._lastMessage).toBe("전투 건너뜀(이김) — 경험치 150 · 골드 12 · 포션 · 레벨 업 해롤드, 테레즈");
      h.bridge._snapshotNow();
      expect(h.readLive().assist).toMatchObject({ skipBattles: true, skipKnownOnly: false, noRandomEncounter: false, knownEnemies: 2 });
    });
  }

  it("off (default): the battle scene opens as usual", () => {
    h = newGame();
    setTroop(h);
    const branch = eventBattle(h);
    expect(h.g.SceneManager.pushed).toEqual([h.g.Scene_Battle]);
    expect(branch.n).toBeUndefined();
    expect(h.g.$gameParty._gold).toBe(0);
    setControl(h, { skipBattles: false, skipKnownOnly: true });
    eventBattle(h);
    expect(h.g.SceneManager.pushed).toHaveLength(2);
  });

  it("a random encounter (no event callback) is skipped too", () => {
    h = newGame();
    setControl(h, { skipBattles: true });
    setTroop(h, 1);
    const player = h.g.$gamePlayer;
    for (let i = 0; i < 3; i++) player.updateEncounterCount();
    // Scene_Map.updateEncounter
    if (player.executeEncounter()) h.g.SceneManager.push(h.g.Scene_Battle);
    expect(h.g.SceneManager.pushed).toEqual([]);
    expect(h.g.$gameParty._gold).toBe(12);
    expect(battleRecs(h).map((r) => r.phase)).toEqual(["start", "end"]);
  });

  it("story battles (text, choices, enemy state, abort… also inside a called common event) are fought normally", () => {
    h = newGame();
    setControl(h, { skipBattles: true });
    h.g.$dataCommonEvents = [null, { list: [cmd(121, [1, 1, 0]), cmd(0)] }, { list: [cmd(117, [1]), cmd(101, ["", 0, 0, 2]), cmd(0)] }];
    for (const pages of [
      [[cmd(0)], [cmd(101, ["", 0, 0, 2]), cmd(401, ["안녕"]), cmd(0)]],
      [[cmd(102, [["예", "아니오"]]), cmd(0)]],
      [[cmd(333, [0, 0, 5]), cmd(0)]],
      [[cmd(340), cmd(0)]],
      [[cmd(117, [2]), cmd(0)]],
    ]) {
      setTroop(h, 7, pages);
      const branch = eventBattle(h, 7);
      expect(branch.n).toBeUndefined();
    }
    expect(h.g.SceneManager.pushed).toHaveLength(5);
    expect(h.bridge._lastMessage).toBe("대화가 있는 전투라 그대로 싸워요");
    // switches and other common events alone do not make a story battle
    setTroop(h, 8, [[cmd(117, [1]), cmd(121, [2, 2, 0]), cmd(0)]]);
    expect(eventBattle(h, 8).n).toBe(0);
    expect(h.g.SceneManager.pushed).toHaveLength(5);
  });

  it("not skipped when the party has nobody standing, or the troop is missing from the data", () => {
    h = newGame();
    setControl(h, { skipBattles: true });
    setTroop(h);
    for (const a of h.g.$gameParty._battlers) a.addNewState(1);
    eventBattle(h);
    expect(h.g.SceneManager.pushed).toHaveLength(1);
    for (const a of h.g.$gameParty._battlers) a.removeState(1);
    h.g.$gameTroop._enemies = [new h.g.Game_Enemy(1)];
    eventBattle(h, 99); // no $dataTroops[99]
    expect(h.g.SceneManager.pushed).toHaveLength(2);
  });

  it("a push without a battle set up just before is left alone (scenes other than battle, a second push)", () => {
    h = newGame();
    setControl(h, { skipBattles: true });
    h.g.SceneManager.push(h.g.Scene_Battle); // no BattleManager.setup
    h.g.SceneManager.push(h.g.Scene_Map);
    expect(h.g.SceneManager.pushed).toEqual([h.g.Scene_Battle, h.g.Scene_Map]);
  });

  it("a failing reward step still ends the battle as a win (nothing waits for a scene)", () => {
    h = newGame();
    setControl(h, { skipBattles: true });
    setTroop(h);
    h.g.BattleManager.gainRewards = () => { throw new Error("broken"); };
    const branch = eventBattle(h);
    expect(branch.n).toBe(0);
    expect(h.g.SceneManager.pushed).toEqual([]);
    expect(h.g.BattleManager._phase).toBeNull();
  });
});

describe("잡아 본 적만 (1.24.0)", () => {
  it("skips only troops whose every enemy was beaten before; normal and skipped wins both count, saved per game", () => {
    h = newGame();
    setControl(h, { skipBattles: true, skipKnownOnly: true });
    setTroop(h);
    expect(eventBattle(h).n).toBeUndefined(); // never beaten: fought
    expect(h.bridge._lastMessage).toBe("처음 보는 적이 있어 그대로 싸워요");
    // the normal battle is won
    new h.g.Scene_Battle().start();
    for (const e of h.g.$gameTroop._enemies) e.addNewState(1);
    h.g.BattleManager.processVictory();
    expect(defeatedOnDisk(h)).toEqual({ v: 1, enemies: [1, 2] });
    // the same troop now skips
    setTroop(h);
    expect(eventBattle(h).n).toBe(0);
    expect(h.g.SceneManager.pushed).toHaveLength(1);
    // a new enemy (3) with known ones: fought; a lost / escaped battle does not count
    setTroop(h, 6, [[cmd(0)]], [1, 3]);
    expect(eventBattle(h, 6).n).toBeUndefined();
    h.g.$gameTroop._enemies[1].addNewState(1);
    h.g.BattleManager.endBattle(1);
    expect(defeatedOnDisk(h).enemies).toEqual([1, 2]);
    // without 잡아 본 적만 it is skipped, and then enemy 3 is known
    setControl(h, { skipBattles: true, skipKnownOnly: false });
    setTroop(h, 6, [[cmd(0)]], [1, 3]);
    expect(eventBattle(h, 6).n).toBe(0);
    expect(defeatedOnDisk(h).enemies).toEqual([1, 2, 3]);

    // next session (same game folder): the list is read back
    const fs = h.fs;
    h.bridge._flushNow();
    h = newGame("MZ", fs);
    setControl(h, { skipBattles: true, skipKnownOnly: true });
    setTroop(h, 6, [[cmd(0)]], [3, 1]);
    expect(eventBattle(h, 6).n).toBe(0);
    h.bridge._snapshotNow();
    expect(h.readLive().assist.knownEnemies).toBe(3);
  });

  it("a hidden enemy that never appeared is not counted as beaten", () => {
    h = newGame();
    const es = setTroop(h);
    h.g.BattleManager.setup(5, true, false);
    new h.g.Scene_Battle().start();
    es[0].addNewState(1);
    es[1].isDead = () => false; // hidden (not appeared): not dead
    es[1].isAlive = () => false;
    h.g.BattleManager.processVictory();
    expect(defeatedOnDisk(h)).toEqual({ v: 1, enemies: [1] });
  });

  it("a broken defeated.json reads as empty and is rewritten on the next win", () => {
    h = newGame();
    h.fs.dirs.add(DIR);
    h.fs.writeFileSync(DEFEATED_PATH, "{not json");
    setControl(h, { skipBattles: true, skipKnownOnly: true });
    setTroop(h);
    expect(eventBattle(h).n).toBeUndefined();
    setControl(h, { skipBattles: true });
    setTroop(h);
    expect(eventBattle(h).n).toBe(0);
    expect(defeatedOnDisk(h)).toEqual({ v: 1, enemies: [1, 2] });
  });
});

describe("랜덤 전투 끄기 (1.24.0)", () => {
  it("steps do not count down and no random encounter starts while on; back to normal when off", () => {
    h = newGame();
    setTroop(h, 1);
    const player = h.g.$gamePlayer;
    setControl(h, { noRandomEncounter: true });
    player._encounterCount = 0; // already due when turned on
    for (let i = 0; i < 10; i++) player.updateEncounterCount();
    expect(player._encounterCount).toBe(0);
    expect(player.executeEncounter()).toBe(false);
    expect(battleRecs(h)).toEqual([]);
    h.bridge._snapshotNow();
    expect(h.readLive().assist.noRandomEncounter).toBe(true);
    setControl(h, { noRandomEncounter: false });
    expect(player.executeEncounter()).toBe(true);
    player.updateEncounterCount();
    expect(player._encounterCount).toBe(2);
  });
});
