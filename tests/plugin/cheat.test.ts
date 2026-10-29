import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";

let h: Harness;
afterEach(() => { h?.bridge?._flushNow(); });

const CONTROL_PATH = "/game/www/rpg-viewer/control.json";

/** New game with a small database: items 1-3, weapon 1, armor 1, actors 1-2 (1 in the party), skills 1-3, states 1-4, 10 switches/variables. */
function newGame(): Harness {
  const hh = createHarness();
  Object.assign(hh.g, {
    $dataItems: [null, { id: 1, name: "포션" }, { id: 2, name: "에테르" }, null],
    $dataWeapons: [null, { id: 1, name: "검" }],
    $dataArmors: [null, { id: 1, name: "방패" }],
    $dataActors: [null, { id: 1, name: "해롤드" }, { id: 2, name: "테레즈" }],
    $dataSkills: [null, { id: 1 }, { id: 2 }, { id: 3 }],
    $dataStates: [null, { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
    $dataSystem: { switches: new Array(11).fill(""), variables: new Array(11).fill("") },
  });
  hh.g.DataManager.setupNewGame();
  hh.g.SceneManager._scene = new hh.g.Scene_Map();
  hh.g.$gameParty._actors = [1];
  hh.g.$gameParty._battlers = [hh.g.$gameActors.actor(1)];
  return hh;
}

let seq = 0;
/** Writes a cheat command, lets the bridge poll and run it, returns live.json assist.lastCommand. */
function cheat(hh: Harness, ops: unknown, extra: Record<string, unknown> = {}): string {
  const id = `x-${++seq}`;
  hh.clock.t += 1000;
  hh.fs.dirs.add("/game/www/rpg-viewer");
  hh.fs.writeFileSync(CONTROL_PATH, JSON.stringify({ v: 1, t: hh.clock.t, command: { id, kind: "cheat", at: hh.clock.t, ops }, ...extra }));
  hh.bridge._tick();
  hh.bridge._frame();
  hh.bridge._snapshotNow();
  const last: string = hh.readLive().assist.lastCommand;
  return last === id ? "ok" : last.startsWith(id + ":") ? last.slice(id.length + 1) : `other:${last}`;
}

describe("cheat commands (1.14.0)", () => {
  it("items: gain (clamped to 0..99), set, negative amounts; never counts equipment", () => {
    h = newGame();
    const p = h.g.$gameParty;
    expect(cheat(h, [{ op: "gainItem", type: "item", id: 1, amount: 5 }, { op: "gainItem", type: "weapon", id: 1, amount: 150 }])).toBe("ok");
    expect([p._items[1], p._weapons[1], p.lastIncludeEquip]).toEqual([5, 99, false]);
    expect(cheat(h, [{ op: "gainItem", type: "item", id: 1, amount: -9 }, { op: "setItem", type: "armor", id: 1, count: 7 }])).toBe("ok");
    expect([p._items[1], p._armors[1]]).toEqual([undefined, 7]);
    expect(cheat(h, [{ op: "setItem", type: "armor", id: 1, count: 2 }])).toBe("ok");
    expect(p._armors[1]).toBe(2);
    expect(h.g.$gameMap.refreshes).toBe(3);
  });

  it("gold: set or add, clamped by the engine", () => {
    h = newGame();
    const p = h.g.$gameParty;
    expect(cheat(h, [{ op: "gold", set: 500 }])).toBe("ok");
    expect(p._gold).toBe(500);
    expect(cheat(h, [{ op: "gold", add: -800 }])).toBe("ok");
    expect(p._gold).toBe(0);
    expect(cheat(h, [{ op: "gold", add: 120 }])).toBe("ok");
    expect(p._gold).toBe(120);
  });

  it("actor ops: level (no level-up message), exp, params, recover, skills, states — also for actors outside the party", () => {
    h = newGame();
    const a = h.g.$gameActors.actor(1);
    expect(cheat(h, [{ op: "level", actorId: 1, level: 30 }])).toBe("ok");
    expect([a.level, a.lastShow]).toEqual([30, false]);
    expect(cheat(h, [{ op: "level", actorId: 1, level: 500 }])).toBe("ok");
    expect(a.level).toBe(99);
    expect(cheat(h, [{ op: "exp", actorId: 1, add: -9850 }])).toBe("ok");
    expect([a.currentExp(), a.level]).toEqual([50, 1]);
    expect(cheat(h, [{ op: "param", actorId: 1, paramId: 2, add: 100 }, { op: "param", actorId: 1, paramId: 0, add: -5 }])).toBe("ok");
    expect([a.param(0), a.param(2)]).toEqual([5, 130]);
    a._hp = 3; a._states = [2];
    expect(cheat(h, [{ op: "recover", actorId: null }])).toBe("ok");
    expect([a.hp, a._states]).toEqual([100, []]);
    expect(cheat(h, [{ op: "learnSkill", actorId: 2, skillId: 3 }, { op: "addState", actorId: 2, stateId: 4 }])).toBe("ok");
    const b = h.g.$gameActors.actor(2);
    expect([b._skills, b._states]).toEqual([[3], [4]]);
    expect(cheat(h, [{ op: "forgetSkill", actorId: 2, skillId: 3 }, { op: "removeState", actorId: 2, stateId: 4 }, { op: "recover", actorId: 2 }])).toBe("ok");
    expect([b._skills, b._states]).toEqual([[], []]);
  });

  it("switches, variables (number or string) and self switches", () => {
    h = newGame();
    expect(cheat(h, [
      { op: "switch", id: 3, value: true }, { op: "variable", id: 4, value: 12 }, { op: "variable", id: 5, value: "abc" },
      { op: "selfSwitch", mapId: 2, eventId: 7, letter: "C", value: true },
    ])).toBe("ok");
    expect(h.g.$gameSwitches.value(3)).toBe(true);
    expect(h.g.$gameVariables.value(4)).toBe(12);
    expect(h.g.$gameVariables.value(5)).toBe("abc");
    expect(h.g.$gameSelfSwitches.value([2, 7, "C"])).toBe(true);
    // recorded like any other state change
    const st = h.readLog().filter((r) => r.type === "state").flatMap((r) => r.changes);
    expect(st).toEqual(expect.arrayContaining([{ kind: "switch", id: 3, value: true }, { kind: "variable", id: 4, value: 12 }]));
  });

  it("rejects bad ops and applies nothing (all or nothing)", () => {
    h = newGame();
    const p = h.g.$gameParty;
    const good = { op: "gainItem", type: "item", id: 1, amount: 1 };
    const bad: unknown[] = [
      { op: "gainItem", type: "item", id: 3, amount: 1 },       // null entry
      { op: "gainItem", type: "item", id: 9, amount: 1 },       // out of range
      { op: "gainItem", type: "skill", id: 1, amount: 1 },      // bad type
      { op: "gainItem", type: "item", id: 1, amount: 1.5 },     // not an integer
      { op: "setItem", type: "item", id: 1, count: -1 },
      { op: "gold", set: 1, add: 1 }, { op: "gold" }, { op: "gold", add: "5" },
      { op: "level", actorId: 3, level: 5 }, { op: "level", actorId: 1, level: 0 },
      { op: "param", actorId: 1, paramId: 8, add: 1 }, { op: "recover" }, { op: "recover", actorId: 9 },
      { op: "learnSkill", actorId: 1, skillId: 4 }, { op: "addState", actorId: 1, stateId: 0 },
      { op: "switch", id: 11, value: true }, { op: "switch", id: 1, value: 1 },
      { op: "variable", id: 0, value: 1 }, { op: "variable", id: 1, value: "x".repeat(1001) }, { op: "variable", id: 1, value: NaN },
      { op: "selfSwitch", mapId: 1, eventId: 1, letter: "E", value: true }, { op: "eval", code: "1" }, null, "gold",
    ];
    for (const b of bad) {
      expect(cheat(h, [good, b]), JSON.stringify(b)).toBe("failed:1");
    }
    expect(p._items[1]).toBeUndefined();
    expect(cheat(h, [])).toBe("failed:0");
    expect(cheat(h, "nope")).toBe("failed:0");
    expect(cheat(h, new Array(51).fill(good))).toBe("failed:0");
    expect(cheat(h, new Array(50).fill(good))).toBe("ok");
    expect(p._items[1]).toBe(50);
  });

  it("an op that throws stops there (failed:<index>) without throwing", () => {
    h = newGame();
    h.g.$gameActors.actor(1).addParam = () => { throw new Error("broken"); };
    expect(cheat(h, [{ op: "gold", add: 5 }, { op: "param", actorId: 1, paramId: 0, add: 1 }, { op: "gold", add: 5 }])).toBe("failed:1");
    expect(h.g.$gameParty._gold).toBe(5);
  });

  it("ignores stale commands; works in battle and refreshes the status window", () => {
    h = newGame();
    h.clock.t += 1000;
    h.fs.dirs.add("/game/www/rpg-viewer");
    h.fs.writeFileSync(CONTROL_PATH, JSON.stringify({ v: 1, t: h.clock.t, command: { id: "old", kind: "cheat", at: h.clock.t - 11_000, ops: [{ op: "gold", add: 5 }] } }));
    h.bridge._tick();
    h.bridge._frame();
    h.bridge._snapshotNow();
    expect(h.readLive().assist.lastCommand).toBe("old:ignored");
    expect(h.g.$gameParty._gold).toBe(0);
    h.g.BattleManager.setup(4);
    h.g.BattleManager._phase = "input";
    h.g.SceneManager._scene = new h.g.Scene_Battle();
    expect(cheat(h, [{ op: "recover", actorId: null }])).toBe("ok");
    expect(h.g.BattleManager.calls).toContain("refreshStatus");
  });

  it("live.json carries party actors only while liveActors is on", () => {
    h = newGame();
    h.bridge._snapshotNow();
    expect(h.readLive().actors).toBeUndefined();
    expect(cheat(h, [{ op: "learnSkill", actorId: 1, skillId: 2 }], { liveActors: true })).toBe("ok");
    expect(h.readLive().actors).toEqual([
      { id: 1, name: "해롤드", level: 1, exp: 100, params: [10, 20, 30, 40, 50, 60, 70, 80], hp: 100, mp: 10, skills: [2], states: [] },
    ]);
    expect(cheat(h, [{ op: "gold", add: 1 }])).toBe("ok");
    expect(h.readLive().actors).toBeUndefined();
  });

  it("live.json always carries actor names changed in play (1.20.1), also for actors outside the party", () => {
    h = newGame();
    h.g.$gameActors.actor(2); // created, name unchanged
    h.bridge._snapshotNow();
    expect(h.readLive().actorNames).toBeUndefined();
    h.g.$gameActors.actor(1).setName("아마네");
    h.g.$gameActors.actor(2).setName("테레즈");
    h.clock.t += 1000;
    h.bridge._snapshotNow();
    expect(h.readLive().actorNames).toEqual({ 1: "아마네" });
    h.g.$gameActors.actor(2).setName("리나");
    h.clock.t += 1000;
    h.bridge._snapshotNow();
    expect(h.readLive().actorNames).toEqual({ 1: "아마네", 2: "리나" });
  });

  it("a broken actor does not stop the snapshot or the other names", () => {
    h = newGame();
    h.g.$gameActors.actor(1).name = () => { throw new Error("broken"); };
    h.g.$gameActors.actor(2).setName("리나");
    h.bridge._snapshotNow();
    expect(h.readLive().actorNames).toEqual({ 2: "리나" });
  });
});
