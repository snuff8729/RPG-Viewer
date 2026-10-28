// Minimal fake RPG Maker MV/MZ engine + in-memory fs for testing plugin/RPGViewerBridge.js.
// Only the surface the plugin touches is modelled; behaviour mirrors rpg_objects.js / rmmz_objects.js
// closely enough for the hooks (busy checks, 101 -> 102 inline choices, choice callbacks, save/load).
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PLUGIN_PATH = fileURLToPath(new URL("../../plugin/RPGViewerBridge.js", import.meta.url));
export const BASE_DIR = "/game/www";
export const LOG_PATH = BASE_DIR + "/rpg-viewer/log.jsonl";
export const LIVE_PATH = BASE_DIR + "/rpg-viewer/live.json";
export const META_PATH = BASE_DIR + "/rpg-viewer/meta.json";

export type Engine = "MZ" | "MV";
export interface Cmd { code: number; indent: number; parameters: any[] }

function enoent(p: string): Error {
  const e: any = new Error("ENOENT: no such file or directory, '" + p + "'");
  e.code = "ENOENT";
  return e;
}

export class MemFs {
  files = new Map<string, string>();
  dirs = new Set<string>([BASE_DIR]);
  existsSync(p: string): boolean { return this.files.has(p) || this.dirs.has(p); }
  mkdirSync(p: string): void { this.dirs.add(p); }
  readFileSync(p: string): string {
    const v = this.files.get(p);
    if (v === undefined) throw enoent(p);
    return v;
  }
  writeFileSync(p: string, data: string): void { this.needDir(p); this.files.set(p, String(data)); }
  appendFileSync(p: string, data: string): void { this.needDir(p); this.files.set(p, (this.files.get(p) ?? "") + String(data)); }
  renameSync(from: string, to: string): void {
    const v = this.files.get(from);
    if (v === undefined) throw enoent(from);
    this.needDir(to);
    this.files.delete(from);
    this.files.set(to, v);
  }
  unlinkSync(p: string): void { if (!this.files.delete(p)) throw enoent(p); }
  private needDir(p: string): void { if (!this.dirs.has(path.posix.dirname(p))) throw enoent(p); }
}

export const cmd = (code: number, parameters: any[] = [], indent = 0): Cmd => ({ code, indent, parameters });

export interface Harness {
  engine: Engine;
  fs: MemFs;
  g: any;                       // globalThis with the fake engine installed
  bridge: any;                  // RPGViewerBridge
  clock: { t: number };
  saves: Record<number, any>;
  newInterpreter(): any;
  runCommand(interp: any, index: number): any;
  readLog(): any[];
  readLive(): any;
  addMapEvent(eventId: number, pages: Cmd[][], pageIndex?: number): any;
}

