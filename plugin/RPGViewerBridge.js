/*:
 * @target MZ MV
 * @plugindesc RPG Viewer 기록 플러그인
 * @author RPG Viewer
 * @help
 * RPG Viewer가 설치하는 기록 플러그인입니다.
 * 게임 폴더의 rpg-viewer/ 아래에 플레이 기록(log.jsonl)과
 * 현재 상태(live.json)를 남깁니다. 게임 화면과 진행에는 영향을 주지 않습니다.
 * 플러그인 명령이나 파라미터는 없습니다.
 * 변수 변경은 숫자·참/거짓 값만 기록합니다(문자열·배열 등은 기록하지 않음).
 * 같은 명령이 매 프레임 바꾸는 값은 0.25초마다 마지막 값만 남깁니다.
 *
 * 주의: 세이브 미리보기 등을 위해 DataManager.extractSaveContents를
 * 직접 호출하는 다른 플러그인이 있으면, 실제 로드가 아니어도 기록에
 * 불필요한 갈래(branchStart)가 생길 수 있습니다.
 * (Plugins that call DataManager.extractSaveContents for save previews
 * may create spurious branches in the log.)
 */
(function () {
  "use strict";
  var G = Function("return this")();

  var bridge = {
    VERSION: "1.0.3",
    _flushNow: function () {},
    _snapshotNow: function () {},
    _tick: function () {},
    _hooks: []
  };
  G.RPGViewerBridge = bridge;

  // ---------------------------------------------------------------- environment
  var T = G.__RPGV_TEST__ || null;
  var fs = null, path = null, baseDir = null;
  var now = function () { return Date.now(); };
  try {
    if (T) {
      fs = T.fs; path = T.path; baseDir = T.baseDir;
      if (typeof T.now === "function") now = T.now;
    } else if (typeof require === "function" && typeof process !== "undefined" && process.mainModule) {
      fs = require("fs");
      path = require("path");
      baseDir = path.dirname(process.mainModule.filename);
    }
  } catch (e) {
    fs = null;
  }
  if (!fs || !path || !baseDir) return; // not NW.js (e.g. browser build): stay inert

  var DIR = path.join(baseDir, "rpg-viewer");
  var LOG = path.join(DIR, "log.jsonl");
  var LIVE = path.join(DIR, "live.json");
  var LIVE_TMP = path.join(DIR, "live.json.tmp");
  var META = path.join(DIR, "meta.json");
  var MAX_BUFFER = 5000;

  // ---------------------------------------------------------------- state
  var meta = { nextRun: 1, nextBranch: 1, nextSeq: 1 };
  var run = null, branch = null;
  var buffer = [];            // serialized records not yet appended
  // State changes not yet written, grouped per src+cmd within the current flush window
  // (closed at flush or before the next non-state record): [{ t, src, cmd, changes, at }].
  var pendingGroups = [];
  var groupByKey = {};
  var currentCtx = null;      // { src, cmd } of the command being executed
  var pendingChoiceCtx = null;
  var lastChoices = null;     // { src, cmd, options } for live.json
  var deferredNewGame = false;
  var lastErrorT = -Infinity;
  var errorTimes = {}, errorCount = 0; // message -> time it was last written
  var ERROR_REPEAT_MS = 60000;
  var lastLiveBody = null, lastLiveT = 0;

  function isCount(n) { return typeof n === "number" && isFinite(n) && n >= 1 && Math.floor(n) === n; }

  function loadMeta() {
    try {
      if (fs.existsSync(META)) {
        var m = JSON.parse(fs.readFileSync(META, "utf8"));
        if (m && isCount(m.nextRun) && isCount(m.nextBranch) && isCount(m.nextSeq)) {
          meta = { nextRun: m.nextRun, nextBranch: m.nextBranch, nextSeq: m.nextSeq };
          return;
        }
      }
    } catch (e) { /* fall through to log scan */ }
    try {
      if (!fs.existsSync(LOG)) return;
      var lines = String(fs.readFileSync(LOG, "utf8")).split("\n");
      for (var i = 0; i < lines.length; i++) {
        if (!lines[i]) continue;
        try {
          var r = JSON.parse(lines[i]);
          if (isCount(r.seq) && r.seq >= meta.nextSeq) meta.nextSeq = r.seq + 1;
          if (isCount(r.run) && r.run >= meta.nextRun) meta.nextRun = r.run + 1;
          if (isCount(r.branch) && r.branch >= meta.nextBranch) meta.nextBranch = r.branch + 1;
        } catch (e2) { /* skip broken line */ }
      }
    } catch (e3) { /* keep defaults */ }
  }

  function ensureDir() {
    if (!fs.existsSync(DIR)) fs.mkdirSync(DIR);
  }

  // ---------------------------------------------------------------- records
  function makeRecord(type, t) {
    return { v: 1, seq: meta.nextSeq++, t: t, run: run || 0, branch: branch || 0, type: type };
  }

  function pushLine(rec) {
    if (buffer.length >= MAX_BUFFER) buffer.shift();
    buffer.push(JSON.stringify(rec));
  }

  function closeState() {
    if (!pendingGroups.length) return;
    var groups = pendingGroups;
    pendingGroups = [];
    groupByKey = {};
    if (run === null) return;
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      var rec = makeRecord("state", g.t);
      rec.src = g.src; rec.cmd = g.cmd; rec.changes = g.changes;
      pushLine(rec);
    }
  }

  function emit(type, fields) {
    if (run === null && type !== "error") return;
    closeState();
    var rec = makeRecord(type, now());
    for (var k in fields) if (Object.prototype.hasOwnProperty.call(fields, k)) rec[k] = fields[k];
    pushLine(rec);
  }

  function reportError(e) {
    try {
      var message = e && e.message ? String(e.message) : String(e);
      var t = now();
      var key = "m:" + message;
      // a hook failing every frame: write the same message at most once a minute
      if (Object.prototype.hasOwnProperty.call(errorTimes, key) && t - errorTimes[key] < ERROR_REPEAT_MS) return;
      if (t - lastErrorT < 1000) return;
      lastErrorT = t;
      if (errorCount >= 100) { errorTimes = {}; errorCount = 0; }
      if (!Object.prototype.hasOwnProperty.call(errorTimes, key)) errorCount++;
      errorTimes[key] = t;
      emit("error", { message: message });
    } catch (ignore) { /* never throw */ }
  }

  // Parallel events changing variables every frame would otherwise produce a record per frame:
  // within a flush window, one group per src+cmd and only the last value per (kind, id).
  //
  // Variables changing more than FREQ_COUNT times within FREQ_WINDOW_MS are throttled to one
  // record per FREQ_EMIT_MS (the latest value is kept pending and emitted once allowed).
  var FREQ_WINDOW_MS = 60000, FREQ_COUNT = 30, FREQ_EMIT_MS = 10000;
  var varTimes = {};    // id -> last FREQ_COUNT+1 change times (bounded)
  var varLastEmit = {}; // id -> time of the last recorded change
  var varPending = {};  // id -> { value, src, cmd } not yet recorded
  var varPendingCount = 0;

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function setPending(id, p) {
    if (!has(varPending, id)) varPendingCount++;
    varPending[id] = p;
  }

  function clearPending(id) {
    if (has(varPending, id)) { delete varPending[id]; varPendingCount--; }
  }

  // Returns true when this variable change should be recorded now.
  function admitVariable(id, value, src, cmd) {
    var t = now();
    var key = String(id);
    var times = has(varTimes, key) ? varTimes[key] : (varTimes[key] = []);
    times.push(t);
    if (times.length > FREQ_COUNT + 1) times.shift();
    var frequent = times.length > FREQ_COUNT && t - times[0] <= FREQ_WINDOW_MS;
    var last = has(varLastEmit, key) ? varLastEmit[key] : -Infinity;
    if (!frequent || t - last >= FREQ_EMIT_MS) {
      varLastEmit[key] = t;
      clearPending(key);
      return true;
    }
    setPending(key, { id: id, value: value, src: src, cmd: cmd });
    return false;
  }

  // Record pending latest values whose 10s has elapsed (all of them when force is set).
  function releasePending(force) {
    if (!varPendingCount) return;
    var t = now();
    for (var key in varPending) {
      if (!has(varPending, key)) continue;
      if (!force && t - (has(varLastEmit, key) ? varLastEmit[key] : -Infinity) < FREQ_EMIT_MS) continue;
      var p = varPending[key];
      clearPending(key);
      varLastEmit[key] = t;
      addChange("variable", p.id, p.value, p.src, p.cmd);
    }
  }

  function recordChange(kind, id, value) {
    if (run === null) return;
    var src = currentCtx ? currentCtx.src : null;
    var cmd = currentCtx ? currentCtx.cmd : null;
    if (kind === "variable" && !admitVariable(id, value, src, cmd)) return;
    addChange(kind, id, value, src, cmd);
  }

  function addChange(kind, id, value, src, cmd) {
    if (run === null) return;
    var gkey = JSON.stringify(src) + "#" + cmd;
    var g = Object.prototype.hasOwnProperty.call(groupByKey, gkey) ? groupByKey[gkey] : null;
    if (!g) {
      g = { t: now(), src: src, cmd: cmd, changes: [], at: {} };
      groupByKey[gkey] = g;
      pendingGroups.push(g);
    }
    var ckey = kind + ":" + id;
    if (Object.prototype.hasOwnProperty.call(g.at, ckey)) {
      g.changes[g.at[ckey]].value = value;
    } else {
      g.at[ckey] = g.changes.length;
      g.changes.push({ kind: kind, id: id, value: value });
    }
  }

  function startBranch(reason, newRun, parentBranch, fromSeq) {
    releasePending(true); // belongs to the branch that is ending
    closeState();
    varTimes = {}; varLastEmit = {}; varPending = {}; varPendingCount = 0;
    run = newRun;
    branch = meta.nextBranch++;
    lastChoices = null;
    deferredNewGame = false;
    emit("branchStart", { reason: reason, parentBranch: parentBranch, fromSeq: fromSeq });
  }

  function flush() {
    releasePending(false);
    closeState();
    if (!buffer.length) return;
    var lines = buffer;
    buffer = [];
    try {
      ensureDir();
      fs.appendFileSync(LOG, lines.join("\n") + "\n");
    } catch (e) {
      buffer = lines.concat(buffer).slice(-MAX_BUFFER);
      throw e;
    }
    fs.writeFileSync(META, JSON.stringify(meta));
  }

  // ---------------------------------------------------------------- snapshot
  function trueIds(data) {
    var out = [];
    if (!data) return out;
    for (var i = 1; i < data.length; i++) if (data[i] === true) out.push(i);
    return out;
  }

  function counts(obj) {
    var out = {};
    if (!obj) return out;
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k) && typeof obj[k] === "number" && obj[k] > 0) out[k] = obj[k];
    }
    return out;
  }

  function buildSnapshot() {
    var map = G.$gameMap, player = G.$gamePlayer, sw = G.$gameSwitches, vars = G.$gameVariables;
    var ss = G.$gameSelfSwitches, party = G.$gameParty, msg = G.$gameMessage;
    if (run === null || !map || !player || !sw || !vars || !ss || !party) return null;
    var inBattle = !!(party.inBattle && party.inBattle());
    var inner = inBattle && G.$gameTroop ? G.$gameTroop._interpreter : map._interpreter;
    var depth = 0;
    while (inner && inner._childInterpreter && inner._childInterpreter.isRunning && inner._childInterpreter.isRunning() && depth < 32) {
      inner = inner._childInterpreter; depth++;
    }
    var active = !!(inner && inner.isRunning && inner.isRunning());
    var events = [];
    var list = map.events();
    for (var i = 0; i < list.length; i++) {
      var ev = list[i];
      if (!ev) continue;
      var page = typeof ev._pageIndex === "number" ? ev._pageIndex : -1;
      events.push({ eventId: ev.eventId(), page: page });
    }
    var variables = {};
    var vdata = vars._data || [];
    for (var v = 1; v < vdata.length; v++) {
      if (typeof vdata[v] === "number" && vdata[v] !== 0) variables[v] = vdata[v];
    }
    var selfSwitches = [];
    var sdata = ss._data || {};
    for (var key in sdata) {
      if (Object.prototype.hasOwnProperty.call(sdata, key) && sdata[key] === true) selfSwitches.push(key);
    }
    var choice = null;
    if (msg && msg.isChoice && msg.isChoice() && lastChoices) {
      choice = { src: lastChoices.src, cmd: lastChoices.cmd, options: lastChoices.options };
    }
    return {
      v: 1, t: 0, pluginVersion: bridge.VERSION,
      run: run, branch: branch, seq: meta.nextSeq - 1,
      mapId: map.mapId(), x: player.x, y: player.y,
      running: active ? (inner._rpgvSrc || null) : null,
      runningCmd: active && typeof inner._index === "number" ? inner._index : null,
      events: events,
      switches: trueIds(sw._data),
      variables: variables,
      selfSwitches: selfSwitches,
      items: counts(party._items), weapons: counts(party._weapons), armors: counts(party._armors),
      gold: typeof party._gold === "number" ? party._gold : 0,
      party: (party._actors || []).slice(),
      choice: choice,
      inBattle: inBattle
    };
  }

  // Title (or boot) scene: objects may still hold the previous play; let live.json go stale.
  function inTitleScene() {
    var scene = G.SceneManager && G.SceneManager._scene;
    if (!scene) return false;
    return !!((G.Scene_Title && scene instanceof G.Scene_Title) || (G.Scene_Boot && scene instanceof G.Scene_Boot));
  }

  function writeLive(force) {
    if (inTitleScene()) return;
    var snap = buildSnapshot();
    if (!snap) return;
    var body = JSON.stringify(snap);
    var t = now();
    // changes: at most once per second; unchanged: heartbeat every 2 seconds
    if (!force && t - lastLiveT < (body === lastLiveBody ? 2000 : 1000)) return;
    lastLiveBody = body;
    lastLiveT = t;
    snap.t = t;
    var json = JSON.stringify(snap);
    ensureDir();
    fs.writeFileSync(LIVE_TMP, json);
    try {
      fs.renameSync(LIVE_TMP, LIVE);
    } catch (e) {
      fs.writeFileSync(LIVE, json); // e.g. Windows refusing to replace a file the viewer has open
    }
  }

  function tick() {
    try { flush(); } catch (e) { reportError(e); }
    try { writeLive(false); } catch (e2) { reportError(e2); }
  }

  bridge._flushNow = function () { try { flush(); } catch (e) { reportError(e); } };
  bridge._snapshotNow = function () { try { writeLive(true); } catch (e) { reportError(e); } };
  bridge._tick = tick;

  // ---------------------------------------------------------------- engine helpers
  function resolveSource(list, eventId) {
    if (!list) return null;
    var i;
    var map = G.$gameMap;
    if (eventId > 0 && map && map.event) {
      var ev = map.event(eventId);
      var data = ev && ev.event ? ev.event() : null;
      var pages = data && data.pages;
      if (pages) {
        for (i = 0; i < pages.length; i++) {
          if (pages[i] && pages[i].list === list) {
            return { source: "map", mapId: map.mapId(), eventId: eventId, page: i };
          }
        }
      }
    }
    var ces = G.$dataCommonEvents;
    if (ces) {
      for (i = 1; i < ces.length; i++) {
        if (ces[i] && ces[i].list === list) return { source: "common", commonEventId: i };
      }
    }
    var troop = G.$gameTroop;
    var td = troop && troop.troop ? troop.troop() : null;
    if (td && td.pages) {
      for (i = 0; i < td.pages.length; i++) {
        if (td.pages[i] && td.pages[i].list === list) {
          return { source: "troop", troopId: troop._troopId, page: i };
        }
      }
    }
    return null;
  }

  // Index of the current command if it has the given code, else -1.
  function cmdAt(interp, code) {
    var list = interp._list;
    var c = list ? list[interp._index] : null;
    return c && c.code === code ? interp._index : -1;
  }

  function joinedText(list, from, code) {
    var lines = [];
    for (var i = from; i < list.length && list[i] && list[i].code === code; i++) {
      lines.push(String(list[i].parameters[0]));
    }
    return lines.join("\n");
  }

  function messageBusy() {
    var m = G.$gameMessage;
    return !!(m && m.isBusy && m.isBusy());
  }

  function srcOf(interp) { return interp._rpgvSrc || null; }

  // ---------------------------------------------------------------- hooks
  function hook(owner, ownerName, name, make) {
    if (!owner || typeof owner[name] !== "function") return;
    owner[name] = make(owner[name]);
    bridge._hooks.push(ownerName + "." + name);
  }

  function install() {
    var GI = G.Game_Interpreter && G.Game_Interpreter.prototype;
    if (!GI || GI.__rpgvInstalled) return;
    Object.defineProperty(GI, "__rpgvInstalled", { value: true, enumerable: false });

    hook(GI, "Game_Interpreter", "setup", function (orig) {
      return function (list, eventId) {
        var r = orig.apply(this, arguments);
        try {
          this._rpgvSrc = null;
          this._rpgvSrc = resolveSource(list, eventId);
        } catch (e) { reportError(e); }
        return r;
      };
    });

    hook(GI, "Game_Interpreter", "executeCommand", function (orig) {
      return function () {
        var prev = currentCtx;
        var ctx = null;
        try { ctx = { src: srcOf(this), cmd: this._index }; } catch (e) { reportError(e); }
        currentCtx = ctx;
        try {
          return orig.apply(this, arguments);
        } finally {
          currentCtx = prev;
        }
      };
    });

    hook(GI, "Game_Interpreter", "command101", function (orig) {
      return function () {
        try {
          var i = cmdAt(this, 101);
          if (i >= 0 && run !== null && !messageBusy()) {
            var p = this._list[i].parameters || [];
            emit("message", {
              src: srcOf(this), cmd: i,
              face: p[0] == null ? "" : String(p[0]),
              faceIndex: typeof p[1] === "number" ? p[1] : 0,
              speaker: p[4] == null ? "" : String(p[4]),
              text: joinedText(this._list, i + 1, 401)
            });
          }
        } catch (e) { reportError(e); }
        return orig.apply(this, arguments);
      };
    });

    // setupChoices covers both a standalone 102 and a 102 shown inline by command101.
    var choiceTarget = typeof GI.setupChoices === "function" ? "setupChoices" : "command102";
    hook(GI, "Game_Interpreter", choiceTarget, function (orig) {
      return function () {
        var ctx = null;
        try {
          var i = cmdAt(this, 102);
          if (i >= 0 && run !== null && (choiceTarget === "setupChoices" || !messageBusy())) {
            var opts = this._list[i].parameters[0] || [];
            var options = [];
            for (var k = 0; k < opts.length; k++) options.push(String(opts[k]));
            ctx = { src: srcOf(this), cmd: i };
            lastChoices = { src: ctx.src, cmd: i, options: options };
            emit("choices", { src: ctx.src, cmd: i, options: options });
          }
        } catch (e) { reportError(e); }
        pendingChoiceCtx = ctx;
        try {
          return orig.apply(this, arguments);
        } finally {
          pendingChoiceCtx = null;
        }
      };
    });

    var GM = G.Game_Message && G.Game_Message.prototype;
    hook(GM, "Game_Message", "setChoiceCallback", function (orig) {
      return function (callback) {
        var args = arguments;
        try {
          var ctx = pendingChoiceCtx;
          if (ctx && typeof callback === "function") {
            pendingChoiceCtx = null;
            args = [function (n) {
              try { emit("choice", { src: ctx.src, cmd: ctx.cmd, picked: n }); } catch (e) { reportError(e); }
              return callback.apply(this, arguments);
            }];
          }
        } catch (e) { reportError(e); }
        return orig.apply(this, args);
      };
    });

    hook(GI, "Game_Interpreter", "command105", function (orig) {
      return function () {
        try {
          var i = cmdAt(this, 105);
          if (i >= 0 && run !== null && !messageBusy()) {
            emit("scroll", { src: srcOf(this), cmd: i, text: joinedText(this._list, i + 1, 405) });
          }
        } catch (e) { reportError(e); }
        return orig.apply(this, arguments);
      };
    });

    hook(GI, "Game_Interpreter", "command231", function (orig) {
      return function () {
        try {
          var i = cmdAt(this, 231);
          if (i >= 0 && run !== null) {
            var p = this._list[i].parameters || [];
            emit("picture", { src: srcOf(this), cmd: i, pictureId: p[0], name: p[1] == null ? "" : String(p[1]) });
          }
        } catch (e) { reportError(e); }
        return orig.apply(this, arguments);
      };
    });

    function hookSetValue(ctorName, kind) {
      var C = G[ctorName];
      hook(C && C.prototype, ctorName, "setValue", function (orig) {
        return function (id) {
          var before, ok = false;
          try { if (run !== null) { before = this.value(id); ok = true; } } catch (e) { reportError(e); }
          var r = orig.apply(this, arguments);
          if (ok) {
            try {
              var after = this.value(id);
              // variables can hold strings/arrays/objects (script calls): log only numbers and booleans, skip the rest
              var loggable = kind !== "variable" || typeof after === "number" || typeof after === "boolean";
              if (loggable && after !== before) {
                var key = kind === "selfSwitch" ? (id && id.join ? id.join(",") : String(id)) : id;
                recordChange(kind, key, after);
              }
            } catch (e2) { reportError(e2); }
          }
          return r;
        };
      });
    }
    hookSetValue("Game_Switches", "switch");
    hookSetValue("Game_Variables", "variable");
    hookSetValue("Game_SelfSwitches", "selfSwitch");

    var GP = G.Game_Player && G.Game_Player.prototype;
    hook(GP, "Game_Player", "performTransfer", function (orig) {
      return function () {
        var was = false;
        try {
          was = !!this.isTransferring();
          if (was && run === null && deferredNewGame && !inTitleScene()) startBranch("newGame", meta.nextRun++, null, null);
        } catch (e) { reportError(e); }
        var r = orig.apply(this, arguments);
        try {
          if (was && run !== null) emit("transfer", { mapId: G.$gameMap.mapId(), x: this.x, y: this.y });
        } catch (e2) { reportError(e2); }
        return r;
      };
    });

    var BM = G.BattleManager;
    hook(BM, "BattleManager", "setup", function (orig) {
      return function (troopId) {
        var r = orig.apply(this, arguments);
        try { emit("battle", { phase: "start", troopId: troopId }); } catch (e) { reportError(e); }
        return r;
      };
    });
    hook(BM, "BattleManager", "endBattle", function (orig) {
      return function (result) {
        try {
          var names = ["win", "escape", "lose"];
          var fields = { phase: "end", troopId: G.$gameTroop ? G.$gameTroop._troopId : 0 };
          if (names[result]) fields.result = names[result];
          emit("battle", fields);
        } catch (e) { reportError(e); }
        return orig.apply(this, arguments);
      };
    });

    var DM = G.DataManager;
    hook(DM, "DataManager", "setupNewGame", function (orig) {
      return function () {
        try {
          var scene = G.SceneManager && G.SceneManager._scene;
          if (G.Scene_Boot && scene instanceof G.Scene_Boot) deferredNewGame = true; // boot, not a real new game
          else startBranch("newGame", meta.nextRun++, null, null);
        } catch (e) { reportError(e); }
        return orig.apply(this, arguments);
      };
    });

    hook(DM, "DataManager", "makeSaveContents", function (orig) {
      return function () {
        var contents = orig.apply(this, arguments);
        try {
          if (run !== null && contents && typeof contents === "object") {
            releasePending(true);
            closeState();
            contents.rpgViewer = { run: run, branch: branch, seq: meta.nextSeq - 1 };
          }
        } catch (e) { reportError(e); }
        return contents;
      };
    });

    hook(DM, "DataManager", "extractSaveContents", function (orig) {
      return function (contents) {
        var r = orig.apply(this, arguments);
        try {
          var s = contents && contents.rpgViewer;
          if (s && isCount(s.run) && isCount(s.branch) && typeof s.seq === "number") {
            if (meta.nextRun <= s.run) meta.nextRun = s.run + 1;
            if (meta.nextBranch <= s.branch) meta.nextBranch = s.branch + 1;
            if (meta.nextSeq <= s.seq) meta.nextSeq = s.seq + 1; // save from a reset/copied log
            startBranch("load", s.run, s.branch, s.seq);
          } else {
            startBranch("unknownSave", meta.nextRun++, null, null);
          }
        } catch (e) { reportError(e); }
        return r;
      };
    });

    // A save's stamp references seq numbers that may still be buffered: flush right after a
    // successful save so the stamped seq is on disk (and meta.json is current) before a crash.
    function afterSuccess(type, slot, result) {
      var done = function () {
        emit(type, { slot: slot });
        if (type === "save") flush();
      };
      if (result && typeof result.then === "function") {
        result.then(function () {
          try { done(); } catch (e) { reportError(e); }
        }, function () { /* failure is the game's to handle */ });
      } else if (result) {
        done();
      }
    }
    hook(DM, "DataManager", "saveGame", function (orig) {
      return function (savefileId) {
        var r = orig.apply(this, arguments);
        try { afterSuccess("save", savefileId, r); } catch (e) { reportError(e); }
        return r;
      };
    });
    hook(DM, "DataManager", "loadGame", function (orig) {
      return function (savefileId) {
        var r = orig.apply(this, arguments);
        try { afterSuccess("load", savefileId, r); } catch (e) { reportError(e); }
        return r;
      };
    });
  }

  try {
    if (fs.existsSync(LIVE_TMP)) fs.unlinkSync(LIVE_TMP); // left over from a crash mid-write
  } catch (e) { /* harmless: overwritten on next snapshot */ }
  try {
    loadMeta();
    install();
  } catch (e) {
    reportError(e);
  }

  if (!T) {
    try {
      setInterval(tick, 250);
      if (typeof window !== "undefined" && window.addEventListener) {
        var onUnload = function () {
          try { releasePending(true); } catch (e1) { reportError(e1); }
          bridge._flushNow();
        };
        window.addEventListener("beforeunload", onUnload);
        window.addEventListener("unload", onUnload);
      }
    } catch (e) { /* timers unavailable: hooks still buffer */ }
  }
})();
