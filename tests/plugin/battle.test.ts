import { afterEach, describe, expect, it } from "vitest";
import { cmd, createHarness, LOG_PATH, type Harness } from "./harness";

let h: Harness;
afterEach(() => { h?.bridge?._flushNow(); });

const CONTROL_PATH = "/game/www/rpg-viewer/control.json";

function newGame(engine: "MZ" | "MV" = "MZ"): Harness {
  const harness = createHarness({ engine });
  harness.g.DataManager.setupNewGame();
  return harness;
}
const setCapture = (hh: Harness, on: boolean) => {
  hh.fs.dirs.add("/game/www/rpg-viewer");
  hh.fs.writeFileSync(CONTROL_PATH, JSON.stringify({ v: 1, t: hh.clock.t, capturePictures: on }));
  hh.clock.t += 1000;
  hh.bridge._tick();
};
const enemy = (name: string) => ({ name: () => name, isAlive: () => true });
function startBattle(hh: Harness, troopId = 3, enemies = ["슬라임 A", "슬라임 B"]) {
  hh.g.$dataTroops[troopId] = { id: troopId, name: "슬라임*2", pages: [] };
  hh.g.$gameTroop._enemies = enemies.map(enemy);
  hh.g.BattleManager.setup(troopId, true, false);
  new hh.g.Scene_Battle().start();
}
const log = (hh: Harness) => hh.readLog();
const battleRecs = (hh: Harness) => log(hh).filter((r) => r.type === "battle" || r.type === "battlelog");
const onDisk = (hh: Harness) => (hh.fs.files.get(LOG_PATH) ?? "").split("\n").filter((l) => l).map((l) => JSON.parse(l));