export function createHarness(opts: { engine?: Engine; fs?: MemFs; startTime?: number } = {}): Harness {
  const engine: Engine = opts.engine ?? "MZ";
  const fs = opts.fs ?? new MemFs();
  const clock = { t: opts.startTime ?? 1_000_000 };
  const g: any = globalThis;
  const saves: Record<number, any> = {};

  // ---- Game_Message
  function Game_Message(this: any) { this.clear(); }
  Game_Message.prototype.clear = function () {
    this._texts = []; this._choices = []; this._choiceCallback = null; this._busy = false;
    this._faceName = ""; this._faceIndex = 0; this._speakerName = "";
  };
  Game_Message.prototype.isBusy = function () { return this._busy; };
  Game_Message.prototype.add = function (t: string) { this._texts.push(t); };
  Game_Message.prototype.setFaceImage = function (n: string, i: number) { this._faceName = n; this._faceIndex = i; };
  Game_Message.prototype.setSpeakerName = function (n: string) { this._speakerName = n; };
  Game_Message.prototype.setChoices = function (c: string[]) { this._choices = c; };
  Game_Message.prototype.setChoiceCallback = function (cb: any) { this._choiceCallback = cb; };
  Game_Message.prototype.isChoice = function () { return this._choices.length > 0; };
  Game_Message.prototype.onChoice = function (n: number) {
    if (this._choiceCallback) { this._choiceCallback(n); this._choiceCallback = null; }
    this._choices = [];
  };

  // ---- Game_Switches / Variables / SelfSwitches
  function Game_Switches(this: any) { this._data = []; }
  Game_Switches.prototype.value = function (id: number) { return !!this._data[id]; };
  Game_Switches.prototype.setValue = function (id: number, v: boolean) { if (id > 0) this._data[id] = v; };
  function Game_Variables(this: any) { this._data = []; }
  Game_Variables.prototype.value = function (id: number) { return this._data[id] || 0; };
  Game_Variables.prototype.setValue = function (id: number, v: any) {
    if (id > 0) this._data[id] = typeof v === "number" ? Math.floor(v) : v;
  };
  function Game_SelfSwitches(this: any) { this._data = {}; }
  Game_SelfSwitches.prototype.value = function (key: any[]) { return !!this._data[key as any]; };
  Game_SelfSwitches.prototype.setValue = function (key: any[], v: boolean) {
    if (v) this._data[key as any] = true; else delete this._data[key as any];
  };

  // ---- Game_Party / Troop / Player / Map
  function Game_Party(this: any) {
    this._items = {}; this._weapons = {}; this._armors = {}; this._gold = 0; this._actors = []; this._inBattle = false;
  }
  Game_Party.prototype.inBattle = function () { return this._inBattle; };
  function Game_Troop(this: any) { this._troopId = 0; }
  Game_Troop.prototype.troop = function () { return g.$dataTroops[this._troopId]; };
  function Game_Player(this: any) { this.x = 0; this.y = 0; this._transferring = false; this._newMapId = 0; this._newX = 0; this._newY = 0; }
  Game_Player.prototype.isTransferring = function () { return this._transferring; };
  Game_Player.prototype.reserveTransfer = function (mapId: number, x: number, y: number) {
    this._transferring = true; this._newMapId = mapId; this._newX = x; this._newY = y;
  };
  Game_Player.prototype.performTransfer = function () {
    if (this.isTransferring()) {
      g.$gameMap._mapId = this._newMapId; this.x = this._newX; this.y = this._newY; this._transferring = false;
    }
  };
  function Game_Event(this: any, eventId: number, pages: Cmd[][], pageIndex: number) {
    this._eventId = eventId; this._pageIndex = pageIndex;
    this._data = { id: eventId, pages: pages.map((list) => ({ list })) };
  }
  Game_Event.prototype.eventId = function () { return this._eventId; };
  Game_Event.prototype.event = function () { return this._data; };
  Game_Event.prototype.list = function () { return this._data.pages[this._pageIndex].list; };
  function Game_Map(this: any) { this._mapId = 1; this._events = []; this._interpreter = new (Game_Interpreter as any)(); }
  Game_Map.prototype.mapId = function () { return this._mapId; };
  Game_Map.prototype.event = function (id: number) { return this._events[id]; };
  Game_Map.prototype.events = function () { return this._events.filter((e: any) => !!e); };

  // ---- Game_Interpreter
  function Game_Interpreter(this: any) { this.clear(); }
  Game_Interpreter.prototype.clear = function () {
    this._mapId = 0; this._eventId = 0; this._list = null; this._index = 0; this._indent = 0; this._branch = {}; this._params = [];
  };
  Game_Interpreter.prototype.setup = function (list: Cmd[], eventId: number) {
    this.clear(); this._mapId = g.$gameMap.mapId(); this._eventId = eventId || 0; this._list = list;
  };
  Game_Interpreter.prototype.isRunning = function () { return !!this._list; };
  Game_Interpreter.prototype.currentCommand = function () { return this._list[this._index]; };
  Game_Interpreter.prototype.nextEventCode = function () { const c = this._list[this._index + 1]; return c ? c.code : 0; };
  Game_Interpreter.prototype.executeCommand = function () {
    const command = this.currentCommand();
    if (!command) { this._list = null; return false; }
    this._params = command.parameters; this._indent = command.indent;
    const fn = this["command" + command.code];
    if (typeof fn === "function") {
      const ok = engine === "MZ" ? fn.call(this, command.parameters) : fn.call(this);
      if (!ok) return false;
    }
    this._index++;
    return true;
  };
  Game_Interpreter.prototype.command101 = function (params?: any[]) {
    const p = params ?? this._params;
    const m = g.$gameMessage;
    if (m.isBusy()) return false;
    m.setFaceImage(p[0], p[1]);
    if (engine === "MZ") m.setSpeakerName(p[4]);
    while (this.nextEventCode() === 401) { this._index++; m.add(this.currentCommand().parameters[0]); }
    if (this.nextEventCode() === 102) { this._index++; this.setupChoices(this.currentCommand().parameters); }
    m._busy = true;
    return true;
  };
  Game_Interpreter.prototype.command102 = function (params?: any[]) {
    if (g.$gameMessage.isBusy()) return false;
    this.setupChoices(params ?? this._params);
    return true;
  };
  Game_Interpreter.prototype.setupChoices = function (params: any[]) {
    const choices = params[0].slice();
    g.$gameMessage.setChoices(choices);
    g.$gameMessage.setChoiceCallback((n: number) => { this._branch[this._indent] = n; });
  };
  Game_Interpreter.prototype.command105 = function () {
    if (g.$gameMessage.isBusy()) return false;
    while (this.nextEventCode() === 405) { this._index++; g.$gameMessage.add(this.currentCommand().parameters[0]); }
    return true;
  };
  Game_Interpreter.prototype.command121 = function (params?: any[]) {
    const p = params ?? this._params;
    for (let i = p[0]; i <= p[1]; i++) g.$gameSwitches.setValue(i, p[2] === 0);
    return true;
  };
  Game_Interpreter.prototype.command123 = function (params?: any[]) {
    const p = params ?? this._params;
    g.$gameSelfSwitches.setValue([this._mapId, this._eventId, p[0]], p[1] === 0);
    return true;
  };
  Game_Interpreter.prototype.command231 = function () { return true; };

  // ---- Managers
  function Scene_Boot(this: any) {}
  const SceneManager = { _scene: null as any };
  const BattleManager = {
    setup(troopId: number) { g.$gameTroop._troopId = troopId; g.$gameParty._inBattle = true; },
    endBattle(_result: number) { g.$gameParty._inBattle = false; },
  };
  const DataManager = {
    createGameObjects() {
      g.$gameMessage = new (Game_Message as any)();
      g.$gameSwitches = new (Game_Switches as any)();
      g.$gameVariables = new (Game_Variables as any)();
      g.$gameSelfSwitches = new (Game_SelfSwitches as any)();
      g.$gameParty = new (Game_Party as any)();
      g.$gameTroop = new (Game_Troop as any)();
      g.$gameMap = new (Game_Map as any)();
      g.$gamePlayer = new (Game_Player as any)();
    },
    setupNewGame() { this.createGameObjects(); g.$gamePlayer.reserveTransfer(1, 3, 4); },
    makeSaveContents(): any {
      return { switches: g.$gameSwitches, variables: g.$gameVariables, selfSwitches: g.$gameSelfSwitches, party: g.$gameParty, map: g.$gameMap, player: g.$gamePlayer };
    },
    extractSaveContents(c: any) {
      if (c.switches) g.$gameSwitches = c.switches;
      if (c.variables) g.$gameVariables = c.variables;
      if (c.selfSwitches) g.$gameSelfSwitches = c.selfSwitches;
      if (c.party) g.$gameParty = c.party;
      if (c.map) g.$gameMap = c.map;
      if (c.player) g.$gamePlayer = c.player;
    },
    saveGame(id: number): any {
      saves[id] = this.makeSaveContents();
      return engine === "MZ" ? Promise.resolve(0) : true;
    },
    loadGame(id: number): any {
      if (engine === "MZ") {
        return Promise.resolve().then(() => {
          if (!saves[id]) throw new Error("no save");
          this.createGameObjects(); this.extractSaveContents(saves[id]); return 0;
        });
      }
      if (!saves[id]) return false;
      this.createGameObjects(); this.extractSaveContents(saves[id]); return true;
    },
  };

  Object.assign(g, {
    Game_Message, Game_Switches, Game_Variables, Game_SelfSwitches, Game_Party, Game_Troop, Game_Player,
    Game_Event, Game_Map, Game_Interpreter, Scene_Boot, SceneManager, BattleManager, DataManager,
    $dataCommonEvents: [null], $dataTroops: [null],
  });
  // Title screen: like Scene_Boot, objects are created by the engine before any game starts.
  DataManager.createGameObjects();

  delete g.RPGViewerBridge;
  g.__RPGV_TEST__ = { fs, path: path.posix, baseDir: BASE_DIR, now: () => clock.t };
  const src = readFileSync(PLUGIN_PATH, "utf8");
  new Function(src)();
  delete g.__RPGV_TEST__;
  const bridge = g.RPGViewerBridge;

  return {
    engine, fs, g, bridge, clock, saves,
    newInterpreter: () => new (Game_Interpreter as any)(),
    runCommand(interp, index) { interp._index = index; return interp.executeCommand(); },
    readLog() {
      bridge._flushNow();
      const text = fs.files.get(LOG_PATH) ?? "";
      return text.split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l));
    },
    readLive() {
      const text = fs.files.get(LIVE_PATH);
      return text === undefined ? undefined : JSON.parse(text);
    },
    addMapEvent(eventId, pages, pageIndex = 0) {
      const ev = new (Game_Event as any)(eventId, pages, pageIndex);
      g.$gameMap._events[eventId] = ev;
      return ev;
    },
  };
}
