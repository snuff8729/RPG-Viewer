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
  mtimes = new Map<string, number>();
  private writes = 0;
  statSync(p: string): { size: number; mtimeMs?: number } {
    const v = this.files.get(p);
    if (v === undefined) throw enoent(p);
    return { size: Buffer.byteLength(v), mtimeMs: this.mtimes.get(p) ?? 0 };
  }
  private touch(p: string): void { this.mtimes.set(p, ++this.writes); }
  existsSync(p: string): boolean { return this.files.has(p) || this.dirs.has(p); }
  mkdirSync(p: string): void { this.dirs.add(p); }
  readFileSync(p: string): string {
    const v = this.files.get(p);
    if (v === undefined) throw enoent(p);
    return v;
  }
  writeFileSync(p: string, data: string): void { this.needDir(p); this.files.set(p, String(data)); this.touch(p); }
  appendFileSync(p: string, data: string): void { this.needDir(p); this.files.set(p, (this.files.get(p) ?? "") + String(data)); this.touch(p); }
  renameSync(from: string, to: string): void {
    const v = this.files.get(from);
    if (v === undefined) throw enoent(from);
    this.needDir(to);
    this.files.delete(from);
    this.files.set(to, v);
    this.touch(to);
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
  Game_Message.prototype.hasText = function () { return this._texts.length > 0; };
  Game_Message.prototype.setFaceImage = function (n: string, i: number) { this._faceName = n; this._faceIndex = i; };
  Game_Message.prototype.setSpeakerName = function (n: string) { this._speakerName = n; };
  Game_Message.prototype.setChoices = function (c: string[]) { this._choices = c; };
  Game_Message.prototype.setChoiceCallback = function (cb: any) { this._choiceCallback = cb; };
  Game_Message.prototype.isChoice = function () { return this._choices.length > 0; };
  Game_Message.prototype.isNumberInput = function () { return !!this._numInput; };
  Game_Message.prototype.isItemChoice = function () { return false; };
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
  Game_Party.prototype.aliveMembers = function () { return (this._battlers ?? []).filter((b: any) => b.isAlive()); };
  function Game_Troop(this: any) { this._troopId = 0; this._enemies = []; }
  Game_Troop.prototype.aliveMembers = function () { return this._enemies.filter((b: any) => b.isAlive()); };
  // ---- battlers (death state 1)
  function Game_Battler(this: any) { this._states = []; this._collapsed = false; }
  Game_Battler.prototype.deathStateId = function () { return 1; };
  Game_Battler.prototype.addNewState = function (id: number) { this._states.push(id); };
  Game_Battler.prototype.refresh = function () {};
  Game_Battler.prototype.isAlive = function () { return !this._states.includes(1); };
  Game_Battler.prototype.performCollapse = function () { this._collapsed = true; };
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

  // ---- Game_Screen / Game_Picture (fields as in rpg_objects.js / rmmz_objects.js; battle pictures use the upper half)
  function Game_Picture(this: any) {
    this._name = ""; this._origin = 0; this._x = 0; this._y = 0; this._scaleX = 100; this._scaleY = 100;
    this._opacity = 255; this._blendMode = 0; this._targetX = 0; this._targetY = 0; this._targetScaleX = 100;
    this._targetScaleY = 100; this._targetOpacity = 255; this._duration = 0; this._tone = null; this._toneTarget = null;
    this._toneDuration = 0; this._angle = 0;
  }
  Game_Picture.prototype.show = function (name: string, origin: number, x: number, y: number, sx: number, sy: number, op: number, blend: number) {
    Object.assign(this, { _name: name, _origin: origin, _x: x, _y: y, _scaleX: sx, _scaleY: sy, _opacity: op, _blendMode: blend,
      _targetX: x, _targetY: y, _targetScaleX: sx, _targetScaleY: sy, _targetOpacity: op, _duration: 0 });
  };
  Game_Picture.prototype.move = function (origin: number, x: number, y: number, sx: number, sy: number, op: number, blend: number, duration: number) {
    Object.assign(this, { _origin: origin, _targetX: x, _targetY: y, _targetScaleX: sx, _targetScaleY: sy, _targetOpacity: op, _blendMode: blend, _duration: duration });
  };
  function Game_Screen(this: any) { this._pictures = []; }
  Game_Screen.prototype.maxPictures = function () { return 100; };
  Game_Screen.prototype.realPictureId = function (id: number) { return g.$gameParty.inBattle() ? id + 100 : id; };
  Game_Screen.prototype.picture = function (id: number) { return this._pictures[this.realPictureId(id)]; };
  Game_Screen.prototype.showPicture = function (id: number, name: string, origin: number, x: number, y: number, sx: number, sy: number, op: number, blend: number) {
    const p = new (Game_Picture as any)();
    p.show(name, origin, x, y, sx, sy, op, blend);
    this._pictures[this.realPictureId(id)] = p;
  };
  Game_Screen.prototype.movePicture = function (id: number, ...args: number[]) { const p = this.picture(id); if (p) p.move(...args); };
  Game_Screen.prototype.erasePicture = function (id: number) { this._pictures[this.realPictureId(id)] = null; };

  // ---- Game_Interpreter
  function Game_Interpreter(this: any) { this.clear(); }
  Game_Interpreter.prototype.clear = function () {
    this._childInterpreter = null; this._mapId = 0; this._eventId = 0; this._list = null; this._index = 0; this._indent = 0; this._branch = {}; this._params = [];
  };
  Game_Interpreter.prototype.setup = function (list: Cmd[], eventId: number) {
    this.clear(); this._mapId = g.$gameMap.mapId(); this._eventId = eventId || 0; this._list = list;
  };
  Game_Interpreter.prototype.setupChild = function (list: Cmd[], eventId: number) {
    this._childInterpreter = new (Game_Interpreter as any)((this._depth || 0) + 1);
    this._childInterpreter.setup(list, eventId);
  };
  Game_Interpreter.prototype.command117 = function (params?: any[]) {
    const p = params ?? this._params;
    const ce = g.$dataCommonEvents[p[0]];
    if (ce) this.setupChild(ce.list, p[0]);
    return true;
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
  Game_Interpreter.prototype.pluginCalls = 0;
  Game_Interpreter.prototype.command356 = function () { this.pluginCalls++; return true; };
  if (engine === "MZ") Game_Interpreter.prototype.command357 = function () { this.pluginCalls++; return true; };

  // ---- Managers
  function Scene_Boot(this: any) {}
  function Scene_Title(this: any) {}
  function Scene_Map(this: any) {}
  function Scene_Battle(this: any) {}
  // Input: keyMapper like the engine's default (subset); update / isTriggered / isRepeated /
  // isLongPressed follow rpg_core.js (latest button + _pressedTime, repeat wait 24, interval 6).
  const Input = {
    keyMapper: { 9: "tab", 13: "ok", 16: "shift", 27: "escape", 32: "ok", 37: "left", 38: "up", 39: "right", 40: "down", 90: "ok", 88: "escape" } as Record<number, string>,
    keyRepeatWait: 24,
    keyRepeatInterval: 6,
    _currentState: {} as Record<string, boolean>,
    _previousState: {} as Record<string, boolean>,
    _latestButton: null as string | null,
    _pressedTime: 0,
    _tap: null as string | null,
    updates: 0,
    isPressed(name: string) { return !!this._currentState[name]; },
    isTriggered(name: string) { return this._latestButton === name && this._pressedTime === 0; },
    isRepeated(name: string) {
      return this._latestButton === name &&
        (this._pressedTime === 0 || (this._pressedTime >= this.keyRepeatWait && this._pressedTime % this.keyRepeatInterval === 0));
    },
    isLongPressed(name: string) { return this._latestButton === name && this._pressedTime >= this.keyRepeatWait; },
    update() {
      this.updates++;
      if (this._tap !== null) { this._currentState[this._tap] = false; this._tap = null; }
      if (this._latestButton !== null && this._currentState[this._latestButton]) this._pressedTime++;
      else this._latestButton = null;
      for (const name of Object.keys(this._currentState)) {
        if (this._currentState[name] && !this._previousState[name]) { this._latestButton = name; this._pressedTime = 0; }
        this._previousState[name] = this._currentState[name];
      }
    },
    keyDown(keyCode: number) { const n = this.keyMapper[keyCode]; if (n) this._currentState[n] = true; },
    keyUp(keyCode: number) { const n = this.keyMapper[keyCode]; if (n) this._currentState[n] = false; },
    // a tap already seen by this frame's update: triggered until the next update releases it
    press(keyCode: number) {
      const n = this.keyMapper[keyCode];
      if (!n) return;
      this._currentState[n] = true; this._previousState[n] = true;
      this._latestButton = n; this._pressedTime = 0; this._tap = n;
    },
  };
  // TouchInput like rpg_core.js: a touch triggers on the next update, _pressedTime counts held updates.
  const TouchInput = {
    keyRepeatWait: 24,
    keyRepeatInterval: 6,
    _screenPressed: false,
    _triggered: false,
    _cancelled: false,
    _events: { triggered: false, cancelled: false },
    _pressedTime: 0,
    isPressed() { return this._screenPressed; },
    isTriggered() { return this._triggered; },
    isCancelled() { return this._cancelled; },
    isRepeated() {
      return this.isPressed() &&
        (this._triggered || (this._pressedTime >= this.keyRepeatWait && this._pressedTime % this.keyRepeatInterval === 0));
    },
    isLongPressed() { return this.isPressed() && this._pressedTime >= this.keyRepeatWait; },
    update() {
      this._triggered = this._events.triggered; this._cancelled = this._events.cancelled;
      this._events = { triggered: false, cancelled: false };
      if (this.isPressed()) this._pressedTime++;
    },
    touchDown() { this._screenPressed = true; this._pressedTime = 0; this._events.triggered = true; },
    touchUp() { this._screenPressed = false; },
  };
  const SceneManager = {
    _scene: null as any, _sceneStarted: true, _nextScene: null as any, _exiting: false,
    sceneUpdates: 0,
    onSceneUpdate: null as null | (() => void),
    updateInputData() { Input.update(); TouchInput.update(); },
    updateScene() { this.sceneUpdates++; if (this.onSceneUpdate) this.onSceneUpdate(); },
  };
  // Window_Message: the flag/pause/input surface the plugin hooks (shared names in MV and MZ).
  function Window_Message(this: any) { this.pause = false; this._okPressed = false; this.advanced = 0; this.clearFlags(); }
  Window_Message.prototype.clearFlags = function () { this._showFast = false; this._lineShowFast = false; this._pauseSkip = false; };
  Window_Message.prototype.newPage = function () { this.clearFlags(); };
  Window_Message.prototype.startMessage = function () { this.newPage(); };
  Window_Message.prototype.isTriggered = function () { return this._okPressed; };
  Window_Message.prototype.updateInput = function () {
    if (this.pause) {
      if (this.isTriggered()) { this.pause = false; this.advanced++; }
      return true;
    }
    return false;
  };
  const BattleManager = {
    _phase: null as string | null, _canEscape: true, _canLose: false, _escapeRatio: 0.5, _escaped: false,
    calls: [] as string[],
    setup(troopId: number, canEscape = true, canLose = false) {
      g.$gameTroop._troopId = troopId; g.$gameParty._inBattle = true; this._phase = "init"; this._escaped = false;
      this._canEscape = canEscape; this._canLose = canLose;
    },
    endBattle(_result: number) { g.$gameParty._inBattle = false; this._phase = "battleEnd"; },
    canEscape() { return this._canEscape; },
    checkBattleEnd() {
      if (g.$gameParty.aliveMembers().length === 0) { this.processDefeat(); return true; }
      if (g.$gameTroop.aliveMembers().length === 0) { this.processVictory(); return true; }
      return false;
    },
    processVictory() { this.calls.push("victory"); this.endBattle(0); },
    processDefeat() { this.calls.push("defeat:" + g.$gameParty.aliveMembers().length); this.endBattle(2); },
    processEscape() {
      this.calls.push("escape:" + this._escapeRatio);
      const ok = Math.random() < this._escapeRatio;
      if (ok) { this._escaped = true; this.processAbort(); }
      return ok;
    },
    processAbort() { this.calls.push("abort"); this.endBattle(1); },
  };
  const DataManager = {
    createGameObjects() {
      g.$gameMessage = new (Game_Message as any)();
      g.$gameSwitches = new (Game_Switches as any)();
      g.$gameVariables = new (Game_Variables as any)();
      g.$gameSelfSwitches = new (Game_SelfSwitches as any)();
      g.$gameParty = new (Game_Party as any)();
      g.$gameTroop = new (Game_Troop as any)();
      g.$gameTroop._interpreter = new (Game_Interpreter as any)();
      g.$gameMap = new (Game_Map as any)();
      g.$gamePlayer = new (Game_Player as any)();
      g.$gameScreen = new (Game_Screen as any)();
    },
    setupNewGame() { this.createGameObjects(); g.$gamePlayer.reserveTransfer(1, 3, 4); },
    makeSaveContents(): any {
      return { switches: g.$gameSwitches, variables: g.$gameVariables, selfSwitches: g.$gameSelfSwitches, party: g.$gameParty, map: g.$gameMap, player: g.$gamePlayer, screen: g.$gameScreen };
    },
    extractSaveContents(c: any) {
      if (c.switches) g.$gameSwitches = c.switches;
      if (c.variables) g.$gameVariables = c.variables;
      if (c.selfSwitches) g.$gameSelfSwitches = c.selfSwitches;
      if (c.party) g.$gameParty = c.party;
      if (c.map) g.$gameMap = c.map;
      if (c.player) g.$gamePlayer = c.player;
      if (c.screen) g.$gameScreen = c.screen;
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
    Game_Event, Game_Map, Game_Interpreter, Game_Screen, Game_Picture, Game_Battler, Scene_Boot, Scene_Title, Scene_Map, Scene_Battle,
    SceneManager, BattleManager, DataManager, Input, TouchInput, Window_Message,
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
