/*:
 * @target MZ MV
 * @plugindesc RPG Viewer 기록 플러그인
 * @author RPG Viewer
 * @help
 * RPG Viewer가 설치하는 기록 플러그인입니다.
 * 게임 폴더의 rpg-viewer/ 아래에 플레이 기록(log.jsonl)과
 * 현재 상태(live.json)를 남깁니다.
 * RPG Viewer의 "게임 보조"(rpg-viewer/control.json)나 아래 단축키를 쓰지 않으면
 * 게임 화면과 진행에는 영향을 주지 않습니다.
 * 플러그인 명령이나 파라미터는 없습니다.
 * 게임 창 단축키: F6 배속(×1→×2→×4→×8), F7 본 대사 자동 넘기기,
 * 전투 중 F10 이기기, F11 지기. 선택지는 자동으로 고르지 않습니다.
 * 변수 변경은 숫자·참/거짓 값만 기록합니다(문자열·배열 등은 기록하지 않음).
 * 같은 명령이 매 프레임 바꾸는 값은 0.25초마다 마지막 값만 남깁니다.
 * 이벤트가 실행한 플러그인 명령(MV 356 / MZ 357)의 이름과 문자열 인자도
 * 기록합니다. 병렬 이벤트·병렬 커먼 이벤트의 것은 기록하지 않습니다.
 * RPG Viewer에서 "화면 그림 따라 그리기"를 켠 게임에서만, 대사 글자가 그려지기
 * 시작할 때 화면에 실제로 보이는 그림(스탠딩 이미지 등)의 이름·위치·크기도
 * 기록합니다(숨겨졌거나 투명한 그림은 빼고).
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
    VERSION: "1.7.0",
    _flushNow: function () {},
    _snapshotNow: function () {},
    _tick: function () {},
    _runScheduled: function () {},
    _frame: function () { return 1; },
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
  var CONTROL = path.join(DIR, "control.json");
  var MAX_BUFFER = 5000;

  // ---------------------------------------------------------------- state
  var meta = { nextRun: 1, nextBranch: 1, nextSeq: 1 };
  var lastStory = {};         // branch -> { run, seq } of its last story record (seq 0 = none yet); a legacy plain number = seq with unknown run; persisted in meta.json
  var run = null, branch = null;
  var buffer = [];            // serialized records not yet appended
  // State changes not yet written, grouped per src+cmd within the current flush window
  // (closed at flush or before the next non-state record): [{ t, src, cmd, changes, at }].
  var pendingGroups = [];
  var groupByKey = {};
  var currentCtx = null;      // { src, cmd } of the command being executed
  var childParentSrc = null;  // source of the interpreter running setupChild (while it runs)
  var pendingChoiceCtx = null;
  var lastChoices = null;     // { src, cmd, options } for live.json
  var deferredNewGame = false;
  var lastErrorT = -Infinity;
  var errorTimes = {}, errorCount = 0; // message -> time it was last written
  var ERROR_REPEAT_MS = 60000;
  var lastLiveBody = null, lastLiveT = 0;

  // game assist (control.json from the viewer, hotkeys in game)
  var SPEED_OK = { 1: true, 2: true, 4: true, 8: true };
  var SPEED_NEXT = { 1: 2, 2: 4, 4: 8, 8: 1 };
  var COMMAND_KINDS = { win: true, lose: true, escape: true };
  var CONTROL_POLL_MS = 1000, COMMAND_MAX_AGE_MS = 10000, AUTO_ADVANCE_UPDATES = 6, MAX_SPEED = 8;
  var KEY_SPEED = "rpgvSpeed", KEY_SKIP = "rpgvSkip", KEY_WIN = "rpgvWin", KEY_LOSE = "rpgvLose";
  var HOTKEY_NAMES = ["speed", "skip", "win", "lose"];
  var HOTKEY_BUTTONS = { speed: KEY_SPEED, skip: KEY_SKIP, win: KEY_WIN, lose: KEY_LOSE };
  var HOTKEY_DEFAULTS = { speed: 117, skip: 118, win: 121, lose: 122 }; // F6 F7 F10 F11
  // keyCodes the engine itself uses (default Input.keyMapper, F2-F5, F8, F9): never offered as hotkeys
  var RESERVED_KEYS = {
    9: true, 13: true, 16: true, 17: true, 18: true, 27: true, 32: true, 33: true, 34: true,
    37: true, 38: true, 39: true, 40: true, 45: true, 81: true, 87: true, 88: true, 90: true,
    96: true, 98: true, 100: true, 102: true, 104: true,
    113: true, 114: true, 115: true, 116: true, 119: true, 120: true
  };
  var hotkeys = { speed: 117, skip: 118, win: 121, lose: 122 }; // wanted bindings (null = disabled)
  var mappedKeys = {};        // keyCode -> button name this plugin put into Input.keyMapper
  var assist = { speed: 1, skipSeen: false, autoFast: false, autoSpeed: 8 };
  var seenMessages = Object.create(null), seenPages = Object.create(null);
  // last speed/skipSeen taken from control.json: a rewrite with the same value does not undo a hotkey change
  var ctrlSpeed = null, ctrlSkip = null;
  var lastControlKey = null, lastControlText = null, lastControlPollT = -Infinity;
  var lastCommandId = null, lastCommand = null, pendingCommand = null;
  var controlT = null;        // "t" of the last applied control.json (null = none applied this session)
  var battleStartT = -Infinity; // when the current battle was set up: older commands never apply to it
  var effectiveSpeed = 1;
  var pendingMsgKey = null;   // seen key of the message command101 just set up
  var inFrame = false;
  var extraUpdate = false;
  // screen picture capture (1.6.0, control.json "capturePictures"; off by default)
  var capturePictures = false;
  var lastPicsKey = null;     // JSON of the last picture snapshot written in this branch (null = none yet)
  var PICS_MAX = 60, PIC_NAME_MAX = 200, PICS_SCAN_MAX = 1000;
  // 1.7.0: a message record waits in the buffer (unserialized) until its text starts drawing, then takes the
  // snapshot of what is actually on screen; flushes write only up to it (at most PICS_HOLD_MS, then snapshot now).
  var heldMsg = null;         // { rec, t } — also the buffer entry itself
  var PICS_HOLD_MS = 1000, PICS_TREE_MAX = 3000;    // inside an extra (sped-up) scene update: input queries report nothing new

  function isCount(n) { return typeof n === "number" && isFinite(n) && n >= 1 && Math.floor(n) === n; }

  function loadMeta() {
    try {
      if (fs.existsSync(META)) {
        var m = JSON.parse(fs.readFileSync(META, "utf8"));
        if (m && isCount(m.nextRun) && isCount(m.nextBranch) && isCount(m.nextSeq)) {
          meta = { nextRun: m.nextRun, nextBranch: m.nextBranch, nextSeq: m.nextSeq };
          if (m.lastStory && typeof m.lastStory === "object") {
            for (var b in m.lastStory) {
              if (Object.prototype.hasOwnProperty.call(m.lastStory, b) && isCount(Number(b)) && validStoryEntry(m.lastStory[b])) lastStory[b] = m.lastStory[b];
            }
          }
        }
      }
    } catch (e) { /* the bounded log-tail scan (raiseMetaFromLog) recovers the counters */ }
  }

  function isNonNeg(n) { return typeof n === "number" && isFinite(n) && n >= 0 && Math.floor(n) === n; }
  var STORY = { message: true, scroll: true, choices: true, choice: true, picture: true };
  var MAX_STORY_BRANCHES = 200;
  function validStoryEntry(e) {
    return isNonNeg(e) || (e !== null && typeof e === "object" && isCount(e.run) && isNonNeg(e.seq));
  }
  function entrySeq(e) { return typeof e === "number" ? e : e.seq; }
  function noteStory(b, seq, r) { // seq 0 = branch seen, no story records yet; r = run (omit if unknown)
    if (!isCount(b)) return;
    var has = Object.prototype.hasOwnProperty.call(lastStory, b);
    var cur = has ? lastStory[b] : null;
    if (!isCount(r)) { // run unknown: legacy numeric behaviour, never downgrade a known run
      if (!has || (typeof cur === "number" && cur < seq)) lastStory[b] = seq;
      return;
    }
    if (!has || typeof cur === "number" || cur.run !== r) lastStory[b] = { run: r, seq: has && typeof cur === "number" && cur > seq ? cur : seq };
    else if (cur.seq < seq) cur.seq = seq;
  }
  function prunedStory() {
    var keys = Object.keys(lastStory);
    if (keys.length <= MAX_STORY_BRANCHES) return lastStory;
    keys.sort(function (x, y) { return Number(y) - Number(x); }); // newest branches first
    var out = {};
    for (var i = 0; i < MAX_STORY_BRANCHES; i++) out[keys[i]] = lastStory[keys[i]];
    lastStory = out;
    return out;
  }

  // meta.json can lag behind the log (it is written on a timer): raise the counters above
  // whatever the last ~64KB of the log shows so new records never reuse a seq.
  var TAIL_BYTES = 65536;
  // Limitation: a single line longer than 64KB cannot be recovered from the tail (the cut first
  // line is dropped); records are far smaller than that in practice.
  function readLogTail() {
    var text, partial = false;
    if (typeof fs.statSync === "function" && typeof fs.openSync === "function" && typeof fs.readSync === "function") {
      var size = fs.statSync(LOG).size;
      var start = Math.max(0, size - TAIL_BYTES);
      var len = size - start;
      var buf = typeof Buffer.alloc === "function" ? Buffer.alloc(len) : new Buffer(len);
      var fd = fs.openSync(LOG, "r");
      var got = 0;
      try { got = fs.readSync(fd, buf, 0, len, start); } finally { try { fs.closeSync(fd); } catch (ec) { /* ignore */ } }
      if (typeof got !== "number" || !(got >= 0) || got > len) got = 0;
      text = buf.slice(0, got).toString("utf8"); // never decode bytes that were not read
      partial = start > 0;
    } else {
      text = String(fs.readFileSync(LOG, "utf8")); // no fd API at all: nothing better available
      if (text.length > TAIL_BYTES) { text = text.slice(-TAIL_BYTES); partial = true; }
    }
    var lines = text.split("\n");
    if (partial) lines.shift(); // first line is cut
    return lines;
  }
  function raiseMetaFromLog() {
    try {
      if (!fs.existsSync(LOG)) return;
      var lines = readLogTail();
      for (var i = 0; i < lines.length; i++) {
        if (!lines[i]) continue;
        try {
          var r = JSON.parse(lines[i]);
          if (isCount(r.seq) && r.seq >= meta.nextSeq) meta.nextSeq = r.seq + 1;
          if (isCount(r.run) && r.run >= meta.nextRun) meta.nextRun = r.run + 1;
          if (isCount(r.branch) && r.branch >= meta.nextBranch) meta.nextBranch = r.branch + 1;
          if (r.type === "branchStart") noteStory(r.branch, 0, r.run);
          else if (STORY[r.type] === true && isCount(r.seq)) noteStory(r.branch, r.seq, r.run);
        } catch (e2) { /* skip broken line */ }
      }
    } catch (e3) { reportError(e3); /* skip recovery; never read the whole log */ }
  }

  var lastMetaJson = null;
  function writeMeta() {
    var json = JSON.stringify({ nextRun: meta.nextRun, nextBranch: meta.nextBranch, nextSeq: meta.nextSeq, lastStory: prunedStory() });
    if (json === lastMetaJson) return;
    fs.writeFileSync(META, json);
    lastMetaJson = json;
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

  // hold: keep the record unserialized until finishHeld() attaches its picture snapshot
  function emit(type, fields, hold) {
    if (run === null && type !== "error") return;
    closeState();
    var rec = makeRecord(type, now());
    for (var k in fields) if (Object.prototype.hasOwnProperty.call(fields, k)) rec[k] = fields[k];
    if (STORY[type] === true) noteStory(rec.branch, rec.seq, rec.run);
    if (hold) pushHeld(rec);
    else pushLine(rec);
    if (IMMEDIATE[type] === true) scheduleFlush();
  }

  function pushHeld(rec) {
    finishHeld();
    if (buffer.length >= MAX_BUFFER) buffer.shift();
    heldMsg = { rec: rec, t: now() };
    buffer.push(heldMsg);
  }

  // Attach the picture snapshot (taken now) to the held message and serialize it in place.
  function finishHeld() {
    var h = heldMsg;
    if (!h) return;
    heldMsg = null;
    var pf = null;
    try { pf = picsFields(); } catch (e) { reportError(e); }
    if (pf && pf.pics) h.rec.pics = pf.pics;
    else if (pf) h.rec.picsSame = true;
    for (var i = 0; i < buffer.length; i++) {
      if (buffer[i] === h) { buffer[i] = JSON.stringify(h.rec); return; }
    }
  }

  // Dialogue-flow records reach disk at the end of the current frame instead of the next 250ms tick.
  var IMMEDIATE = { message: true, scroll: true, choices: true, choice: true, picture: true, transfer: true };
  var flushScheduled = false;
  var MIN_FLUSH_GAP_MS = 50, lastFlushT = 0;
  function runScheduled() {
    if (!flushScheduled) return;
    var wait = MIN_FLUSH_GAP_MS - (now() - lastFlushT);
    if (wait > 0) { // too soon after the previous flush: keep the single pending flush for later
      if (!T) {
        try { setTimeout(runScheduled, wait); } catch (e0) { flushScheduled = false; }
      }
      return;
    }
    flushScheduled = false;
    try { flush(); } catch (e) { reportError(e); }
  }
  function scheduleFlush() {
    if (flushScheduled) return;
    flushScheduled = true;
    if (T) return; // tests run it through bridge._runScheduled()
    try {
      var wait = MIN_FLUSH_GAP_MS - (now() - lastFlushT);
      setTimeout(runScheduled, wait > 0 ? wait : 0);
    } catch (e) { flushScheduled = false; /* the 250ms tick still flushes */ }
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

  // Returns ADMIT_HOLD (keep pending), ADMIT_PLAIN (record now) or ADMIT_THROTTLED
  // (record now, marked throttled: the variable is in throttled mode).
  var ADMIT_HOLD = 0, ADMIT_PLAIN = 1, ADMIT_THROTTLED = 2;
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
      return frequent ? ADMIT_THROTTLED : ADMIT_PLAIN;
    }
    setPending(key, { id: id, value: value, src: src, cmd: cmd });
    return ADMIT_HOLD;
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
      addChange("variable", p.id, p.value, p.src, p.cmd, true);
    }
  }

  function recordChange(kind, id, value) {
    if (run === null) return;
    var src = currentCtx ? currentCtx.src : null;
    var cmd = currentCtx ? currentCtx.cmd : null;
    var throttled = false;
    if (kind === "variable") {
      var admit = admitVariable(id, value, src, cmd);
      if (admit === ADMIT_HOLD) return;
      throttled = admit === ADMIT_THROTTLED;
    }
    addChange(kind, id, value, src, cmd, throttled);
  }

  // throttled: the change was recorded while the variable was throttled (the viewer then hides it).
  function addChange(kind, id, value, src, cmd, throttled) {
    if (run === null) return;
    var gkey = JSON.stringify(src) + "#" + cmd;
    var g = Object.prototype.hasOwnProperty.call(groupByKey, gkey) ? groupByKey[gkey] : null;
    if (!g) {
      g = { t: now(), src: src, cmd: cmd, changes: [], at: {} };
      groupByKey[gkey] = g;
      pendingGroups.push(g);
    }
    var ckey = kind + ":" + id;
    var c;
    if (Object.prototype.hasOwnProperty.call(g.at, ckey)) {
      c = g.changes[g.at[ckey]];
      c.value = value;
    } else {
      g.at[ckey] = g.changes.length;
      c = { kind: kind, id: id, value: value };
      g.changes.push(c);
    }
    if (throttled) c.throttled = true;
  }

  function startBranch(reason, newRun, parentBranch, fromSeq) {
    releasePending(true); // belongs to the branch that is ending
    closeState();
    finishHeld();
    varTimes = {}; varLastEmit = {}; varPending = {}; varPendingCount = 0;
    run = newRun;
    branch = meta.nextBranch++;
    lastChoices = null;
    lastPicsKey = null;
    deferredNewGame = false;
    emit("branchStart", { reason: reason, parentBranch: parentBranch, fromSeq: fromSeq });
    noteStory(branch, 0, run);
  }

  // Continue the stamped run/branch (no branchStart) when it has no story records after the stamp.
  function resumeBranch(r, b) {
    releasePending(true);
    closeState();
    finishHeld();
    varTimes = {}; varLastEmit = {}; varPending = {}; varPendingCount = 0;
    run = r;
    branch = b;
    lastChoices = null;
    lastPicsKey = null;
    deferredNewGame = false;
  }

  // force: also finish a held message now (saves, unload, tests)
  function flush(force) {
    releasePending(false);
    closeState();
    if (heldMsg && (force === true || now() - heldMsg.t >= PICS_HOLD_MS)) finishHeld();
    var n = buffer.length;
    for (var i = 0; i < buffer.length; i++) {
      if (typeof buffer[i] !== "string") { n = i; break; } // a held message: keep it and what follows
    }
    if (!n) return;
    lastFlushT = now();
    var lines = buffer.slice(0, n);
    buffer = buffer.slice(n);
    try {
      ensureDir();
      fs.appendFileSync(LOG, lines.join("\n") + "\n");
    } catch (e) {
      buffer = lines.concat(buffer).slice(-MAX_BUFFER);
      throw e;
    }
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
    var inner = innermost(inBattle);
    var active = !!inner;
    var events = [];
    var list = map.events();
    for (var i = 0; i < list.length; i++) {
      var ev = list[i];
      if (!ev) continue;
      var page = typeof ev._pageIndex === "number" ? ev._pageIndex : -1;
      var entry = { eventId: ev.eventId(), page: page };
      // live position (moving NPCs): the viewer draws markers / routes there
      if (typeof ev.x === "number" && typeof ev.y === "number") { entry.x = ev.x; entry.y = ev.y; }
      if (typeof ev._direction === "number") entry.d = ev._direction;
      events.push(entry);
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
      inBattle: inBattle,
      assist: {
        speed: assist.speed, effectiveSpeed: effectiveSpeed, skipSeen: assist.skipSeen,
        troopId: inBattle && G.$gameTroop && typeof G.$gameTroop._troopId === "number" ? G.$gameTroop._troopId : null,
        canEscape: inBattle && canEscapeNow(),
        canLose: inBattle && !!(G.BattleManager && G.BattleManager._canLose),
        lastCommand: lastCommand,
        controlT: controlT,
        capturePictures: capturePictures,
        hotkeys: effectiveHotkeys()
      }
    };
  }

  // Innermost running interpreter of the map (or of the troop in battle), or null.
  function innermost(inBattle) {
    var map = G.$gameMap;
    var inner = inBattle && G.$gameTroop ? G.$gameTroop._interpreter : (map ? map._interpreter : null);
    var depth = 0;
    while (inner && inner._childInterpreter && inner._childInterpreter.isRunning && inner._childInterpreter.isRunning() && depth < 32) {
      inner = inner._childInterpreter; depth++;
    }
    return inner && inner.isRunning && inner.isRunning() ? inner : null;
  }

  // Title (or boot) scene: objects may still hold the previous play; let live.json go stale.
  function inTitleScene() {
    var scene = G.SceneManager && G.SceneManager._scene;
    if (!scene) return false;
    return !!((G.Scene_Title && scene instanceof G.Scene_Title) || (G.Scene_Boot && scene instanceof G.Scene_Boot));
  }

  var lastUrgentKey = null;
  function writeLive(force) {
    if (inTitleScene()) return;
    var snap = buildSnapshot();
    if (!snap) return;
    var body = JSON.stringify(snap);
    var t = now();
    // changes: at most once per second; unchanged: heartbeat every 2 seconds
    // running / runningCmd / choice / mapId changes skip the 1s floor
    var urgentKey = JSON.stringify([snap.running, snap.runningCmd, snap.choice, snap.mapId, snap.assist]);
    var urgent = lastUrgentKey !== null && urgentKey !== lastUrgentKey;
    if (!force && !urgent && t - lastLiveT < (body === lastLiveBody ? 2000 : 1000)) return;
    lastUrgentKey = urgentKey;
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

  // ---------------------------------------------------------------- game assist
  function locKey(src) {
    if (!src) return null;
    if (src.source === "map") {
      return "map:" + src.mapId + ":" + src.eventId + ":" + src.page + (typeof src.origin === "number" ? ":o" + src.origin : "");
    }
    if (src.source === "common") return "common:" + src.commonEventId;
    if (src.source === "troop") return "troop:" + src.troopId + ":" + src.page;
    return null;
  }

  function stringSet(arr) {
    var out = Object.create(null);
    for (var i = 0; i < arr.length; i++) if (typeof arr[i] === "string") out[arr[i]] = true;
    return out;
  }

  function validHotkey(v) {
    return typeof v === "number" && isFinite(v) && Math.floor(v) === v && v >= 8 && v <= 255 && RESERVED_KEYS[v] !== true;
  }

  // control.json "hotkeys": keyCode or null (disabled) per entry; missing/invalid -> default,
  // a keyCode already taken by an earlier entry -> default if free, else disabled.
  function hotkeysFrom(h) {
    var out = {}, used = {};
    var obj = h && typeof h === "object" ? h : {};
    for (var i = 0; i < HOTKEY_NAMES.length; i++) {
      var name = HOTKEY_NAMES[i];
      var v = has(obj, name) ? obj[name] : undefined;
      if (v !== null && !validHotkey(v)) v = HOTKEY_DEFAULTS[name];
      if (v !== null && used[v] === true) v = used[HOTKEY_DEFAULTS[name]] === true ? null : HOTKEY_DEFAULTS[name];
      if (v !== null) used[v] = true;
      out[name] = v;
    }
    return out;
  }

  // Replace this plugin's Input.keyMapper entries with the wanted hotkeys; never overwrite
  // a mapping that belongs to the engine or another plugin.
  function applyKeyMap() {
    var I = G.Input;
    var km = I && I.keyMapper;
    if (!km || typeof km !== "object") return;
    for (var code in mappedKeys) {
      if (has(mappedKeys, code) && km[code] === mappedKeys[code]) delete km[code];
    }
    mappedKeys = {};
    for (var i = 0; i < HOTKEY_NAMES.length; i++) {
      var name = HOTKEY_NAMES[i], k = hotkeys[name];
      if (k === null || km[k] !== undefined) continue;
      km[k] = HOTKEY_BUTTONS[name];
      mappedKeys[k] = HOTKEY_BUTTONS[name];
    }
  }

  // Bindings that actually work (null when disabled or the key belongs to someone else).
  function effectiveHotkeys() {
    var out = {};
    var km = G.Input && G.Input.keyMapper;
    for (var i = 0; i < HOTKEY_NAMES.length; i++) {
      var name = HOTKEY_NAMES[i], k = hotkeys[name];
      out[name] = k !== null && km && typeof km === "object" && km[k] === HOTKEY_BUTTONS[name] ? k : null;
    }
    return out;
  }

  function stripBom(text) { return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text; }

  function applyControl(text) {
    var c;
    try { c = JSON.parse(stripBom(String(text))); } catch (ignore) { return; } // half-written / bad JSON: keep the old settings
    if (!c || typeof c !== "object" || c.v !== 1) return;
    controlT = typeof c.t === "number" && isFinite(c.t) ? c.t : null;
    if (typeof c.speed === "number" && SPEED_OK[c.speed] === true) {
      if (ctrlSpeed === null || c.speed !== ctrlSpeed) assist.speed = c.speed;
      ctrlSpeed = c.speed;
    }
    if (typeof c.skipSeen === "boolean") {
      if (ctrlSkip === null || c.skipSeen !== ctrlSkip) assist.skipSeen = c.skipSeen;
      ctrlSkip = c.skipSeen;
    }
    if (typeof c.autoFast === "boolean") assist.autoFast = c.autoFast;
    if (typeof c.autoSpeed === "number" && SPEED_OK[c.autoSpeed] === true) assist.autoSpeed = c.autoSpeed;
    if (Array.isArray(c.seenMessages)) seenMessages = stringSet(c.seenMessages);
    if (Array.isArray(c.seenPages)) seenPages = stringSet(c.seenPages);
    var cap = c.capturePictures === true;
    if (cap !== capturePictures) lastPicsKey = null; // turned on again: the next snapshot is written in full
    capturePictures = cap;
    // c.seenTroops is accepted and ignored: battles are never sped up automatically
    var hk = hotkeysFrom(c.hotkeys);
    if (JSON.stringify(hk) !== JSON.stringify(hotkeys)) {
      hotkeys = hk;
      applyKeyMap();
    }
    var cmd = c.command;
    if (cmd && typeof cmd === "object" && typeof cmd.id === "string" && cmd.id && cmd.id !== lastCommandId && COMMAND_KINDS[cmd.kind] === true) {
      lastCommandId = cmd.id; // at most once, even when stale
      // issue time of the command itself (older viewers: the control file's t)
      var at = typeof cmd.at === "number" && isFinite(cmd.at) ? cmd.at : c.t;
      if (commandFresh(at)) {
        pendingCommand = { id: cmd.id, kind: cmd.kind, t: at };
      } else {
        lastCommand = cmd.id + ":ignored";
      }
    }
  }

  // Issued within the last 10 s and not before the current battle started.
  function commandFresh(at) {
    return typeof at === "number" && isFinite(at) && now() - at <= COMMAND_MAX_AGE_MS && at >= battleStartT;
  }

  // mtime:size of control.json (null when stat gives no usable mtime).
  function controlKey() {
    if (typeof fs.statSync !== "function") return null;
    var st = fs.statSync(CONTROL);
    var m = st && typeof st.mtimeMs === "number" ? st.mtimeMs : (st && st.mtime && typeof st.mtime.getTime === "function" ? st.mtime.getTime() : null);
    return typeof m === "number" && isFinite(m) ? m + ":" + st.size : null;
  }

  // At startup: remember the control file left from an earlier session without applying it;
  // only a file written after startup is applied (the viewer rewrites it when controlT is not its own).
  function baselineControl() {
    if (!fs.existsSync(CONTROL)) return;
    var key = controlKey();
    lastControlKey = key;
    lastControlText = key === null ? String(fs.readFileSync(CONTROL, "utf8")) : null;
  }

  // Our hotkeys vanished from Input.keyMapper (another plugin replaced it): map them again.
  function keyMapIntact() {
    var km = G.Input && G.Input.keyMapper;
    if (!km || typeof km !== "object") return true;
    for (var i = 0; i < HOTKEY_NAMES.length; i++) {
      var k = hotkeys[HOTKEY_NAMES[i]];
      if (k !== null && km[k] === undefined) return false;
    }
    return true;
  }

  function pollControl() {
    var t = now();
    if (t - lastControlPollT < CONTROL_POLL_MS) return;
    lastControlPollT = t;
    try { if (!keyMapIntact()) applyKeyMap(); } catch (ek) { reportError(ek); }
    if (!fs.existsSync(CONTROL)) return;
    var key = controlKey();
    if (key !== null && key === lastControlKey) return;
    var text = String(fs.readFileSync(CONTROL, "utf8"));
    if (key === null && text === lastControlText) return; // no usable mtime: compare contents
    lastControlKey = key;
    lastControlText = key === null ? text : null;
    applyControl(text);
  }

  function inBattleNow() {
    var p = G.$gameParty;
    return !!(p && p.inBattle && p.inBattle());
  }

  function choicePending() {
    var m = G.$gameMessage;
    if (!m) return false;
    return !!((m.isChoice && m.isChoice()) || (m.isNumberInput && m.isNumberInput()) || (m.isItemChoice && m.isItemChoice()));
  }

  // Auto speed only for a fully seen event outside battle (battles are never judged "seen").
  function autoActive() {
    if (!assist.autoFast || inBattleNow()) return false;
    var inner = innermost(false);
    var k = inner ? locKey(inner._rpgvSrc) : null;
    return k !== null && seenPages[k] === true;
  }

  function computeSpeed() {
    var s = assist.speed;
    if (autoActive() && assist.autoSpeed > s) s = assist.autoSpeed;
    return s > MAX_SPEED ? MAX_SPEED : (s < 1 ? 1 : s);
  }

  function battleEnding(BM) {
    var ph = BM._phase;
    return ph === "battleEnd" || ph === "aborting";
  }

  function kill(b) {
    b.addNewState(b.deathStateId());
    b.refresh();
    if (typeof b.performCollapse === "function") b.performCollapse();
  }

  function runCommand(kind) {
    var BM = G.BattleManager, i;
    if (kind === "win") {
      var enemies = G.$gameTroop.aliveMembers();
      for (i = 0; i < enemies.length; i++) kill(enemies[i]);
      BM.checkBattleEnd();
    } else if (kind === "lose") {
      var actors = G.$gameParty.aliveMembers();
      for (i = 0; i < actors.length; i++) kill(actors[i]);
      BM.processDefeat();
    } else if (kind === "escape") { // only reached when canEscapeNow()
      if (typeof BM.processEscape === "function") {
        var ratio = BM._escapeRatio;
        BM._escapeRatio = 1; // the player asked to escape: never fail the roll
        try { BM.processEscape(); } finally { BM._escapeRatio = ratio; }
      } else {
        BM.processAbort();
      }
    }
  }

  function canEscapeNow() {
    try {
      var BM = G.BattleManager;
      return !!(BM && typeof BM.canEscape === "function" && BM.canEscape());
    } catch (e) { reportError(e); return false; }
  }

  // Runs at the start of a frame; waits while a message is open (the battle end adds its own messages).
  function runPendingCommand() {
    var c = pendingCommand;
    if (!c) return;
    var BM = G.BattleManager;
    if (!commandFresh(c.t) || !inBattleNow() || !BM || battleEnding(BM) || (c.kind === "escape" && !canEscapeNow())) {
      pendingCommand = null;
      lastCommand = c.id + ":ignored";
      return;
    }
    if (!BM._phase || BM._phase === "init" || messageBusy()) return;
    pendingCommand = null;
    try {
      runCommand(c.kind);
      lastCommand = c.id;
    } catch (e) {
      lastCommand = c.id + ":failed";
      reportError(e);
    }
  }

  function hotkeyCommand(kind) {
    var BM = G.BattleManager;
    if (!inBattleNow() || !BM || battleEnding(BM) || pendingCommand) return;
    var t = now();
    pendingCommand = { id: "key-" + kind + "-" + t, kind: kind, t: t };
  }

  function pollHotkeys() {
    var I = G.Input;
    if (!I || typeof I.isTriggered !== "function") return;
    if (I.isTriggered(KEY_SPEED)) assist.speed = SPEED_NEXT[assist.speed] || 1;
    if (I.isTriggered(KEY_SKIP)) assist.skipSeen = !assist.skipSeen;
    if (I.isTriggered(KEY_WIN)) hotkeyCommand("win");
    if (I.isTriggered(KEY_LOSE)) hotkeyCommand("lose");
  }

  // Extra scene updates only on the map / in battle (menus stay at normal speed) and never
  // while a scene change is pending.
  function repeatable(sm) {
    if (!sm || sm._nextScene || sm._exiting || sm._sceneStarted === false) return false;
    var s = sm._scene;
    return !!s && ((G.Scene_Map && s instanceof G.Scene_Map) || (G.Scene_Battle && s instanceof G.Scene_Battle));
  }

  // Per-frame work before the scene update; returns how many times to update the scene.
  function frameStart(sm) {
    try { pollHotkeys(); } catch (e) { reportError(e); }
    try { runPendingCommand(); } catch (e2) { pendingCommand = null; reportError(e2); }
    try { effectiveSpeed = computeSpeed(); } catch (e3) { effectiveSpeed = assist.speed; reportError(e3); }
    var again = false;
    try { again = repeatable(sm); } catch (e4) { reportError(e4); }
    return again ? effectiveSpeed : 1;
  }

  function tick() {
    try { pollControl(); } catch (ec) { reportError(ec); }
    try { flush(); } catch (e) { reportError(e); }
    try { writeMeta(); } catch (em) { reportError(em); }
    try { writeLive(false); } catch (e2) { reportError(e2); }
  }

  bridge._flushNow = function () {
    try { flush(true); } catch (e) { reportError(e); }
    try { writeMeta(); } catch (em) { reportError(em); }
  };
  bridge._snapshotNow = function () { try { writeLive(true); } catch (e) { reportError(e); } };
  bridge._tick = tick;
  bridge._runScheduled = runScheduled;
  bridge._frame = function () { return frameStart(G.SceneManager); };

  // ---------------------------------------------------------------- engine helpers
  function pageIndexOf(pages, list) {
    if (!pages) return -1;
    for (var i = 0; i < pages.length; i++) {
      if (pages[i] && pages[i].list === list) return i;
    }
    return -1;
  }

  function eventPages(ev) {
    var data = ev && ev.event ? ev.event() : null;
    return data && data.pages;
  }

  // TemplateEvent: index of list among the event's own (original) pages, when they differ from its pages.
  function originIndexOf(ev, pages, list) {
    var orig = ev && typeof ev.getOriginalPages === "function" ? ev.getOriginalPages() : null;
    return orig && orig !== pages ? pageIndexOf(orig, list) : -1;
  }

  // Original page "origin" run as a child. page = the template page of the same event that called it
  // (parent interpreter); called from elsewhere (another event by name) page = origin.
  function originSource(map, eventId, origin) {
    var parent = childParentSrc;
    var page = parent && parent.source === "map" && parent.mapId === map.mapId() && parent.eventId === eventId
      ? parent.page : origin;
    return { source: "map", mapId: map.mapId(), eventId: eventId, page: page, origin: origin };
  }

  function resolveSource(list, eventId) {
    if (!list) return null;
    var i;
    var map = G.$gameMap;
    if (eventId > 0 && map && map.event) {
      var ev = map.event(eventId);
      var pages = eventPages(ev);
      i = pageIndexOf(pages, list);
      if (i >= 0) return { source: "map", mapId: map.mapId(), eventId: eventId, page: i };
      i = originIndexOf(ev, pages, list);
      if (i >= 0) return originSource(map, eventId, i);
    }
    // A page of another map event (TemplateEvent TE_CALL_MAP_EVENT with KeepEventId on): its pages,
    // or its original pages when called by name.
    var all = map && map.events ? map.events() : null;
    if (all) {
      for (var k = 0; k < all.length; k++) {
        var other = all[k];
        var oid = other && other.eventId ? other.eventId() : 0;
        if (!(oid > 0) || oid === eventId) continue;
        var opages = eventPages(other);
        i = pageIndexOf(opages, list);
        if (i >= 0) return { source: "map", mapId: map.mapId(), eventId: oid, page: i };
        i = originIndexOf(other, opages, list);
        if (i >= 0) return originSource(map, oid, i);
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

  // A message without text never reaches Window_Message.startMessage: its seen key must not linger.
  function messageHasText() {
    var m = G.$gameMessage;
    if (!m || typeof m.hasText !== "function") return true; // cannot tell: keep the key
    return !!m.hasText();
  }

  function srcOf(interp) { return interp._rpgvSrc || null; }

  // ---------------------------------------------------------------- screen pictures (1.6.0 / 1.7.0)
  // The pictures on screen are read directly when a message's text starts drawing instead of hooking
  // showPicture & co (plugins computing standing pictures end up there however they do it).
  // Entry: [id, name, origin, x, y, scaleX, scaleY, opacity, blendMode] + optional [tone|0, angle, w, h].
  // 1.7.0 reads what is actually drawn: the scene's Sprite_Picture sprites (plugins hiding stands through sprite
  // visibility / opacity or moving picture sprites to other layers are seen as drawn). Only sprites that are
  // visible with all parents, with opacity > 0 (times the parents' alpha) and a bitmap are recorded; origin is
  // 0 / 1 or [anchorX, anchorY]; w, h = bitmap size. Without picture sprites it falls back to Game_Screen
  // pictures (opacity 0 skipped). A moving / fading picture reports its target values (where it ends up while
  // the message shows) as long as the sprite still follows the picture.
  function picNum(v, d) { return typeof v === "number" && isFinite(v) ? Math.round(v * 100) / 100 : d; }
  function picName(n) { return n.length > PIC_NAME_MAX ? n.slice(0, PIC_NAME_MAX) : n; }
  function picEntry(id, name, origin, x, y, sx, sy, op, blend, tone, angle, w, h) {
    var e = [id, picName(name), origin, x, y, sx, sy, op, blend];
    if (tone || angle || w) {
      e.push(tone || 0);
      if (angle || w) e.push(angle || 0);
      if (w) { e.push(w); e.push(h); }
    }
    return e;
  }
  function toneOf(t) {
    if (!t || typeof t.length !== "number" || t.length < 3) return null;
    var out = [picNum(t[0], 0), picNum(t[1], 0), picNum(t[2], 0), picNum(t[3], 0)];
    return out[0] || out[1] || out[2] || out[3] ? out : null;
  }

  // Picture sprites of the current scene: the spriteset's _pictureContainer first, then any moved elsewhere.
  function pictureSprites(sc) {
    if (!sc || !sc._spriteset) return null;
    var SP = G.Sprite_Picture;
    var out = [], visited = 0;
    var walk = function (node, depth) {
      var ch = node && node.children;
      if (!ch || typeof ch.length !== "number" || depth > 8) return;
      for (var i = 0; i < ch.length && visited < PICS_TREE_MAX; i++) {
        var c = ch[i];
        visited++;
        if (!c || typeof c !== "object") continue;
        if (typeof c._pictureId === "number" && (typeof SP !== "function" || c instanceof SP)) {
          if (out.indexOf(c) < 0) out.push(c);
        } else {
          walk(c, depth + 1);
        }
      }
    };
    if (sc._spriteset._pictureContainer) walk(sc._spriteset._pictureContainer, 0);
    walk(sc, 0);
    return out.length ? out : null;
  }

  // The opacity a sprite is drawn with (own opacity times every parent's alpha); 0 when it or a parent is
  // hidden or it is not attached to the scene.
  function drawnOpacity(s, own, sc) {
    if (s.visible === false || !(own > 0)) return 0;
    var op = own, n = s.parent, depth = 0;
    while (n && n !== sc && depth++ < 50) {
      if (n.visible === false) return 0;
      if (typeof n.alpha === "number") op *= n.alpha;
      n = n.parent;
    }
    return n === sc ? op : 0;
  }

  function spriteEntry(s, sc) {
    var id = s._pictureId;
    if (!isCount(id)) return null;
    var screen = G.$gameScreen, p = null;
    if (screen && typeof screen.picture === "function") p = screen.picture(id) || null;
    var name = typeof s._pictureName === "string" && s._pictureName !== "" ? s._pictureName : (p && typeof p._name === "string" ? p._name : "");
    var b = s.bitmap;
    if (!name || !b) return null;
    if (typeof b.isError === "function" && b.isError()) return null;
    var moving = !!(p && typeof p._duration === "number" && p._duration > 0);
    // a value the sprite took from the moving picture: report where the picture ends up
    var follow = function (cur, now, target) {
      return moving && typeof now === "number" && typeof target === "number" && Math.abs(cur - now) <= 1 ? target : cur;
    };
    var own = typeof s.opacity === "number" ? s.opacity : (typeof s.alpha === "number" ? s.alpha * 255 : 255);
    own = follow(own, p && p._opacity, p && p._targetOpacity);
    var op = picNum(drawnOpacity(s, own, sc), 0);
    if (!(op > 0)) return null;
    var sc0 = s.scale || {}, an = s.anchor || {};
    var sx = typeof sc0.x === "number" ? sc0.x * 100 : 100, sy = typeof sc0.y === "number" ? sc0.y * 100 : 100;
    var ax = picNum(an.x, 0), ay = picNum(an.y, 0);
    var origin = ax === 0 && ay === 0 ? 0 : (ax === 0.5 && ay === 0.5 ? 1 : [ax, ay]);
    var blend = typeof s.blendMode === "number" ? s.blendMode : (p ? picNum(p._blendMode, 0) : 0);
    var tone = toneOf(s._colorTone) || (p ? picTone(p) : null);
    var angle = picNum(typeof s.rotation === "number" ? s.rotation * 180 / Math.PI : 0, 0);
    var w = picNum(b.width, 0), h = picNum(b.height, 0);
    if (!(w > 0 && h > 0)) { w = 0; h = 0; }
    return picEntry(id, name, origin,
      picNum(follow(s.x, p && p._x, p && p._targetX), 0), picNum(follow(s.y, p && p._y, p && p._targetY), 0),
      picNum(follow(sx, p && p._scaleX, p && p._targetScaleX), 100), picNum(follow(sy, p && p._scaleY, p && p._targetScaleY), 100),
      op, blend, tone, angle, w, h);
  }
  function picTone(p) {
    return toneOf(typeof p._toneDuration === "number" && p._toneDuration > 0 && p._toneTarget ? p._toneTarget : p._tone);
  }
  function picturesNow() {
    var sc = G.SceneManager && G.SceneManager._scene;
    var sprites = pictureSprites(sc);
    if (sprites) {
      var out = [], ids = {};
      for (var i = 0; i < sprites.length; i++) {
        var e = spriteEntry(sprites[i], sc);
        if (e && ids[e[0]] !== true) { ids[e[0]] = true; out.push(e); }
      }
      out.sort(function (a, b) { return a[0] - b[0]; });
      return out.length > PICS_MAX ? out.slice(0, PICS_MAX) : out;
    }
    return gamePictures();
  }
  function gamePictures() {
    var s = G.$gameScreen;
    if (!s || typeof s.picture !== "function") return null;
    var max = typeof s.maxPictures === "function" ? s.maxPictures() : 100;
    if (typeof max !== "number" || !isFinite(max) || max < 0) return null;
    if (max > PICS_SCAN_MAX) max = PICS_SCAN_MAX;
    var out = [];
    for (var id = 1; id <= max && out.length < PICS_MAX; id++) {
      var p = s.picture(id);
      if (!p || typeof p._name !== "string" || p._name === "") continue;
      var moving = typeof p._duration === "number" && p._duration > 0;
      var op = picNum(moving ? p._targetOpacity : p._opacity, 255);
      if (!(op > 0)) continue; // not visible
      out.push(picEntry(id, p._name, picNum(p._origin, 0),
        picNum(moving ? p._targetX : p._x, 0), picNum(moving ? p._targetY : p._y, 0),
        picNum(moving ? p._targetScaleX : p._scaleX, 100), picNum(moving ? p._targetScaleY : p._scaleY, 100),
        op, picNum(p._blendMode, 0), picTone(p), picNum(p._angle, 0), 0, 0));
    }
    return out;
  }
  // { pics } when the pictures differ from the last snapshot written in this branch, { picsSame } when not,
  // null when capture is off / in battle / no screen.
  function picsFields() {
    if (!capturePictures || inBattleNow()) return null;
    var pics = picturesNow();
    if (pics === null) return null;
    var key = JSON.stringify(pics);
    if (key === lastPicsKey) return { picsSame: true };
    lastPicsKey = key;
    return { pics: pics };
  }

  // ---------------------------------------------------------------- plugin commands
  // Plugin commands (356 MV / 357 MZ) run by events, recorded so the viewer can tell an examine
  // spot or plugin-shown text was reached. Parallel interpreters are skipped; the same src+cmd is
  // recorded once per interpreter run and once per 2 s, and at most 20 records per second overall.
  var PLUGIN_TEXT_MAX = 500, PLUGIN_REPEAT_MS = 2000, PLUGIN_CAP = 20, PLUGIN_CAP_MS = 1000, PLUGIN_KEYS_MAX = 1000;
  var pluginLastT = {}, pluginKeyCount = 0; // src+cmd key -> time it was last recorded
  var pluginTimes = [];                     // times of the last PLUGIN_CAP plugin records

  function clipText(s) { return s.length > PLUGIN_TEXT_MAX ? s.slice(0, PLUGIN_TEXT_MAX) : s; }

  function pluginText(code, p) {
    if (code === 356) return clipText(String(p[0] == null ? "" : p[0]).trim());
    var parts = [String(p[0] == null ? "" : p[0]), String(p[1] == null ? "" : p[1])];
    var args = p[3];
    if (args && typeof args === "object") {
      for (var k in args) {
        if (has(args, k) && typeof args[k] === "string" && args[k] !== "") parts.push(args[k]);
      }
    }
    return clipText(parts.join(" ").trim());
  }

  // name / args of a plugin command (1.5.0+): 356 -> first token and the remaining tokens,
  // 357 -> plugin name, command name and the args object (strings clipped).
  var PLUGIN_ARGS_MAX = 30;
  function pluginFields(code, p) {
    if (code === 356) {
      var toks = String(p[0] == null ? "" : p[0]).split(/[\s　]+/);
      var out = [];
      for (var i = 0; i < toks.length; i++) if (toks[i] !== "") out.push(clipText(toks[i]));
      return { name: out.length ? out[0] : "", args: out.slice(1, 1 + PLUGIN_ARGS_MAX) };
    }
    var args = {}, n = 0, src = p[3];
    if (src && typeof src === "object") {
      for (var k in src) {
        if (!has(src, k) || n >= PLUGIN_ARGS_MAX) continue;
        var v = src[k];
        if (typeof v === "string") args[k] = clipText(v);
        else if (typeof v === "number" || typeof v === "boolean") args[k] = v;
        else continue;
        n++;
      }
    }
    return { plugin: String(p[0] == null ? "" : p[0]), name: String(p[1] == null ? "" : p[1]), args: args };
  }

  // interp is owner or one of its (nested) child interpreters
  function inChain(owner, interp) {
    var i = owner, depth = 0;
    while (i && depth < 32) {
      if (i === interp) return true;
      i = i._childInterpreter; depth++;
    }
    return false;
  }

  // Parallel map events (trigger 4) and parallel common events (trigger 2) run in interpreters
  // owned by their Game_Event / Game_CommonEvent; the map / troop interpreter is never parallel.
  function parallelInterp(interp) {
    var map = G.$gameMap;
    if (!map) return false;
    var lists = [map._events, map._commonEvents];
    for (var l = 0; l < lists.length; l++) {
      var arr = lists[l];
      if (!arr || typeof arr.length !== "number") continue;
      for (var i = 0; i < arr.length; i++) {
        var o = arr[i];
        if (o && o._interpreter && inChain(o._interpreter, interp)) return true;
      }
    }
    return false;
  }

  function notePlugin(interp, code) {
    if (run === null) return;
    var i = cmdAt(interp, code);
    if (i < 0) return;
    if (interp._rpgvPar !== true && interp._rpgvPar !== false) interp._rpgvPar = parallelInterp(interp);
    if (interp._rpgvPar) return;
    var src = srcOf(interp);
    var params = interp._list[i].parameters || [];
    var text = pluginText(code, params);
    var lk = locKey(src);
    var key = (lk === null ? "?" + text : lk) + "#" + i;
    var seen = interp._rpgvPlugins;
    if (!seen || typeof seen !== "object") seen = interp._rpgvPlugins = {};
    if (seen[key] === true) return;
    var t = now();
    if (has(pluginLastT, key) && t - pluginLastT[key] < PLUGIN_REPEAT_MS) return;
    if (pluginTimes.length >= PLUGIN_CAP && t - pluginTimes[0] < PLUGIN_CAP_MS) return; // over the cap: drop
    seen[key] = true;
    if (pluginKeyCount >= PLUGIN_KEYS_MAX) { pluginLastT = {}; pluginKeyCount = 0; }
    if (!has(pluginLastT, key)) pluginKeyCount++;
    pluginLastT[key] = t;
    pluginTimes.push(t);
    if (pluginTimes.length > PLUGIN_CAP) pluginTimes.shift();
    var rec = { src: src, cmd: i, code: code, text: text };
    var f = pluginFields(code, params);
    if (code === 357) rec.plugin = f.plugin;
    rec.name = f.name;
    rec.args = f.args;
    emit("plugin", rec);
  }

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
          this._rpgvPar = null;      // parallel or not: decided at its first plugin command
          this._rpgvPlugins = null;  // plugin commands recorded during this run
          this._rpgvSrc = resolveSource(list, eventId);
        } catch (e) { reportError(e); }
        return r;
      };
    });

    // Remember the parent's source while a child interpreter is set up (TemplateEvent origin pages report it).
    hook(GI, "Game_Interpreter", "setupChild", function (orig) {
      return function () {
        var prev = childParentSrc;
        childParentSrc = this._rpgvSrc || null;
        try {
          return orig.apply(this, arguments);
        } finally {
          childParentSrc = prev;
        }
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
          if (i >= 0 && !messageBusy()) {
            var mk = locKey(srcOf(this));
            pendingMsgKey = mk === null ? null : mk + "#" + i;
          }
          if (i >= 0 && run !== null && !messageBusy()) {
            var p = this._list[i].parameters || [];
            var mrec = {
              src: srcOf(this), cmd: i,
              face: p[0] == null ? "" : String(p[0]),
              faceIndex: typeof p[1] === "number" ? p[1] : 0,
              speaker: p[4] == null ? "" : String(p[4]),
              text: joinedText(this._list, i + 1, 401)
            };
            // capturing: the pictures are read once the text starts drawing (Window_Message.updateMessage),
            // after same-frame erases and sprite-level hides have applied
            emit("message", mrec, capturePictures && !inBattleNow());
          }
        } catch (e) { reportError(e); }
        var r = orig.apply(this, arguments);
        try { if (pendingMsgKey !== null && !messageHasText()) pendingMsgKey = null; } catch (e2) { pendingMsgKey = null; reportError(e2); }
        return r;
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
            var crec = { src: ctx.src, cmd: i, options: options };
            // a choice without a message (or after pictures changed under the message) carries changed pictures;
            // a choice shown with a held message leaves them to the message
            var cf = null;
            if (!heldMsg) {
              try { cf = picsFields(); } catch (ep) { reportError(ep); }
            }
            if (cf && cf.pics) crec.pics = cf.pics;
            emit("choices", crec);
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

    function hookPlugin(code) {
      hook(GI, "Game_Interpreter", "command" + code, function (orig) {
        return function () {
          try { notePlugin(this, code); } catch (e) { reportError(e); }
          return orig.apply(this, arguments);
        };
      });
    }
    hookPlugin(356);
    hookPlugin(357);

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
        try { battleStartT = now(); } catch (eb) { reportError(eb); }
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

    try { installAssist(); } catch (ea) { reportError(ea); } // the log hooks below must still install

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
            var known = Object.prototype.hasOwnProperty.call(lastStory, s.branch);
            var ent = known ? lastStory[s.branch] : null;
            var runOk = known && (typeof ent === "number" || ent.run === s.run); // legacy numeric: run unknown, seq rule only
            if (runOk && entrySeq(ent) <= s.seq) resumeBranch(s.run, s.branch);
            else startBranch("load", s.run, s.branch, s.seq); // story after the save, or unknown: new branch
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
        if (type === "save") { flush(true); writeMeta(); }
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

  function setFast(win) {
    win._showFast = true;
    win._lineShowFast = true;
  }

  function hookInputQuery(owner, ownerName, name) {
    hook(owner, ownerName, name, function (orig) {
      return function () {
        if (extraUpdate) return false;
        return orig.apply(this, arguments);
      };
    });
  }

  function pressedTime(o) { return o && typeof o._pressedTime === "number" ? o._pressedTime : null; }

  // Updates 2..n of a sped-up frame. They are input-neutral: the queries above answer false, and
  // _pressedTime (key repeat / long press timing) advances once per real frame, not once per update.
  function extraUpdates(sm, orig, args, n) {
    var I = G.Input, TI = G.TouchInput;
    var it = null, tt = null, latest = null;
    try { it = pressedTime(I); tt = pressedTime(TI); latest = I ? I._latestButton : null; } catch (e0) { reportError(e0); }
    extraUpdate = true;
    try {
      for (var i = 1; i < n; i++) {
        var again = false;
        try {
          again = repeatable(sm);
          // clears this frame's triggers (also TouchInput cancel / wheel); _pressedTime is restored below
          if (again && typeof sm.updateInputData === "function") sm.updateInputData();
        } catch (e) { again = false; reportError(e); }
        if (!again) break;
        orig.apply(sm, args);
      }
    } finally {
      extraUpdate = false;
      try {
        if (it !== null && I) {
          // a button newly pressed meanwhile (gamepads are polled): trigger it on the next real frame
          I._pressedTime = I._latestButton === latest ? it : -1;
        }
        if (tt !== null && TI) TI._pressedTime = tt;
      } catch (e1) { reportError(e1); }
    }
  }

  function installAssist() {
    applyKeyMap();

    hook(G.SceneManager, "SceneManager", "updateScene", function (orig) {
      return function () {
        if (inFrame) return orig.apply(this, arguments);
        inFrame = true;
        try {
          var n = frameStart(this);
          var r = orig.apply(this, arguments);
          if (n > 1) extraUpdates(this, orig, arguments, n);
          return r;
        } finally {
          inFrame = false;
        }
      };
    });

    // During extra updates every press / repeat / long-press query answers false.
    var inputQueries = ["isTriggered", "isRepeated", "isLongPressed"];
    for (var q = 0; q < inputQueries.length; q++) {
      hookInputQuery(G.Input, "Input", inputQueries[q]);
      hookInputQuery(G.TouchInput, "TouchInput", inputQueries[q]);
    }

    var WM = G.Window_Message && G.Window_Message.prototype;
    hook(WM, "Window_Message", "startMessage", function (orig) {
      return function () {
        var key = pendingMsgKey;
        pendingMsgKey = null;
        try {
          if (!messageHasText()) key = null;
          this._rpgvWait = 0;
          this._rpgvSkip = !!(assist.skipSeen && key !== null && seenMessages[key] === true && !choicePending());
        } catch (e) { this._rpgvSkip = false; reportError(e); }
        var r = orig.apply(this, arguments);
        try { if (this._rpgvSkip) setFast(this); } catch (e2) { reportError(e2); }
        return r;
      };
    });
    // The first text update of a message (window open, text about to draw): take its picture snapshot.
    hook(WM, "Window_Message", "updateMessage", function (orig) {
      return function () {
        try {
          if (heldMsg && this._textState) { finishHeld(); scheduleFlush(); }
        } catch (e) { reportError(e); }
        return orig.apply(this, arguments);
      };
    });
    // newPage() clears the fast flags on every page of a long message: keep them for a seen one.
    hook(WM, "Window_Message", "clearFlags", function (orig) {
      return function () {
        var r = orig.apply(this, arguments);
        try { if (this._rpgvSkip && assist.skipSeen) setFast(this); } catch (e) { reportError(e); }
        return r;
      };
    });
    // Seen message: once paused, advance by itself after a few updates as if OK was pressed.
    hook(WM, "Window_Message", "isTriggered", function (orig) {
      return function () {
        var r = orig.apply(this, arguments);
        if (r) return r;
        try {
          if (this._rpgvSkip && assist.skipSeen && this.pause && !choicePending()) {
            this._rpgvWait = (this._rpgvWait || 0) + 1;
            if (this._rpgvWait >= AUTO_ADVANCE_UPDATES) {
              this._rpgvWait = 0;
              return true;
            }
          } else {
            this._rpgvWait = 0;
          }
        } catch (e) { reportError(e); }
        return r;
      };
    });
  }

  try {
    if (fs.existsSync(LIVE_TMP)) fs.unlinkSync(LIVE_TMP); // left over from a crash mid-write
  } catch (e) { /* harmless: overwritten on next snapshot */ }
  try { baselineControl(); } catch (e) { reportError(e); }
  try {
    loadMeta();
    raiseMetaFromLog();
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
