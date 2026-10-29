import { afterEach, describe, expect, it } from "vitest";
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
