import { describe, expect, it } from "vitest";
import { cmd, createHarness, type Harness } from "./harness";

const sound = { name: "line", volume: 80, pitch: 110, pan: -20 };
const list = () => [cmd(250, [sound]), cmd(230), cmd(108, ["comment"]), cmd(101, ["", 0, 0, 2, ""]), cmd(401, ["hello"]), cmd(0)];
function game(engine: "MV" | "MZ" = "MZ") {
  const h = createHarness({ engine }); h.g.DataManager.setupNewGame();
  const commands = list(); h.addMapEvent(1, [commands]);
  const interp = h.g.$gameMap._interpreter; interp.setup(commands, 1);
  return { h, interp };
}
const messages = (h: Harness) => h.readLog().filter(r => r.type === "message");
const voices = (h: Harness) => h.readLog().filter(r => r.type === "voice");

describe("bridge message voices", () => {
  it.each(["MV", "MZ"] as const)("attaches foreground Play SE before text (%s)", engine => {
    const { h, interp } = game(engine);
    const result = h.g.AudioManager.playSe(sound);
    expect(result).toEqual({ folder: "se", name: "line" });
    h.runCommand(interp, 0); h.runCommand(interp, 3);
    expect(messages(h)[0].voice).toEqual([{ folder: "se", ...sound }]);
    expect(voices(h)).toEqual([]); // outside interpreter before a message is ignored
  });
  it("links sounds during text immediately and never hooks static UI sounds", () => {
    const { h, interp } = game(); h.runCommand(interp, 3);
    const message = messages(h)[0];
    h.g.AudioManager.playSe(sound); h.g.AudioManager.playStaticSe({ ...sound, name: "Cursor" });
    expect(voices(h)).toEqual([expect.objectContaining({ msg: message.seq, folder: "se", ...sound })]);
    h.g.$gameMessage.clear(); h.g.AudioManager.playSe(sound);
    expect(voices(h)).toHaveLength(1);
  });
  it("ignores parallel events and parallel common-event children before and during text", () => {
    const { h, interp } = game();
    const parallel = h.newInterpreter(); parallel.setup(list(), 2);
    h.addMapEvent(2, [list()])._interpreter = parallel;
    parallel.setupChild(list(), 0);
    h.runCommand(parallel, 0); h.runCommand(parallel._childInterpreter, 0);
    h.runCommand(interp, 3);
    h.runCommand(parallel, 0); h.runCommand(parallel._childInterpreter, 0);
    h.g.$gameMap._commonEvents = [{ _interpreter: parallel }];
    h.runCommand(parallel, 0);
    expect(messages(h)[0].voice).toEqual([]); expect(voices(h)).toEqual([]);
  });
  it("accepts common-event child chains and battle main interpreters", () => {
    const { h, interp } = game();
    interp.setupChild(list(), 0);
    const child = interp._childInterpreter;
    h.runCommand(child, 0); h.runCommand(child, 3);
    h.runCommand(interp, 0);
    expect(messages(h)[0].voice).toHaveLength(1); expect(voices(h)).toHaveLength(1);
    h.g.$gameMessage.clear(); h.g.BattleManager.setup(1);
    const battle = h.g.$gameTroop._interpreter; battle.setup(list(), 0);
    h.runCommand(battle, 0); h.runCommand(battle, 3);
    h.runCommand(interp, 0); // map context is excluded during battle
    expect(messages(h)[1].voice).toEqual([{ folder: "se", ...sound }]); expect(voices(h)).toHaveLength(1);
  });
  it.each(["age", "close", "transfer", "battle start", "battle end", "next event"])("clears pending sounds on %s", reason => {
    const { h, interp } = game(); h.runCommand(interp, 0);
    if (reason === "age") h.clock.t += 2001;
    if (reason === "close") h.g.$gameMessage.clear();
    if (reason === "transfer") h.g.$gamePlayer.performTransfer();
    if (reason === "battle start") { h.g.BattleManager.setup(1); h.g.$gameParty._inBattle = false; }
    if (reason === "battle end") h.g.BattleManager.endBattle(1);
    if (reason === "next event") interp.setup(interp._list, 1); // even when the exact same event list is reused
    h.runCommand(interp, 3);
    expect(messages(h)[0].voice).toEqual([]);
  });
  it("discovers late playVoice, captures its actual folder, avoids nested duplicates", () => {
    const { h, interp } = game();
    h.g.AudioManager.playVoice = function (s: typeof sound) { this.playSe(s); return this.createBuffer("voices/actor/", s.name); };
    h.bridge._tick(); h.runCommand(interp, 3);
    h.g.AudioManager.playVoice(sound);
    expect(voices(h)).toEqual([expect.objectContaining({ folder: "voices/actor", name: "line" })]);
    h.g.AudioManager.playVoice = function (s: typeof sound) { return this.createBuffer("bgm", s.name); };
    h.bridge._tick(); h.g.AudioManager.playVoice(sound);
    expect(voices(h)).toHaveLength(1);
  });
  it("remembers a plugin's custom folder when it reuses a cached buffer", () => {
    const { h, interp } = game();
    let cached: unknown;
    h.g.AudioManager.playVoice = function (s: typeof sound) { return cached ??= this.createBuffer("dialogue", s.name); };
    h.bridge._tick(); h.runCommand(interp, 3);
    h.g.AudioManager.playVoice(sound); h.g.AudioManager.playVoice(sound);
    expect(voices(h).map(r => r.folder)).toEqual(["dialogue", "dialogue"]);
  });
  it("keeps message linking valid while a picture snapshot is held", () => {
    const { h, interp } = game();
    h.fs.files.set("/game/www/rpg-viewer/control.json", JSON.stringify({ v: 1, t: h.clock.t, capturePictures: true }));
    h.clock.t += 1000;
    h.bridge._tick(); h.runCommand(interp, 3); h.g.AudioManager.playSe(sound);
    const log = h.readLog();
    const message = log.find(r => r.type === "message");
    expect(message.pics).toEqual([]);
    expect(log.find(r => r.type === "voice").msg).toBe(message.seq);
    expect(log.map(r => r.seq)).toEqual([...log.map(r => r.seq)].sort((a, b) => a - b));
  });
});