describe("battle log (1.8.0)", () => {
  for (const engine of ["MZ", "MV"] as const) {
    it(`records start (troop name, enemies, flags), log lines and the result with rewards (${engine})`, () => {
      h = newGame(engine);
      startBattle(h);
      const w = new h.g.Window_BattleLog();
      h.g.$gameMessage.add("슬라임 A이(가) 나타났다!"); // BattleManager.displayStartMessages
      h.clock.t += 500;
      w.addText("\\N[1]의 공격!");
      w.addText("슬라임 A에게 12의 데미지!");
      h.clock.t += 500;
      h.g.BattleManager._rewards = { exp: 10, gold: 25, items: [{ name: "포션" }, null, { name: "\\C[2]열쇠" }] };
      h.g.$gameMessage.add("승리했다!");
      h.g.BattleManager.endBattle(0);
      expect(battleRecs(h)).toEqual([
        expect.objectContaining({ type: "battle", phase: "start", troopId: 3, troopName: "슬라임*2", enemies: ["슬라임 A", "슬라임 B"], canEscape: true, canLose: false }),
        expect.objectContaining({ type: "battlelog", text: "슬라임 A이(가) 나타났다!" }),
        expect.objectContaining({ type: "battlelog", text: "\\N[1]의 공격!" }),
        expect.objectContaining({ type: "battlelog", text: "슬라임 A에게 12의 데미지!" }),
        expect.objectContaining({ type: "battlelog", text: "승리했다!" }),
        expect.objectContaining({ type: "battle", phase: "end", result: "win", rewards: { exp: 10, gold: 25, items: ["포션", "\\C[2]열쇠"] } }),
      ]);
      expect(log(h).find((r) => r.type === "battle" && r.phase === "end")).not.toHaveProperty("dropped");
    });
  }

  it("lose, escape and abort", () => {
    h = newGame();
    const BM = h.g.BattleManager;
    startBattle(h);
    BM.endBattle(2);
    startBattle(h);
    BM._escaped = true;
    BM.endBattle(1);
    startBattle(h);
    BM.endBattle(1); // Abort Battle: ends with 1 without escaping
    const ends = log(h).filter((r) => r.type === "battle" && r.phase === "end");
    expect(ends.map((r) => r.result)).toEqual(["lose", "escape", "abort"]);
    expect(ends.every((r) => !("rewards" in r))).toBe(true);
  });

  it("troop event Show Text stays a message (not a log line); nothing is logged outside battle", () => {
    h = newGame();
    h.g.$gameMessage.add("map text added by a plugin");
    new h.g.Window_BattleLog().addText("stray");
    startBattle(h);
    const list = [cmd(101, ["", 0, 0, 2, ""]), cmd(401, ["대장: 덤벼라!"]), cmd(0)];
    const interp = h.g.$gameTroop._interpreter;
    interp.setup(list, 0);
    h.runCommand(interp, 0);
    h.g.BattleManager.endBattle(0);
    new h.g.Window_BattleLog().addText("after the battle");
    const recs = log(h).slice(1);
    expect(recs.map((r) => r.type)).toEqual(["battle", "message", "battle"]);
    expect(recs[1]).toMatchObject({ text: "대장: 덤벼라!" });
  });

  it("battle records are not story records: a load right after a battle continues the branch", () => {
    h = newGame("MV");
    h.g.DataManager.saveGame(1);
    startBattle(h);
    new h.g.Window_BattleLog().addText("공격!");
    h.g.BattleManager.endBattle(0);
    h.g.DataManager.loadGame(1);
    expect(log(h).filter((r) => r.type === "branchStart")).toHaveLength(1);
  });

  it("dedupes identical consecutive lines within 100 ms", () => {
    h = newGame();
    startBattle(h);
    const w = new h.g.Window_BattleLog();
    w.addText("a");
    w.addText("a");
    h.clock.t += 50;
    w.addText("a");
    h.clock.t += 200;
    w.addText("a"); // 200 ms after the last one: a new line
    w.addText("b");
    w.addText("a"); // not consecutive
    expect(log(h).filter((r) => r.type === "battlelog").map((r) => r.text)).toEqual(["a", "a", "b", "a"]);
  });

  it("caps 50 lines per second and 2000 per battle; the end record counts what was dropped", () => {
    h = newGame();
    startBattle(h);
    const w = new h.g.Window_BattleLog();
    for (let i = 0; i < 80; i++) w.addText("line " + i);
    expect(log(h).filter((r) => r.type === "battlelog")).toHaveLength(50);
    for (let s = 0; s < 60; s++) {
      h.clock.t += 1000;
      for (let i = 0; i < 50; i++) w.addText(`s${s} ${i}`);
    }
    h.g.BattleManager.endBattle(0);
    const recs = log(h);
    expect(recs.filter((r) => r.type === "battlelog")).toHaveLength(2000);
    expect(recs.find((r) => r.type === "battle" && r.phase === "end")).toMatchObject({ dropped: 80 + 60 * 50 - 2000 });
    // a new battle starts counting again
    startBattle(h);
    w.addText("new battle");
    expect(log(h).at(-1)).toMatchObject({ type: "battlelog", text: "new battle" });
  });

  it("buffers log lines: nothing is written synchronously per line", () => {
    h = newGame();
    startBattle(h);
    h.bridge._flushNow();
    const before = onDisk(h).length;
    const w = new h.g.Window_BattleLog();
    for (let i = 0; i < 20; i++) w.addText("x" + i);
    h.bridge._runScheduled();
    expect(onDisk(h).length).toBe(before);
    h.clock.t += 300;
    h.bridge._tick();
    expect(onDisk(h).length).toBe(before + 20);
  });

  it("clips long lines and survives broken input", () => {
    h = newGame();
    startBattle(h);
    const w = new h.g.Window_BattleLog();
    w.addText("x".repeat(900));
    w.addText(undefined);
    w.addText(42);
    const lines = log(h).filter((r) => r.type === "battlelog");
    expect(lines.map((r) => r.text.length)).toEqual([500, 2]);
    expect(w._lines).toHaveLength(3);
  });
});

describe("battle actions (1.8.1)", () => {
  const actor = (name: string) => ({ name: () => name, isEnemy: () => false });
  const foe = (name: string) => ({ name: () => name, isEnemy: () => true });
  const scratch = { id: 7, name: "할퀴기", stypeId: 1, message1: "의 %1!", message2: "" };
  const potion = { id: 1, name: "포션", itypeId: 1 };
  const drain = (w: any) => { while (w._methods.length) w.callNextMethod(); };
  const lines = (hh: Harness) => log(hh).filter((r) => r.type === "battlelog");

  for (const engine of ["MZ", "MV"] as const) {
    it(`writes who used which skill / item once, with targets; the queued line is not written again (${engine})`, () => {
      h = newGame(engine);
      startBattle(h);
      const w = new h.g.Window_BattleLog();
      h.g.BattleManager._targets = [enemy("슬라임 A")];
      w.displayAction(actor("리드"), scratch);
      expect(w._methods).toEqual([{ name: "addText", params: ["리드의 할퀴기!"] }]);
      expect(Object.prototype.hasOwnProperty.call(w, "push")).toBe(false); // the window's push is restored
      drain(w);
      w.addText("슬라임 A에게 12의 데미지!");
      h.g.BattleManager._targets = [];
      w.displayAction(foe("슬라임 A"), potion);
      drain(w);
      expect(w._lines).toEqual(["리드의 할퀴기!", "슬라임 A에게 12의 데미지!", "슬라임 A은(는) 포션을(를) 사용했다!"]);
      expect(lines(h)).toEqual([
        expect.objectContaining({ kind: "action", by: "리드", isEnemy: false, item: "할퀴기", itemKind: "skill", targets: ["슬라임 A"], text: "리드의 할퀴기!" }),
        expect.objectContaining({ text: "슬라임 A에게 12의 데미지!" }),
        expect.objectContaining({ kind: "action", by: "슬라임 A", isEnemy: true, item: "포션", itemKind: "item", text: "슬라임 A은(는) 포션을(를) 사용했다!" }),
      ]);
      expect(lines(h)[2]).not.toHaveProperty("targets");
    });
  }

  it("wraps a displayAction a battle plugin installed later (YEP <SIMPLE> name box + <CENTER> message2)", () => {
    h = newGame();
    // YEP_BattleEngineCore (Show Action Text off) replaces the prototype function after this plugin loaded
    h.g.Window_BattleLog.prototype.displayAction = function (this: any, _subject: any, item: any) {
      this.push("addText", "<SIMPLE>" + item.name);
      if (item.message2) this.push("addText", "<CENTER>" + item.message2.replace("%1", item.name));
    };
    startBattle(h);
    const w = new h.g.Window_BattleLog();
    w.displayAction(foe("늑대"), { ...scratch, message2: "%1 공격!" });
    drain(w);
    expect(w._lines).toEqual(["<SIMPLE>할퀴기", "<CENTER>할퀴기 공격!"]);
    expect(lines(h)).toEqual([
      expect.objectContaining({ kind: "action", by: "늑대", isEnemy: true, item: "할퀴기", text: "<SIMPLE>할퀴기" }),
      expect.objectContaining({ text: "<CENTER>할퀴기 공격!" }),
    ]);
    expect(lines(h)[1]).not.toHaveProperty("kind");
    expect(h.bridge._hooks.filter((x: string) => x === "Window_BattleLog.displayAction")).toHaveLength(1);
  });

  it("an action without a message line is still written; outside battle nothing is", () => {
    h = newGame();
    const w = new h.g.Window_BattleLog();
    w.displayAction(actor("리드"), scratch);
    drain(w);
    startBattle(h);
    w.displayAction(actor("리드"), { ...scratch, message1: "" });
    drain(w);
    expect(lines(h)).toEqual([expect.objectContaining({ kind: "action", by: "리드", item: "할퀴기", text: "" })]);
  });

  it("survives a throwing subject and broken items", () => {
    h = newGame();
    startBattle(h);
    const w = new h.g.Window_BattleLog();
    const bad = { name: () => "리드", isEnemy: () => { throw new Error("boom"); } };
    h.g.BattleManager._targets = [null, { name: 5 }];
    w.displayAction(bad, { stypeId: 1, name: 3, message1: "의 공격!" });
    drain(w);
    expect(w._lines).toEqual(["리드의 공격!"]);
    expect(lines(h)).toEqual([expect.objectContaining({ kind: "action", by: "리드", isEnemy: false, item: "", text: "리드의 공격!" })]);
    expect(lines(h)[0]).not.toHaveProperty("targets");
    // a displayAction that throws still gives the window its own push back
    h.g.Window_BattleLog.prototype.displayAction = function () { this.push("addText", "x"); throw new Error("plugin bug"); };
    h.g.BattleManager.setup(3, true, false);
    expect(() => w.displayAction(bad, scratch)).toThrow("plugin bug");
    expect(Object.prototype.hasOwnProperty.call(w, "push")).toBe(false);
  });
});

describe("battle pictures (1.8.0)", () => {
  it("captures the battle scene's pictures at start (after Scene_Battle starts), on troop messages and at the end", () => {
    h = newGame();
    setCapture(h, true);
    const s = h.g.$gameScreen;
    h.g.$dataTroops[3] = { id: 3, name: "보스", pages: [] };
    h.g.$gameTroop._enemies = [enemy("보스")];
    h.g.BattleManager.setup(3, false, true);
    // the battle scene and its spriteset are created later; the start record waits for them
    h.bridge._tick();
    expect(onDisk(h).some((r) => r.type === "battle")).toBe(false);
    const ss = h.mountSpriteset(10);
    // an enemy battler sprite in the same scene is never a picture
    const enemySprite = ss.spriteset.addChild(new h.g.Sprite());
    enemySprite.bitmap = { width: 200, height: 200, isError: () => false };
    s.showPicture(5, "boss_cg", 0, 0, 0, 100, 100, 255, 0);
    ss.update();
    new h.g.Scene_Battle().start();
    const start = log(h).find((r) => r.type === "battle");
    expect(start.pics).toEqual([[5, "boss_cg", 0, 0, 0, 100, 100, 255, 0, 0, 0, 100, 100]]);

    const list = [cmd(101, ["", 0, 0, 2, ""]), cmd(401, ["보스: 각오해라"]), cmd(0)];
    const interp = h.g.$gameTroop._interpreter;
    interp.setup(list, 0);
    h.runCommand(interp, 0);
    h.drawMessageText();
    expect(log(h).find((r) => r.type === "message")).toMatchObject({ picsSame: true });

    // a log line carries pictures only when they changed
    const w = new h.g.Window_BattleLog();
    w.addText("보스의 공격!");
    s.showPicture(6, "stand_hurt", 0, 300, 0, 100, 100, 255, 0);
    ss.update();
    h.clock.t += 600;
    w.addText("12의 데미지!");
    const lines = log(h).filter((r) => r.type === "battlelog");
    expect(lines[0]).not.toHaveProperty("pics");
    expect(lines[0]).not.toHaveProperty("picsSame");
    expect(lines[1].pics.map((p: any[]) => p[1])).toEqual(["boss_cg", "stand_hurt"]);

    h.g.BattleManager.endBattle(0);
    expect(log(h).find((r) => r.type === "battle" && r.phase === "end")).toMatchObject({ picsSame: true });
  });

  it("without capture, battle records carry no pictures and the start record is written at once", () => {
    h = newGame();
    startBattle(h);
    h.g.$gameScreen.showPicture(5, "boss_cg", 0, 0, 0, 100, 100, 255, 0);
    new h.g.Window_BattleLog().addText("x");
    h.g.BattleManager.endBattle(0);
    for (const r of battleRecs(h)) {
      expect(r).not.toHaveProperty("pics");
      expect(r).not.toHaveProperty("picsSame");
    }
  });

  it("the held start record is written after at most 5 s even without a battle scene", () => {
    h = newGame();
    setCapture(h, true);
    h.g.BattleManager.setup(3, true, false);
    h.clock.t += 1500;
    h.bridge._tick();
    expect(onDisk(h).some((r) => r.type === "battle")).toBe(false);
    h.clock.t += 4000;
    h.bridge._tick();
    expect(onDisk(h).find((r) => r.type === "battle")).toMatchObject({ phase: "start", pics: [] });
  });
});
