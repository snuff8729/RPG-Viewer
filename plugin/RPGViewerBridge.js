/*:
 * @target MZ MV
 * @plugindesc RPG Viewer 기록 플러그인
 * @author RPG Viewer
 * @help
 * RPG Viewer가 설치하는 기록 플러그인입니다.
 * 게임 폴더의 rpg-viewer/ 아래에 플레이 기록(log.jsonl)과
 * 현재 상태(live.json)를 남깁니다.
 * RPG Viewer의 "게임 보조"·"치트"(rpg-viewer/control.json)나 아래 단축키를 쓰지 않으면
 * 게임 화면과 진행에는 영향을 주지 않습니다. 치트(아이템·돈·능력치·스위치·변수
 * 바꾸기)는 RPG Viewer에서 누를 때만, 실행 중인 게임에 바로 적용합니다.
 * 플러그인 명령이나 파라미터는 없습니다.
 * 게임 창 단축키: F6 배속(×1→×2→×4→×8), F7 본 대사 자동 넘기기,
 * 전투 중 F10 이기기, F11 지기. 선택지는 자동으로 고르지 않습니다.
 * 변수 변경은 숫자·참/거짓 값만 기록합니다(문자열·배열 등은 기록하지 않음).
 * 같은 명령이 매 프레임 바꾸는 값은 0.25초마다 마지막 값만 남깁니다.
 * 이벤트가 실행한 플러그인 명령(MV 356 / MZ 357)의 이름과 문자열 인자도
 * 기록합니다. 병렬 이벤트·병렬 커먼 이벤트의 것은 기록하지 않습니다.
 * RPG Viewer에서 "화면 그림 따라 그리기"를 켠 게임에서만, 대사 글자가 그려지기
 * 시작할 때 화면에 실제로 보이는 그림(스탠딩 이미지 등)의 이름·위치·크기도
 * 기록합니다(숨겨졌거나 투명한 그림은 빼고). 전투 화면의 그림도 같습니다.
 * 다른 플러그인이 그림 폴더(img/pictures)의 이미지를 직접 띄우는 것(전투 컷인 등)도
 * 화면 위치 그대로 기록하고, 대사 사이에 잠깐 나타난 그림은 따로 남깁니다(초당 최대 8번).
 * 그림 파일을 자기 그림판에 통째로 옮겨 그려 띄우는 플러그인(전투 중 흔들리는 스탠딩 등)도 그 그림으로 기록합니다.
 * 전투는 시작(적 무리 이름)·전투 로그 글(공격·피해·상태·승리·경험치 등)·
 * 결과(승리/패배/도주/중단, 보상)를 기록합니다. 전투 한 번에 최대 2000줄,
 * 초당 50줄까지만 남깁니다(배속 중에도 전투를 느리게 하지 않음).
 * 기술·아이템 사용 줄에는 누가(아군/적) 무엇을 썼는지도 함께 남깁니다.
 * RPG Viewer에서 "알림 문구 기록"을 켠 게임에서만, 다른 플러그인이 화면 구석이나
 * 위쪽에 잠깐 띄우는 문구(TickerManager.show, LiveCommentContainer의 show 등과
 * 설정에서 직접 추가한 함수)를 기록합니다. 같은 문구는 0.3초 안에 한 번,
 * 초당 30개까지만 남기고, 게임이 보여 주는 내용은 바꾸지 않습니다.
 * 게임 전용 확장(RPGViewerBridge_<id>.js, 이 플러그인 바로 뒤)은
 * RPGViewerBridge.registerExtension으로 붙어 그림 기록에 정보를 더합니다.
 * 화면 그림은 맵과 전투 화면에서만 기록합니다(메뉴 화면은 RPG Viewer에서 따로 켠 경우만).
 * 게임이 실행 중에 만든 이벤트(EventReSpawn 등)는 현재 상태에 원본 이벤트 번호를 함께 남깁니다.
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
    VERSION: "1.18.0",
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
  var COMMAND_KINDS = { win: true, lose: true, escape: true, hpFull: true, hpLow: true, cheat: true };
  // party HP commands (1.12.0): work on the map and in battle
  var PARTY_COMMANDS = { hpFull: true, hpLow: true };
  var CONTROL_POLL_MS = 1000, COMMAND_MAX_AGE_MS = 10000, AUTO_ADVANCE_UPDATES = 6, MAX_SPEED = 8;
  var KEY_SPEED = "rpgvSpeed", KEY_SKIP = "rpgvSkip", KEY_WIN = "rpgvWin", KEY_LOSE = "rpgvLose";
  var KEY_HP_FULL = "rpgvHpFull", KEY_HP_LOW = "rpgvHpLow";
  var HOTKEY_NAMES = ["speed", "skip", "win", "lose", "hpFull", "hpLow"];
  var HOTKEY_BUTTONS = { speed: KEY_SPEED, skip: KEY_SKIP, win: KEY_WIN, lose: KEY_LOSE, hpFull: KEY_HP_FULL, hpLow: KEY_HP_LOW };
  var HOTKEY_DEFAULTS = { speed: 117, skip: 118, win: 121, lose: 122, hpFull: null, hpLow: null }; // F6 F7 F10 F11, HP keys off
  // keyCodes the engine itself uses (default Input.keyMapper, F2-F5, F8, F9): never offered as hotkeys
  var RESERVED_KEYS = {
    9: true, 13: true, 16: true, 17: true, 18: true, 27: true, 32: true, 33: true, 34: true,
    37: true, 38: true, 39: true, 40: true, 45: true, 81: true, 87: true, 88: true, 90: true,
    96: true, 98: true, 100: true, 102: true, 104: true,
    113: true, 114: true, 115: true, 116: true, 119: true, 120: true
  };
  var hotkeys = { speed: 117, skip: 118, win: 121, lose: 122, hpFull: null, hpLow: null }; // wanted bindings (null = disabled)
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
  var captureMenuScenes = false; // 1.16.0: control.json captureMenuScenes — extensions may capture menu scenes
  var lastPicsKey = null;     // JSON of the last picture snapshot written in this branch (null = none yet)
  var lastPicsSet = null;     // set signature of that snapshot (1.10.1 screen records: visible images, coarse places)
  var PICS_MAX = 60, PIC_NAME_MAX = 200, PICS_SCAN_MAX = 1000;
  // 1.7.0: a message record waits in the buffer (unserialized) until its text starts drawing, then takes the
  // snapshot of what is actually on screen; flushes write only up to it (at most PICS_HOLD_MS, then snapshot now).
  var heldMsg = null;         // { rec, t, ms } — also the buffer entry itself (ms: how long it may wait)
  var PICS_HOLD_MS = 1000, PICS_TREE_MAX = 3000;    // inside an extra (sped-up) scene update: input queries report nothing new
  // 1.8.0 battle log: lines shown in Window_BattleLog (addText) and battle-system messages ($gameMessage.add
  // outside any interpreter) while a battle runs. Not story records. Bounded per battle and per second.
  var battleLog = null;       // { lines, dropped, times, lastText, lastT, picsT } from BattleManager.setup to endBattle
  var BATTLE_LINES_MAX = 2000, BATTLE_RATE_MAX = 50, BATTLE_RATE_MS = 1000, BATTLE_DUP_MS = 100;
  var BATTLE_TEXT_MAX = 500, BATTLE_PICS_GAP_MS = 500, BATTLE_ENEMIES_MAX = 20, BATTLE_ITEMS_MAX = 50, BATTLE_NAME_MAX = 200;
  var BATTLE_HOLD_MS = 5000;  // the battle start record waits for Scene_Battle (encounter effect, loading)
  // 1.9.0 notices (control.json "captureNotices"; off by default): texts other plugins pop up on screen
  // (tickers, stream-style comments, notifications). Not story records. Deduped and rate-capped.
  var captureNotices = false;
  var noticeExtra = [];       // extra hook paths from control.json "noticeHooks" (validated)
  var noticeHooked = [];      // paths wrapped so far (reported in live.json)
  var noticeLast = { key: null, t: -Infinity, times: [] };
  var noticeWin = null;       // cached Window_Base-like object for convertEscapeCharacters
  var NOTICE_BUILTIN = [
    { path: "TickerManager.show", source: "ticker" },
    { path: "LiveCommentContainer.prototype.show", source: "livecomment" },
    { path: "Torigoya.NotifyMessage.Manager.notify", source: "notify" },
    { path: "Game_System.prototype.pushInfoEvent", source: "info" }
  ];
  var NOTICE_PATH_RE = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;
  var NOTICE_DUP_MS = 300, NOTICE_RATE_MAX = 30, NOTICE_RATE_MS = 1000, NOTICE_TEXT_MAX = 500;
  var NOTICE_HOOKS_MAX = 20, NOTICE_PATH_MAX = 200;

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
    var rec = { v: 1, seq: meta.nextSeq++, t: t, run: run || 0, branch: branch || 0, type: type };
    // 1.17.0: written on a menu (or any other non-map, non-battle) scene — e.g. MenuCommonEvent's common events
    if (inMenuScene()) rec.scene = "menu";
    return rec;
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
  // (true = at most PICS_HOLD_MS, a number = at most that many ms)
  function emit(type, fields, hold) {
    if (run === null && type !== "error") return;
    closeState();
    var rec = makeRecord(type, now());
    for (var k in fields) if (Object.prototype.hasOwnProperty.call(fields, k)) rec[k] = fields[k];
    if (STORY[type] === true) noteStory(rec.branch, rec.seq, rec.run);
    if (hold) pushHeld(rec, typeof hold === "number" ? hold : PICS_HOLD_MS);
    else pushLine(rec);
    if (IMMEDIATE[type] === true) scheduleFlush();
  }

  function pushHeld(rec, ms) {
    finishHeld();
    if (buffer.length >= MAX_BUFFER) buffer.shift();
    heldMsg = { rec: rec, t: now(), ms: ms };
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
    lastPicsKey = null; lastPicsSet = null; screenSettle = null; mapPicsKey = null; mapPicsSet = null;
    battleLog = null;
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
    lastPicsKey = null; lastPicsSet = null; screenSettle = null; mapPicsKey = null; mapPicsSet = null;
    battleLog = null;
    deferredNewGame = false;
  }

  // force: also finish a held message now (saves, unload, tests)
  function flush(force) {
    releasePending(false);
    closeState();
    if (heldMsg && (force === true || now() - heldMsg.t >= heldMsg.ms)) finishHeld();
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

  // 1.16.0 events made while the game runs (EventReSpawn's Game_PrefabEvent, other spawn plugins): where their data
  // comes from, so the viewer can draw them. null = an event of the map data. Otherwise { from, tpl } (tpl: a
  // TemplateEvent template map event) or { name } when the source is not found. EventReSpawn keeps
  // _originalEventId / _isTemplate; anything else is found by identity of event() in $dataMap.events or
  // $dataTemplateEvents. An event whose id is in the map data stays ordinary (TemplateEvent swaps event() of those)
  // unless event() is another event of the map data. Cached per event while event() stays the same object.
  var SPAWN_NAME_MAX = 60;
  function indexByIdentity(list, obj) {
    if (!list || typeof list.length !== "number") return -1;
    for (var i = 1; i < list.length; i++) if (list[i] === obj) return i;
    return -1;
  }
  function spawnOf(ev, id) {
    var dm = G.$dataMap, list = dm && dm.events;
    if (!list || typeof list.length !== "number" || typeof id !== "number") return null;
    var obj = typeof ev.event === "function" ? ev.event() : null;
    var c = ev._rpgvSpawn;
    if (c && c.obj === obj && c.list === list) return c.res;
    var res = spawnFind(ev, id, list, obj);
    try { ev._rpgvSpawn = { obj: obj, list: list, res: res }; } catch (e) { /* frozen object: no cache */ }
    return res;
  }
  function spawnFind(ev, id, list, obj) {
    var own = list[id] || null;
    if (own && obj === own) return null;
    var orig = ev._originalEventId;
    if (typeof orig === "number" && isFinite(orig) && orig > 0 && (!own || orig !== id)) {
      return { from: orig, tpl: ev._isTemplate === true };
    }
    var k = obj ? indexByIdentity(list, obj) : -1;
    if (own) return k > 0 && k !== id ? { from: k, tpl: false } : null;
    if (k > 0) return { from: k, tpl: false };
    k = obj ? indexByIdentity(G.$dataTemplateEvents, obj) : -1;
    if (k > 0) return { from: k, tpl: true };
    var name = obj && typeof obj.name === "string" ? obj.name : "";
    return { name: name.length > SPAWN_NAME_MAX ? name.slice(0, SPAWN_NAME_MAX) : name };
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
      var sp = null;
      try { sp = spawnOf(ev, entry.eventId); } catch (es) { reportError(es); }
      if (sp) entry.spawn = sp;
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
    var snap = {
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
        captureMenuScenes: captureMenuScenes,
        captureNotices: captureNotices,
        notices: noticeHooked.slice(),
        extensions: bridge.extensions(),
        hotkeys: effectiveHotkeys()
      }
    };
    if (liveActors) snap.actors = actorDetails();
    return snap;
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

  // ---------------------------------------------------------------- cheats (1.14.0)
  // control.json command { kind: "cheat", ops: [...] }: every op is checked first (nothing applies when one is
  // bad: "id:failed:<index>"), then applied in order (an op that throws stops there: "id:failed:<index>").
  var CHEAT_OPS_MAX = 50, CHEAT_NUM_MAX = 999999999, CHEAT_STR_MAX = 1000, CHEAT_ID_MAX = 99999;
  var CHEAT_LETTERS = { A: true, B: true, C: true, D: true };
  var ACTORS_MAX = 50, ACTOR_SKILLS_MAX = 500, ACTOR_STATES_MAX = 100;
  var liveActors = false;     // control.json "liveActors": live.json also carries the party's actors

  function isInt(v, lo, hi) {
    return typeof v === "number" && isFinite(v) && Math.floor(v) === v && v >= lo && v <= hi;
  }

  // Database entry with this id (null when missing).
  function dataEntry(list, id) {
    return list && typeof list.length === "number" && isInt(id, 1, list.length - 1) && list[id] ? list[id] : null;
  }

  function itemData(type) {
    if (type === "item") return G.$dataItems;
    if (type === "weapon") return G.$dataWeapons;
    if (type === "armor") return G.$dataArmors;
    return null;
  }

  // Highest switch / variable id: from System.json names when loaded.
  function systemMax(kind) {
    var s = G.$dataSystem;
    var names = s && (kind === "switch" ? s.switches : s.variables);
    return names && typeof names.length === "number" && names.length > 1 ? names.length - 1 : CHEAT_ID_MAX;
  }

  function cheatActor(id) {
    if (!dataEntry(G.$dataActors, id)) return null;
    var A = G.$gameActors;
    return A && typeof A.actor === "function" ? A.actor(id) || null : null;
  }

  function actorStep(op) {
    var a = cheatActor(op.actorId);
    if (!a) return null;
    var k = op.op;
    if (k === "level") {
      if (!isInt(op.level, 1, 9999)) return null;
      return function () {
        var max = typeof a.maxLevel === "function" ? a.maxLevel() : 99;
        a.changeLevel(Math.min(op.level, max), false);
      };
    }
    if (k === "exp") {
      if (!isInt(op.add, -CHEAT_NUM_MAX, CHEAT_NUM_MAX)) return null;
      return function () { a.changeExp(Math.max(0, a.currentExp() + op.add), false); };
    }
    if (k === "param") {
      if (!isInt(op.paramId, 0, 7) || !isInt(op.add, -CHEAT_NUM_MAX, CHEAT_NUM_MAX)) return null;
      return function () { a.addParam(op.paramId, op.add); };
    }
    if (k === "learnSkill" || k === "forgetSkill") {
      if (!dataEntry(G.$dataSkills, op.skillId)) return null;
      return function () { if (k === "learnSkill") a.learnSkill(op.skillId); else a.forgetSkill(op.skillId); };
    }
    if (k === "addState" || k === "removeState") {
      if (!dataEntry(G.$dataStates, op.stateId)) return null;
      return function () { if (k === "addState") a.addState(op.stateId); else a.removeState(op.stateId); };
    }
    return null;
  }

  // A checked op as a function that applies it, or null when the op is not valid.
  function cheatStep(op) {
    if (!op || typeof op !== "object") return null;
    var party = G.$gameParty, k = op.op;
    if (k === "gainItem" || k === "setItem") {
      var item = dataEntry(itemData(op.type), op.id);
      if (!item || !party) return null;
      if (k === "gainItem") {
        if (!isInt(op.amount, -CHEAT_NUM_MAX, CHEAT_NUM_MAX)) return null;
        return function () { party.gainItem(item, op.amount, false); };
      }
      if (!isInt(op.count, 0, CHEAT_NUM_MAX)) return null;
      return function () { party.gainItem(item, op.count - party.numItems(item), false); };
    }
    if (k === "gold") {
      var hasSet = has(op, "set"), hasAdd = has(op, "add");
      if (!party || hasSet === hasAdd) return null;
      if (hasSet ? !isInt(op.set, 0, CHEAT_NUM_MAX) : !isInt(op.add, -CHEAT_NUM_MAX, CHEAT_NUM_MAX)) return null;
      return function () { party.gainGold(hasSet ? op.set - party.gold() : op.add); };
    }
    if (k === "recover") {
      if (op.actorId === null) {
        if (!party) return null;
        return function () {
          var ms = partyMembers();
          for (var i = 0; i < ms.length; i++) if (ms[i] && typeof ms[i].recoverAll === "function") ms[i].recoverAll();
        };
      }
      var ra = cheatActor(op.actorId);
      return ra ? function () { ra.recoverAll(); } : null;
    }
    if (k === "level" || k === "exp" || k === "param" || k === "learnSkill" || k === "forgetSkill" || k === "addState" || k === "removeState") {
      return actorStep(op);
    }
    if (k === "switch") {
      if (!G.$gameSwitches || !isInt(op.id, 1, systemMax("switch")) || typeof op.value !== "boolean") return null;
      return function () { G.$gameSwitches.setValue(op.id, op.value); };
    }
    if (k === "variable") {
      var okValue = isInt(op.value, -CHEAT_NUM_MAX, CHEAT_NUM_MAX) || (typeof op.value === "string" && op.value.length <= CHEAT_STR_MAX);
      if (!G.$gameVariables || !isInt(op.id, 1, systemMax("variable")) || !okValue) return null;
      return function () { G.$gameVariables.setValue(op.id, op.value); };
    }
    if (k === "selfSwitch") {
      if (!G.$gameSelfSwitches || !isInt(op.mapId, 1, CHEAT_ID_MAX) || !isInt(op.eventId, 1, CHEAT_ID_MAX)) return null;
      if (typeof op.letter !== "string" || CHEAT_LETTERS[op.letter] !== true || typeof op.value !== "boolean") return null;
      return function () { G.$gameSelfSwitches.setValue([op.mapId, op.eventId, op.letter], op.value); };
    }
    return null;
  }

  // Event pages, the player's followers and the battle status follow the new values.
  function cheatRefresh() {
    try {
      var map = G.$gameMap;
      if (map && typeof map.requestRefresh === "function") map.requestRefresh();
    } catch (e) { reportError(e); }
    try {
      var pl = G.$gamePlayer;
      if (pl && typeof pl.refresh === "function") pl.refresh();
    } catch (e2) { reportError(e2); }
    if (inBattleNow()) refreshBattleStatus();
  }

  function runCheatCommand(c) {
    pendingCommand = null;
    if (!commandFresh(c.t, c.kind) || run === null || !G.$gameParty) {
      lastCommand = c.id + ":ignored";
      return;
    }
    var ops = c.ops, steps = [], i;
    if (!Array.isArray(ops) || ops.length === 0 || ops.length > CHEAT_OPS_MAX) {
      lastCommand = c.id + ":failed:0";
      return;
    }
    for (i = 0; i < ops.length; i++) {
      var step = null;
      try { step = cheatStep(ops[i]); } catch (e) { step = null; reportError(e); }
      if (!step) {
        lastCommand = c.id + ":failed:" + i;
        return;
      }
      steps.push(step);
    }
    for (i = 0; i < steps.length; i++) {
      try {
        steps[i]();
      } catch (e2) {
        reportError(e2);
        cheatRefresh();
        lastCommand = c.id + ":failed:" + i;
        return;
      }
    }
    cheatRefresh();
    lastCommand = c.id;
  }

  function idList(arr, max) {
    var out = [];
    if (!arr || typeof arr.length !== "number") return out;
    for (var i = 0; i < arr.length && out.length < max; i++) if (typeof arr[i] === "number") out.push(arr[i]);
    return out;
  }

  // Party actors for the viewer's cheat sheet (only while it asks with "liveActors").
  function actorDetails() {
    var out = [], party = G.$gameParty, A = G.$gameActors;
    var ids = party && party._actors ? party._actors : [];
    if (!A || typeof A.actor !== "function") return out;
    for (var i = 0; i < ids.length && out.length < ACTORS_MAX; i++) {
      try {
        var a = A.actor(ids[i]);
        if (!a) continue;
        var params = [];
        for (var p = 0; p < 8; p++) params.push(typeof a.param === "function" ? a.param(p) : 0);
        out.push({
          id: ids[i],
          name: typeof a.name === "function" ? String(a.name()) : "",
          level: typeof a.level === "number" ? a.level : (typeof a._level === "number" ? a._level : 0),
          exp: typeof a.currentExp === "function" ? a.currentExp() : 0,
          params: params,
          hp: typeof a.hp === "number" ? a.hp : 0,
          mp: typeof a.mp === "number" ? a.mp : 0,
          skills: idList(a._skills, ACTOR_SKILLS_MAX),
          states: idList(a._states, ACTOR_STATES_MAX)
        });
      } catch (e) { reportError(e); }
    }
    return out;
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
      var def = HOTKEY_DEFAULTS[name];
      if (v !== null && !validHotkey(v)) v = def;
      if (v !== null && used[v] === true) v = def === null || used[def] === true ? null : def;
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
    if (cap !== capturePictures) { lastPicsKey = null; lastPicsSet = null; screenSettle = null; } // turned on again: the next snapshot is written in full
    capturePictures = cap;
    captureMenuScenes = c.captureMenuScenes === true;
    captureNotices = c.captureNotices === true;
    liveActors = c.liveActors === true;
    noticeExtra = noticePaths(c.noticeHooks);
    if (captureNotices) {
      try { ensureNoticeHooks(); } catch (en) { reportError(en); }
    }
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
      if (commandFresh(at, cmd.kind)) {
        pendingCommand = { id: cmd.id, kind: cmd.kind, t: at, ops: cmd.kind === "cheat" ? cmd.ops : null };
      } else {
        lastCommand = cmd.id + ":ignored";
      }
    }
  }

  // Issued within the last 10 s and (battle commands) not before the current battle started.
  function commandFresh(at, kind) {
    if (typeof at !== "number" || !isFinite(at) || now() - at > COMMAND_MAX_AGE_MS) return false;
    return PARTY_COMMANDS[kind] === true || kind === "cheat" || at >= battleStartT;
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

  // 1.17.1: scene kind by its constructor — "map" (Scene_Map or a subtype), "battle" (Scene_Battle), null (no scene,
  // title, boot), "menu" for everything else (Scene_MenuBase descendants, save / load, game over, custom scenes).
  // A spriteset says nothing: MenuCommonEvent gives menu scenes their own picture spriteset.
  function classChainHas(sc, name) {
    var p = Object.getPrototypeOf(sc), n = 0;
    while (p && n++ < 32) {
      if (p.constructor && p.constructor.name === name) return true;
      p = Object.getPrototypeOf(p);
    }
    return false;
  }
  function sceneKindOf(sc) {
    try {
      if (!sc) return null;
      if ((G.Scene_Map && sc instanceof G.Scene_Map) || classChainHas(sc, "Scene_Map")) return "map";
      if ((G.Scene_Battle && sc instanceof G.Scene_Battle) || classChainHas(sc, "Scene_Battle")) return "battle";
      if (G.Scene_Boot && sc instanceof G.Scene_Boot) return null;
      if (G.Scene_Title && sc instanceof G.Scene_Title) return null;
      return inBattleNow() ? "battle" : "menu";
    } catch (e) { return null; }
  }
  function sceneKind() {
    return sceneKindOf(G.SceneManager && G.SceneManager._scene);
  }
  // 1.17.0: the current scene is neither the map nor a battle (1.17.1: by its constructor).
  function inMenuScene() {
    return sceneKind() === "menu";
  }
  // 1.17.0: the map's last snapshot is kept aside while a menu is open (menu common events may show / erase pictures
  // on the shared Game_Screen) and comes back when the menu closes, so the map compares against its own pictures.
  var picsInMenu = false, mapPicsKey = null, mapPicsSet = null;
  function syncPicsScene() {
    var menu = inMenuScene();
    if (menu === picsInMenu) return menu;
    picsInMenu = menu;
    if (menu) { mapPicsKey = lastPicsKey; mapPicsSet = lastPicsSet; }
    else { lastPicsKey = mapPicsKey; lastPicsSet = mapPicsSet; screenSettle = null; }
    return menu;
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

  function partyMembers() {
    var p = G.$gameParty;
    if (!p || typeof p.members !== "function") return [];
    var m = p.members();
    return m && m.length ? m : [];
  }

  function isDeadActor(a) {
    if (typeof a.isDeathStateAffected === "function") return !!a.isDeathStateAffected();
    return typeof a.isAlive === "function" ? !a.isAlive() : false;
  }

  // hpFull: revive the dead and set every member's HP to max. hpLow: alive members to 1% (at least 1).
  // In battle the status window is redrawn; on the map nothing else is needed.
  function runPartyCommand(kind) {
    var members = partyMembers();
    for (var i = 0; i < members.length; i++) {
      var a = members[i];
      if (!a || typeof a.setHp !== "function") continue;
      var mhp = typeof a.mhp === "number" && isFinite(a.mhp) ? a.mhp : 1;
      if (kind === "hpFull") {
        if (isDeadActor(a) && typeof a.removeState === "function" && typeof a.deathStateId === "function") a.removeState(a.deathStateId());
        a.setHp(mhp);
      } else if (!isDeadActor(a)) {
        a.setHp(Math.max(1, Math.floor(mhp * 0.01)));
      }
    }
    if (inBattleNow()) refreshBattleStatus();
  }

  function refreshBattleStatus() {
    var BM = G.BattleManager;
    try {
      if (BM && typeof BM.refreshStatus === "function") BM.refreshStatus();
      else if (BM && BM._statusWindow && typeof BM._statusWindow.refresh === "function") BM._statusWindow.refresh();
    } catch (e) { reportError(e); }
    try {
      var tmp = G.$gameTemp; // MZ redraws the battle status on request
      if (tmp && typeof tmp.requestBattleRefresh === "function") tmp.requestBattleRefresh();
    } catch (e2) { reportError(e2); }
  }

  function runPendingPartyCommand(c) {
    pendingCommand = null;
    if (!commandFresh(c.t, c.kind) || partyMembers().length === 0) {
      lastCommand = c.id + ":ignored";
      return;
    }
    try {
      runPartyCommand(c.kind);
      lastCommand = c.id;
    } catch (e) {
      lastCommand = c.id + ":failed";
      reportError(e);
    }
  }

  // Runs at the start of a frame; waits while a message is open (the battle end adds its own messages).
  function runPendingCommand() {
    var c = pendingCommand;
    if (!c) return;
    if (PARTY_COMMANDS[c.kind] === true) { runPendingPartyCommand(c); return; }
    if (c.kind === "cheat") { runCheatCommand(c); return; }
    var BM = G.BattleManager;
    if (!commandFresh(c.t, c.kind) || !inBattleNow() || !BM || battleEnding(BM) || (c.kind === "escape" && !canEscapeNow())) {
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
    if (pendingCommand) return;
    if (PARTY_COMMANDS[kind] !== true && (!inBattleNow() || !BM || battleEnding(BM))) return;
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
    if (I.isTriggered(KEY_HP_FULL)) hotkeyCommand("hpFull");
    if (I.isTriggered(KEY_HP_LOW)) hotkeyCommand("hpLow");
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
  bridge._scanVisited = function () { return lastScanVisited; };

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

  // 1.15.0: resolved values of a Show / Move Picture command (parameters [id, name, origin, designation, x, y,
  // scaleX, scaleY, opacity, blend, ...]): variable-designated positions are read from the game variables now.
  function pictureFields(f, p) {
    var num = function (v) { return typeof v === "number" && isFinite(v) ? v : null; };
    var x = null, y = null;
    if (p[3] === 1) {
      var gv = typeof $gameVariables !== "undefined" ? $gameVariables : null;
      if (gv && typeof gv.value === "function") { x = num(gv.value(p[4])); y = num(gv.value(p[5])); }
    } else {
      x = num(p[4]); y = num(p[5]);
    }
    if (x === null || y === null) return;
    f.origin = p[2] === 1 ? 1 : 0;
    f.x = x; f.y = y;
    f.scaleX = num(p[6]) === null ? 100 : p[6];
    f.scaleY = num(p[7]) === null ? 100 : p[7];
    f.opacity = num(p[8]) === null ? 255 : p[8];
    f.blend = num(p[9]) === null ? 0 : p[9];
  }

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

  // ---------------------------------------------------------------- game extensions (1.13.0)
  // Game adapters (adapters/<id>/bridge.js in the RPG Viewer repo, installed as js/plugins/RPGViewerBridge_<id>.js right
  // after this plugin) register with RPGViewerBridge.registerExtension(ext). Every field but id is optional:
  //   ext.onInstall(api)                   once, right away (api below)
  //   ext.captureScene(scene) -> true      read this scene's images too although it has no spriteset (menu scenes);
  //                                        1.16.0: asked only while control.json captureMenuScenes is on
  //   ext.snapshotEntry(sprite, entry, scene) -> entry | null | undefined
  //                                        for each captured image: a changed entry, null = drop it, undefined = keep it
  //                                        (replace animated values with settled ones)
  //   ext.snapshotMeta(sprite, entry, scene) -> { key: string | number | boolean } | null
  //                                        stored at entry index 14 (indexes 9..13 padded with 0), at most 8 keys
  // api: { version, global, hook(owner, ownerName, name, make), markScreenDirty(), capturing(), reportError(e) }
  // A throwing hook is reported and skipped for that call. Extensions loaded before this plugin may push themselves
  // onto window.RPGViewerBridgeExtensions; they are registered when this plugin starts.
  var extensions = [], EXT_MAX = 16, META_KEYS_MAX = 8, META_TEXT_MAX = 60;
  var extApi = {
    version: bridge.VERSION,
    global: G,
    hook: function (owner, ownerName, name, make) { hook(owner, ownerName, name, make); },
    markScreenDirty: function () { markScreenDirty(); },
    capturing: function () { return capturePictures; },
    reportError: function (e) { reportError(e); }
  };
  function registerExtension(ext) {
    try {
      if (!ext || typeof ext !== "object" || typeof ext.id !== "string" || ext.id === "") return false;
      for (var i = 0; i < extensions.length; i++) if (extensions[i].id === ext.id) return false;
      if (extensions.length >= EXT_MAX) return false;
      extensions.push(ext);
      if (typeof ext.onInstall === "function") {
        try { ext.onInstall(extApi); } catch (ei) { reportError(ei); }
      }
      return true;
    } catch (e) {
      reportError(e);
      return false;
    }
  }
  bridge.registerExtension = registerExtension;
  bridge.extensions = function () {
    var ids = [];
    for (var i = 0; i < extensions.length; i++) ids.push(extensions[i].id);
    return ids;
  };
  function extCaptures(sc) {
    if (!captureMenuScenes) return false;
    for (var i = 0; i < extensions.length; i++) {
      var x = extensions[i];
      if (typeof x.captureScene !== "function") continue;
      try { if (x.captureScene(sc) === true) return true; } catch (e) { reportError(e); }
    }
    return false;
  }
  function cleanMeta(m) {
    if (!m || typeof m !== "object") return null;
    var out = {}, n = 0;
    for (var k in m) {
      if (!Object.prototype.hasOwnProperty.call(m, k) || n >= META_KEYS_MAX) continue;
      var v = m[k];
      if (typeof v === "string") v = v.length > META_TEXT_MAX ? v.slice(0, META_TEXT_MAX) : v;
      else if (typeof v === "number") { if (!isFinite(v)) continue; }
      else if (typeof v !== "boolean") continue;
      out[k] = v;
      n++;
    }
    return n > 0 ? out : null;
  }
  // entry after every extension's snapshotEntry / snapshotMeta; null = dropped
  function extEntry(sprite, entry, sc) {
    if (!entry || extensions.length === 0) return entry;
    var meta = null;
    for (var i = 0; i < extensions.length; i++) {
      var x = extensions[i];
      if (typeof x.snapshotEntry === "function") {
        try {
          var r = x.snapshotEntry(sprite, entry, sc);
          if (r === null) return null;
          if (r && typeof r.length === "number" && r.length >= 9) entry = r;
        } catch (e) { reportError(e); }
      }
      if (meta === null && typeof x.snapshotMeta === "function") {
        try { meta = cleanMeta(x.snapshotMeta(sprite, entry, sc)); } catch (em) { reportError(em); }
      }
    }
    if (!(entry[7] > 0)) return null;
    if (meta) {
      while (entry.length < 14) entry.push(0);
      entry[14] = meta;
    }
    return entry;
  }

  // Picture sprites of the current scene: the spriteset's _pictureContainer first, then any moved elsewhere.
  // 1.10.0: the same walk collects every other sprite showing an img/pictures bitmap (plugins drawing cut-ins with
  // plain Sprites), its world transform and alpha accumulated down the tree. Bounded: depth 8, PICS_TREE_MAX nodes;
  // a tilemap and sprites showing other img folders (characters, battlers, system...) are not entered.
  // 1.16.0: plugins add cut-in containers last to Spriteset_Map, behind the tilemap, every character, light / fog
  // layers...: the picture container is read first, then the spriteset's children from the top-most (last) down,
  // then the rest of the scene. Tilemaps, Sprite_Character / Balloon / Animation / Destination and Weather are never
  // entered, and only nodes that show an img/pictures bitmap or have children count toward PICS_TREE_MAX (a bare
  // leaf is skipped for free; PICS_STEP_MAX bounds the whole loop). Plain sprites keep their drawing order.
  // Returns { pictures: [Sprite_Picture], sprites: [{ s, name, m, alpha }], pending: picture bitmaps still loading }.
  var SPRITE_ID_BASE = 1000, lastScanVisited = 0, PICS_STEP_MAX = 30000;
  var SCAN_SKIP = ["Tilemap", "ShaderTilemap", "Sprite_Character", "Sprite_Balloon", "Sprite_Animation", "Sprite_AnimationMV",
    "Weather", "Sprite_Destination"];
  var IDENTITY = [1, 0, 0, 1, 0, 0];
  function numOr(v, d) { return typeof v === "number" && isFinite(v) ? v : d; }
  function localMatrix(n) {
    var s = n.scale || {}, pv = n.pivot || {};
    var sx = numOr(s.x, 1), sy = numOr(s.y, 1), r = numOr(n.rotation, 0);
    var cos = r ? Math.cos(r) : 1, sin = r ? Math.sin(r) : 0;
    var a = cos * sx, b = sin * sx, c = -sin * sy, d = cos * sy;
    var px = numOr(pv.x, 0), py = numOr(pv.y, 0);
    return [a, b, c, d, numOr(n.x, 0) - (px * a + py * c), numOr(n.y, 0) - (px * b + py * d)];
  }
  function mulMatrix(p, l) {
    return [p[0] * l[0] + p[2] * l[1], p[1] * l[0] + p[3] * l[1], p[0] * l[2] + p[2] * l[3], p[1] * l[2] + p[3] * l[3],
      p[0] * l[4] + p[2] * l[5] + p[4], p[1] * l[4] + p[3] * l[5] + p[5]];
  }
  function ownAlpha(n) { return n.visible === false ? 0 : numOr(n.alpha, 1); }
  function worldOf(node, sc) {
    var chain = [], n = node, k = 0;
    while (n && n !== sc && k++ < 50) { chain.push(n); n = n.parent; }
    var m = IDENTITY, a = 1;
    for (var i = chain.length - 1; i >= 0; i--) { m = mulMatrix(m, localMatrix(chain[i])); a *= ownAlpha(chain[i]); }
    return { m: m, alpha: n === sc ? a : 0 };
  }
  function bitmapUrl(b) {
    if (!b || typeof b !== "object") return null;
    if (typeof b._url === "string") return b._url;
    try { if (typeof b.url === "string") return b.url; } catch (e) { /* no url */ }
    return null;
  }
  // "img/pictures/organ/a%20b.png" -> "organ/a b" (any extension, e.g. .rpgmvp / .png_); null when not a picture
  function pictureNameOfUrl(u) {
    var s = String(u).replace(/\\/g, "/");
    var i = s.indexOf("img/pictures/");
    if (i < 0) return null;
    s = s.slice(i + 13);
    var q = s.search(/[?#]/);
    if (q >= 0) s = s.slice(0, q);
    s = s.replace(/\.[A-Za-z0-9_]{1,8}$/, "");
    try { s = decodeURIComponent(s); } catch (e) { /* keep as is */ }
    return s === "" ? null : s;
  }
  // 1.18.0: plugins that load a picture (ImageManager.loadNormalBitmap("img/pictures/...") & co) and draw it whole
  // into their own canvas (BYWorkElement images: the standing portrait that slides and changes on hits in battle)
  // show no picture URL. Bitmap.blt / bltImage of a whole picture onto the whole canvas tags the canvas with it
  // ({ name, w, h }: the picture and its own size); a full clear / clearRect forgets it. A part of a picture (a sheet
  // frame) or a picture drawn into a part of the canvas (window contents) is no tag.
  var DRAWN_KEY = "_rpgvDrawnPic";
  function drawnPicture(b) {
    if (!b || typeof b !== "object") return null;
    var d = b[DRAWN_KEY];
    return d && typeof d.name === "string" ? d : null;
  }
  function near(a, b) { return typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1; }
  function noteBlt(dest, args) {
    var src = args[0];
    var u = bitmapUrl(src);
    var name = u ? pictureNameOfUrl(u) : null;
    if (name === null) return;
    var own = bitmapUrl(dest);
    if (own) return; // a loaded image drawn on: its own URL tells what it is
    var sw = args[3], sh = args[4], dw = args[7], dh = args[8];
    if (!dw) dw = sw; // like Bitmap.blt: dw = dw || sw
    if (!dh) dh = sh;
    var w = numOr(src.width, 0), h = numOr(src.height, 0);
    if (!(w > 0 && h > 0)) return;
    if (!near(args[1], 0) || !near(args[2], 0) || !near(sw, w) || !near(sh, h)) return;
    if (!near(args[5], 0) || !near(args[6], 0) || !near(dw, dest.width) || !near(dh, dest.height)) return;
    var old = drawnPicture(dest);
    if (old && old.name === name && old.w === w && old.h === h) return;
    try {
      Object.defineProperty(dest, DRAWN_KEY, { value: { name: name, w: w, h: h }, configurable: true, writable: true, enumerable: false });
    } catch (e) { dest[DRAWN_KEY] = { name: name, w: w, h: h }; }
    markScreenDirty();
  }
  function forgetDrawn(dest, args) {
    if (!drawnPicture(dest)) return;
    if (args && args.length >= 4) {
      // clearRect(x, y, width, height): only a clear of the whole canvas
      if (!(numOr(args[0], 1) <= 0 && numOr(args[1], 1) <= 0 && numOr(args[2], 0) >= dest.width && numOr(args[3], 0) >= dest.height)) return;
    }
    dest[DRAWN_KEY] = null;
    markScreenDirty();
  }
  function scanScene(sc) {
    if (!sc || (!sc._spriteset && !extCaptures(sc))) return null;
    var SP = G.Sprite_Picture;
    var res = { pictures: [], sprites: [], pending: 0 };
    var visited = 0, steps = 0;
    var skipKinds = [];
    for (var k = 0; k < SCAN_SKIP.length; k++) if (typeof G[SCAN_SKIP[k]] === "function") skipKinds.push(G[SCAN_SKIP[k]]);
    var skipped = function (c) {
      for (var j = 0; j < skipKinds.length; j++) if (c instanceof skipKinds[j]) return true;
      return false;
    };
    var spriteset = sc._spriteset || null;
    var container = (spriteset && spriteset._pictureContainer) || null;
    // children of node (seen at depth) into out; skip / skip2 are walked on their own
    var walk = function (node, depth, m, alpha, skip, skip2, out) {
      var ch = node && node.children;
      if (!ch || typeof ch.length !== "number" || depth > 8) return;
      for (var i = 0; i < ch.length; i++) visit(ch[i], depth, m, alpha, skip, skip2, out);
    };
    var visit = function (c, depth, m, alpha, skip, skip2, out) {
      if (!c || typeof c !== "object" || c === skip || c === skip2) return;
      if (++steps > PICS_STEP_MAX || visited >= PICS_TREE_MAX) return;
      if (typeof c._pictureId === "number" && (typeof SP !== "function" || c instanceof SP)) {
        visited++;
        res.pictures.push(c);
        return;
      }
      if (skipped(c)) return;
      var url = bitmapUrl(c.bitmap);
      var name = null, drawn = null;
      if (url !== null && url !== "") { // "" = a bitmap drawn in memory (window contents, plugin canvases)
        name = pictureNameOfUrl(url);
        if (name === null) return; // another img folder: what it carries is effects / icons
      } else if ((drawn = drawnPicture(c.bitmap)) !== null) {
        name = drawn.name; // 1.18.0: a canvas that is a whole picture drawn into it (Bitmap.blt)
      }
      var ch = c.children;
      var kids = !!ch && typeof ch.length === "number" && ch.length > 0;
      if (name === null && !kids) return; // a bare leaf: nothing to read
      visited++;
      var cm = mulMatrix(m, localMatrix(c));
      var ca = alpha * ownAlpha(c);
      if (name !== null) {
        var b = c.bitmap;
        if (!(typeof b.isError === "function" && b.isError()) && ca > 0) {
          var ready = !(typeof b.isReady === "function" && !b.isReady()) && numOr(b.width, 0) > 0 && numOr(b.height, 0) > 0;
          if (ready) out.push({ s: c, name: name, m: cm, alpha: ca, drawn: drawn });
          else res.pending++;
        }
      }
      if (kids) walk(c, depth + 1, cm, ca, skip, skip2, out);
    };
    if (container) {
      var w = worldOf(container, sc);
      walk(container, 0, w.m, w.alpha, null, null, res.sprites);
    }
    // the spriteset (when it is on the scene) from its top-most child down, kept in drawing order
    var setBuckets = null;
    if (spriteset && spriteset.parent === sc && spriteset.children && typeof spriteset.children.length === "number") {
      var sw = worldOf(spriteset, sc);
      var sch = spriteset.children;
      setBuckets = [];
      if (++steps <= PICS_STEP_MAX && visited < PICS_TREE_MAX) visited++;
      for (var si = sch.length - 1; si >= 0; si--) {
        var bucket = [];
        visit(sch[si], 1, sw.m, sw.alpha, container, null, bucket);
        setBuckets[si] = bucket;
      }
    }
    var rest = [];
    walk(sc, 0, IDENTITY, 1, container, setBuckets ? spriteset : null, rest);
    // drawing order: the spriteset is the scene's bottom layer, then the rest (windows, other layers)
    if (setBuckets) for (var bi = 0; bi < setBuckets.length; bi++) if (setBuckets[bi]) for (var bj = 0; bj < setBuckets[bi].length; bj++) res.sprites.push(setBuckets[bi][bj]);
    for (var ri = 0; ri < rest.length; ri++) res.sprites.push(rest[ri]);
    lastScanVisited = visited;
    return res;
  }

  // Entry of a plain sprite (1.10.0): world position / scale / angle decomposed from its world matrix (no skew),
  // drawn opacity, tone, bitmap size; marked "sprite" (index 13). id is set by the caller.
  function plainEntry(it) {
    var s = it.s, m = it.m, b = s.bitmap;
    var op = picNum(it.alpha * 255, 0);
    var sxw = Math.sqrt(m[0] * m[0] + m[1] * m[1]);
    if (!(op > 0) || !(sxw > 0)) return null;
    var syw = (m[0] * m[3] - m[1] * m[2]) / sxw;
    if (!syw) return null;
    var bw = b.width, bh = b.height;
    // 1.18.0: a picture drawn into a canvas: the picture's own size, scaled as the canvas stretched it
    var dr = it.drawn;
    if (dr && dr.w > 0 && dr.h > 0 && bw > 0 && bh > 0) {
      sxw *= bw / dr.w; syw *= bh / dr.h; bw = dr.w; bh = dr.h;
    }
    var an = s.anchor || {};
    var ax = picNum(an.x, 0), ay = picNum(an.y, 0);
    var origin = ax === 0 && ay === 0 ? 0 : (ax === 0.5 && ay === 0.5 ? 1 : [ax, ay]);
    var tone = toneOf(s._colorTone);
    if (!tone && typeof s.getColorTone === "function") {
      try { tone = toneOf(s.getColorTone()); } catch (et) { tone = null; }
    }
    return [0, picName(it.name), origin, picNum(m[4], 0), picNum(m[5], 0), picNum(sxw * 100, 100), picNum(syw * 100, 100), op,
      typeof s.blendMode === "number" ? s.blendMode : 0, tone || 0, picNum(Math.atan2(m[1], m[0]) * 180 / Math.PI, 0),
      picNum(bw, 0), picNum(bh, 0), "sprite"];
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
    var s = screenNow();
    return s ? s.pics : null;
  }
  // { pics, pending } of what is drawn now (pending: picture bitmaps of plain sprites still loading); null = no screen.
  // Picture sprites first (by picture id), then plain sprites in drawing order with ids SPRITE_ID_BASE + n.
  function screenNow() {
    var sc = G.SceneManager && G.SceneManager._scene;
    var res = scanScene(sc);
    if (res && (res.pictures.length || res.sprites.length || res.pending)) {
      var out = [], ids = {};
      for (var i = 0; i < res.pictures.length; i++) {
        var e = extEntry(res.pictures[i], spriteEntry(res.pictures[i], sc), sc);
        if (e && ids[e[0]] !== true) { ids[e[0]] = true; out.push(e); }
      }
      out.sort(function (a, b) { return a[0] - b[0]; });
      var n = 0;
      for (var j = 0; j < res.sprites.length; j++) {
        var pe = extEntry(res.sprites[j].s, plainEntry(res.sprites[j]), sc);
        if (pe) { pe[0] = SPRITE_ID_BASE + n++; out.push(pe); }
      }
      return { pics: out.length > PICS_MAX ? out.slice(0, PICS_MAX) : out, pending: res.pending };
    }
    var g = gamePictures();
    return g === null ? null : { pics: g, pending: 0 };
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
  // null when capture is off / no screen. In battle (1.8.0+) the battle scene's picture sprites are read the same
  // way (enemy / actor battler sprites carry no picture id and are never recorded).
  function picsFields() {
    if (!capturePictures) return null;
    // 1.17.0: on a menu scene no snapshot (unless the viewer asked for menu scenes)
    if (syncPicsScene() && !captureMenuScenes) return null;
    var pics = picturesNow();
    if (pics === null) return null;
    var key = JSON.stringify(pics);
    if (key === lastPicsKey) return { picsSame: true };
    lastPicsKey = key;
    lastPicsSet = picsSet(pics);
    return { pics: pics };
  }
  // 1.10.1 change signature of a snapshot: only the SET of visible images (opacity > 10% of 255), each as
  // name + 64 px position bucket. Opacity, tone, scale and small moves alone never change it.
  var SCREEN_VISIBLE_OP = 25.5, SCREEN_POS_BUCKET = 64;
  function picVisible(e) { return e[7] > SCREEN_VISIBLE_OP; }
  function picSetPart(e) {
    return e[1] + "|" + Math.round(e[3] / SCREEN_POS_BUCKET) + "|" + Math.round(e[4] / SCREEN_POS_BUCKET);
  }
  function picsSet(pics) {
    var parts = [];
    for (var i = 0; i < pics.length; i++) if (picVisible(pics[i])) parts.push(picSetPart(pics[i]));
    parts.sort();
    return parts.join("\n");
  }

  // ---------------------------------------------------------------- screen snapshots between records (1.10.0 / 1.10.1)
  // Images other plugins show briefly (battle cut-ins) appear and vanish between messages. Event-driven: picture
  // loads (ImageManager.loadPicture & co, and when their bitmap becomes ready), plugin commands, battle actions /
  // log lines, picture commands and message starts mark the screen dirty; after the next scene update the drawn
  // pictures are read. For SCREEN_WATCH_MS after a dirty frame the screen is re-read every SCREEN_WATCH_GAP_MS, and a
  // slow poll (SCREEN_POLL_MS) re-reads it anyway.
  // 1.10.1: a record is written only when the SET of visible images changed (picsSet: name + 64 px bucket, opacity
  // > 10%) — fades, tone, scale animation and small moves alone never make one. Once the set changed, it waits until
  // the screen settles (no set change and no opacity change > 10% for SCREEN_SETTLE_MS, at most SCREEN_SETTLE_MAX_MS)
  // and records the settled visible images (a fade-in with the highest opacity seen while settling). A fading-out
  // image is recorded as gone once it drops to 10% or less. A record before the screen settled (max wait) keeps at
  // least SCREEN_MIN_GAP_MS from the one before. Never while a message waits for its own snapshot; at most
  // SCREEN_RATE_MAX per second. Written as { type: "screen", scene, pics }.
  var SCREEN_RATE_MAX = 8, SCREEN_RATE_MS = 1000, SCREEN_WATCH_MS = 600, SCREEN_WATCH_GAP_MS = 100, SCREEN_POLL_MS = 1000;
  var SCREEN_SETTLE_MS = 150, SCREEN_SETTLE_MAX_MS = 600, SCREEN_SETTLE_GAP_MS = 50, SCREEN_MIN_GAP_MS = 250;
  var screenDirty = false;
  var screenWatch = { until: -Infinity, lastT: -Infinity, pollT: -Infinity, writeT: -Infinity, times: [] };
  // set change waiting to settle: { set, start, since, ops: { part: opacity at the last change }, max: { part: highest } }
  var screenSettle = null;
  function markScreenDirty() { if (capturePictures) screenDirty = true; }
  function watchBitmap(b) {
    if (!capturePictures) return;
    screenDirty = true;
    try {
      if (b && typeof b.addLoadListener === "function" && typeof b.isReady === "function" && !b.isReady()) {
        b.addLoadListener(function () { screenDirty = true; });
      }
    } catch (e) { reportError(e); }
  }
  // part (picSetPart) -> opacity of the visible images
  function visibleOps(pics) {
    var o = Object.create(null);
    for (var i = 0; i < pics.length; i++) {
      var e = pics[i];
      if (!picVisible(e)) continue;
      var k = picSetPart(e);
      if (!(o[k] >= e[7])) o[k] = e[7];
    }
    return o;
  }
  // One read of a loaded screen: start / follow the settling of a set change and write it once settled.
  function screenStep(snap, t) {
    var set = picsSet(snap.pics);
    if (heldMsg || set === lastPicsSet || (lastPicsSet === null && set === "")) { screenSettle = null; return; }
    var ops = visibleOps(snap.pics), st = screenSettle, k;
    if (!st || st.set !== set) {
      var max = Object.create(null);
      for (k in ops) max[k] = st && st.max[k] > ops[k] ? st.max[k] : ops[k];
      st = screenSettle = { set: set, start: st ? st.start : t, since: t, ops: ops, max: max };
    } else {
      var moved = false;
      for (k in ops) {
        if (!(Math.abs(ops[k] - st.ops[k]) <= SCREEN_VISIBLE_OP)) moved = true;
        if (!(st.max[k] >= ops[k])) st.max[k] = ops[k];
      }
      if (moved) { st.since = t; st.ops = ops; }
    }
    var settled = t - st.since >= SCREEN_SETTLE_MS;
    if (!settled && (t - st.start < SCREEN_SETTLE_MAX_MS || t - screenWatch.writeT < SCREEN_MIN_GAP_MS)) return;
    var times = screenWatch.times;
    while (times.length && t - times[0] >= SCREEN_RATE_MS) times.shift();
    if (times.length >= SCREEN_RATE_MAX) return;
    var out = [];
    for (var i = 0; i < snap.pics.length; i++) {
      var e = snap.pics[i];
      if (!picVisible(e)) continue;
      var c = e.slice();
      var m = st.max[picSetPart(e)];
      if (m > c[7]) c[7] = m;
      out.push(c);
    }
    times.push(t);
    screenWatch.writeT = t;
    screenSettle = null;
    lastPicsKey = JSON.stringify(out);
    lastPicsSet = set;
    var kind = sceneKind();
    emit("screen", { scene: inBattleNow() || kind === "battle" ? "battle" : (kind === "menu" ? "menu" : "map"), pics: out });
  }
  // After each real frame's scene update (what is about to be rendered).
  function screenFrame() {
    if (!capturePictures || run === null) { screenDirty = false; screenSettle = null; return; }
    var t = now();
    var dirty = screenDirty;
    var watching = t < screenWatch.until && t - screenWatch.lastT >= SCREEN_WATCH_GAP_MS;
    var settling = screenSettle !== null && t - screenWatch.lastT >= SCREEN_SETTLE_GAP_MS;
    var polling = t - screenWatch.pollT >= SCREEN_POLL_MS;
    if (!dirty && !watching && !settling && !polling) return;
    var sm = G.SceneManager, sc = sm && sm._scene;
    // 1.16.0: not while a scene change is pending or the new scene has not started (leaving the map for the menu,
    // the map coming back): the half-built screen is no "gone" picture. lastPicsSet survives the scene change, so
    // the map that comes back with the same pictures writes nothing.
    if (sc && (sm._nextScene || sm._exiting || sm._sceneStarted === false)) { screenDirty = true; return; }
    // 1.17.1: a menu scene (even with its own spriteset) only when the viewer asked for menu scenes
    var menuNow = syncPicsScene();
    var snap = sc && (menuNow ? captureMenuScenes && (sc._spriteset || extCaptures(sc)) : (sc._spriteset || extCaptures(sc)))
      ? screenNow() : null;
    screenDirty = false;
    if (!snap) { screenSettle = null; return; }
    screenWatch.lastT = t;
    if (polling) screenWatch.pollT = t;
    if (dirty) screenWatch.until = t + SCREEN_WATCH_MS;
    if (snap.pending > 0) return; // still loading: its load listener marks the screen dirty again
    screenStep(snap, t);
  }

  // ---------------------------------------------------------------- battle log (1.8.0)
  function clipName(s) {
    var t = s == null ? "" : String(s);
    return t.length > BATTLE_NAME_MAX ? t.slice(0, BATTLE_NAME_MAX) : t;
  }

  function battleStartFields(BM, troopId) {
    var fields = { phase: "start", troopId: troopId };
    var dt = G.$dataTroops && isCount(troopId) ? G.$dataTroops[troopId] : null;
    if (dt && typeof dt.name === "string") fields.troopName = clipName(dt.name);
    var tr = G.$gameTroop;
    var members = tr && typeof tr.members === "function" ? tr.members() : null;
    if (members && typeof members.length === "number") {
      var enemies = [];
      for (var i = 0; i < members.length && enemies.length < BATTLE_ENEMIES_MAX; i++) {
        var e = members[i];
        try { if (e && typeof e.name === "function") enemies.push(clipName(e.name())); } catch (ee) { reportError(ee); }
      }
      fields.enemies = enemies;
    }
    fields.canEscape = !!(BM && BM._canEscape);
    fields.canLose = !!(BM && BM._canLose);
    return fields;
  }

  function battleRewards(BM) {
    var rw = BM && BM._rewards;
    if (!rw || typeof rw !== "object") return null;
    var items = [];
    var list = rw.items && typeof rw.items.length === "number" ? rw.items : [];
    for (var i = 0; i < list.length && items.length < BATTLE_ITEMS_MAX; i++) {
      if (list[i] && typeof list[i].name === "string") items.push(clipName(list[i].name));
    }
    return { exp: typeof rw.exp === "number" && isFinite(rw.exp) ? rw.exp : 0, gold: typeof rw.gold === "number" && isFinite(rw.gold) ? rw.gold : 0, items: items };
  }

  // One line of battle text. Identical consecutive lines within BATTLE_DUP_MS are one line; beyond
  // BATTLE_LINES_MAX per battle or BATTLE_RATE_MAX per second lines are only counted (end record "dropped").
  // Buffered like any record (written by the 250 ms tick). With picture capture on, a line carries the
  // pictures only when they changed (checked at most every BATTLE_PICS_GAP_MS, never while a message waits
  // for its own snapshot).
  // extra (1.8.1): fields of an action line ({ kind: "action", by, isEnemy, item, itemKind, targets? }); its text may be "".
  function battleLine(text, extra) {
    var b = battleLog;
    if (!b || run === null) return;
    var s = text == null ? "" : String(text);
    if (s === "" && !extra) return;
    if (s.length > BATTLE_TEXT_MAX) s = s.slice(0, BATTLE_TEXT_MAX);
    var key = extra ? "\u0001" + extra.by + "\u0001" + extra.item + "\u0001" + s : s;
    var t = now();
    if (key === b.lastText && t - b.lastT < BATTLE_DUP_MS) { b.lastT = t; return; }
    b.lastText = key;
    b.lastT = t;
    if (b.lines >= BATTLE_LINES_MAX) { b.dropped++; return; }
    while (b.times.length && t - b.times[0] >= BATTLE_RATE_MS) b.times.shift();
    if (b.times.length >= BATTLE_RATE_MAX) { b.dropped++; return; }
    b.times.push(t);
    b.lines++;
    var fields = { text: s };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) fields[k] = extra[k];
    if (capturePictures && !heldMsg && t - b.picsT >= BATTLE_PICS_GAP_MS) {
      b.picsT = t;
      var pf = null;
      try { pf = picsFields(); } catch (ep) { reportError(ep); }
      if (pf && pf.pics) fields.pics = pf.pics;
    }
    emit("battlelog", fields);
  }

  // 1.8.1: who used which skill / item. Window_BattleLog.displayAction(subject, item) queues the action line
  // (push('addText', …)); battle plugins such as YEP_BattleEngineCore replace it with a bare skill name
  // ("<SIMPLE>할퀴기"). The wrapper writes one action line right away (by, isEnemy, item, itemKind, targets)
  // with the first queued text, and that queued text is not written again when addText runs it later.
  function actionInfo(subject, item) {
    if (!subject || !item || typeof item !== "object") return null;
    var info = { kind: "action", by: "", isEnemy: false, item: clipName(typeof item.name === "string" ? item.name : ""), itemKind: "skill" };
    try { if (typeof subject.name === "function") info.by = clipName(subject.name()); } catch (e1) { reportError(e1); }
    try { info.isEnemy = typeof subject.isEnemy === "function" && !!subject.isEnemy(); } catch (e2) { reportError(e2); }
    try {
      var DM = G.DataManager;
      var isItem = DM && typeof DM.isItem === "function" ? !!DM.isItem(item) : "itypeId" in item;
      if (isItem) info.itemKind = "item";
    } catch (e3) { reportError(e3); }
    try {
      var tg = G.BattleManager && G.BattleManager._targets;
      if (tg && typeof tg.length === "number" && tg.length > 0) {
        var names = [];
        for (var i = 0; i < tg.length && names.length < BATTLE_ENEMIES_MAX; i++) {
          if (tg[i] && typeof tg[i].name === "function") names.push(clipName(tg[i].name()));
        }
        if (names.length) info.targets = names;
      }
    } catch (e4) { reportError(e4); }
    return info;
  }

  // Wraps whatever displayAction is installed now (a battle plugin loaded after this one replaces the
  // prototype function: checked again at every battle setup). Never changes what the game shows.
  function ensureActionHook() {
    var WB = G.Window_BattleLog && G.Window_BattleLog.prototype;
    if (!WB || typeof WB.displayAction !== "function" || WB.displayAction.__rpgvAction) return;
    var orig = WB.displayAction;
    var wrapped = function (subject, item) {
      var info = null, captured = null, hadOwn = false, ownPush = null, self = this;
      try {
        if (battleLog && run !== null && inBattleNow()) {
          info = actionInfo(subject, item);
          if (info && typeof self.push === "function") {
            captured = [];
            hadOwn = Object.prototype.hasOwnProperty.call(self, "push");
            ownPush = self.push;
            var basePush = self.push;
            self.push = function (name, text) {
              try { if (name === "addText" && captured.length < 1) captured.push(text == null ? "" : String(text)); } catch (ec) { reportError(ec); }
              return basePush.apply(this, arguments);
            };
          }
        }
      } catch (e) { reportError(e); }
      try {
        return orig.apply(this, arguments);
      } finally {
        if (captured) {
          try { if (hadOwn) self.push = ownPush; else delete self.push; } catch (er) { reportError(er); }
        }
        if (info) {
          try {
            var first = captured && captured.length ? captured[0] : "";
            self._rpgvSkip = first !== "" ? first : null;
            battleLine(first, info);
          } catch (ea) { reportError(ea); }
        }
      }
    };
    wrapped.__rpgvAction = true;
    WB.displayAction = wrapped;
    if (bridge._hooks.indexOf("Window_BattleLog.displayAction") < 0) bridge._hooks.push("Window_BattleLog.displayAction");
  }

  // ---------------------------------------------------------------- notices (1.9.0)
  // control.json "noticeHooks": extra "Global.path.to.fn" strings (validated, at most NOTICE_HOOKS_MAX).
  function noticePaths(v) {
    var out = [];
    if (!v || typeof v.length !== "number") return out;
    for (var i = 0; i < v.length && out.length < NOTICE_HOOKS_MAX; i++) {
      var p = v[i];
      if (typeof p !== "string" || p.length > NOTICE_PATH_MAX || !NOTICE_PATH_RE.test(p)) continue;
      if (p.split(".").indexOf("__proto__") >= 0 || out.indexOf(p) >= 0) continue;
      out.push(p);
    }
    return out;
  }

  // "A.b.c" -> { owner: A.b, name: "c" } when A.b.c is a function now, else null.
  function resolveNoticePath(p) {
    var parts = p.split(".");
    var owner = G;
    for (var i = 0; i < parts.length - 1; i++) {
      owner = owner[parts[i]];
      if (!owner || (typeof owner !== "object" && typeof owner !== "function")) return null;
    }
    var name = parts[parts.length - 1];
    return typeof owner[name] === "function" ? { owner: owner, name: name } : null;
  }

  // The text a notice call shows: a string first argument, or { message } / { text } of an object.
  function noticeArgText(a) {
    if (typeof a === "string") return a;
    if (a && typeof a === "object") {
      if (typeof a.message === "string") return a.message;
      if (typeof a.text === "string") return a.text;
    }
    return null;
  }

  // \n[1], \v[3], \p[1], \g ... expanded the way the game's windows do (Window_Base.convertEscapeCharacters,
  // including plugin extensions); codes left over (\c[], \i[] ...) keep their backslash. Fallback: the raw text.
  function expandNotice(raw) {
    if (!noticeWin) {
      var WBp = G.Window_Base && G.Window_Base.prototype;
      if (!WBp || typeof WBp.convertEscapeCharacters !== "function") return raw;
      noticeWin = Object.create(WBp); // no bitmap / contents: only the prototype's text helpers are used
    }
    try {
      var out = noticeWin.convertEscapeCharacters(raw);
      return typeof out === "string" ? out.split("\u001b").join("\\") : raw;
    } catch (e) {
      return raw; // a plugin's override that needs a real window
    }
  }

  function recordNotice(arg, source) {
    if (!captureNotices || run === null) return;
    var raw = noticeArgText(arg);
    if (raw === null || !/\S/.test(raw)) return;
    if (raw.length > NOTICE_TEXT_MAX) raw = raw.slice(0, NOTICE_TEXT_MAX);
    var text = expandNotice(raw);
    if (text.length > NOTICE_TEXT_MAX) text = text.slice(0, NOTICE_TEXT_MAX);
    var key = source + "\u0001" + text;
    var t = now(), n = noticeLast;
    if (key === n.key && t - n.t < NOTICE_DUP_MS) { n.t = t; return; }
    n.key = key;
    n.t = t;
    while (n.times.length && t - n.times[0] >= NOTICE_RATE_MS) n.times.shift();
    if (n.times.length >= NOTICE_RATE_MAX) return;
    n.times.push(t);
    emit("notice", { source: source, text: text, raw: raw });
  }

  function wrapNotice(owner, name, source) {
    var orig = owner[name];
    var wrapped = function () {
      try { if (captureNotices) recordNotice(arguments[0], source); } catch (e) { reportError(e); }
      return orig.apply(this, arguments);
    };
    wrapped.__rpgvNotice = true;
    if (orig.prototype) wrapped.prototype = orig.prototype; // a wrapped constructor keeps its methods
    owner[name] = wrapped;
  }

  // Wraps every known notice API and every extra path that is a function right now (plugins may define
  // their globals late: checked again on Scene_Map / Scene_Battle start and when control.json changes).
  // A function is wrapped once; a replacement installed later is wrapped again.
  function ensureNoticeHooks() {
    if (!captureNotices) return;
    var list = [];
    for (var i = 0; i < NOTICE_BUILTIN.length; i++) list.push(NOTICE_BUILTIN[i]);
    for (var j = 0; j < noticeExtra.length; j++) list.push({ path: noticeExtra[j], source: noticeExtra[j] });
    for (var k = 0; k < list.length; k++) {
      try {
        var r = resolveNoticePath(list[k].path);
        if (!r || r.owner[r.name].__rpgvNotice) continue;
        wrapNotice(r.owner, r.name, list[k].source);
        if (noticeHooked.indexOf(list[k].path) < 0) noticeHooked.push(list[k].path);
        if (bridge._hooks.indexOf(list[k].path) < 0) bridge._hooks.push(list[k].path);
      } catch (e) { reportError(e); }
    }
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
            emit("message", mrec, capturePictures);
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
    // Battle-system messages (appeared / victory / exp / gold / drops / level up / escape / defeat) are added
    // by BattleManager, outside any interpreter command; event Show Text runs inside one (recorded as message).
    hook(GM, "Game_Message", "add", function (orig) {
      return function (text) {
        try { if (battleLog && currentCtx === null && inBattleNow()) battleLine(text); } catch (e) { reportError(e); }
        return orig.apply(this, arguments);
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
            var f = { src: srcOf(this), cmd: i, pictureId: p[0], name: p[1] == null ? "" : String(p[1]) };
            pictureFields(f, p);
            emit("picture", f);
          }
        } catch (e) { reportError(e); }
        return orig.apply(this, arguments);
      };
    });

    // 1.15.0: Move Picture (232) logs its final target, Erase Picture (235) the picture id, so the viewer can
    // rebuild layered pictures from commands alone (name "" keeps older viewers from showing them).
    hook(GI, "Game_Interpreter", "command232", function (orig) {
      return function () {
        try {
          var i = cmdAt(this, 232);
          if (i >= 0 && run !== null) {
            var p = this._list[i].parameters || [];
            var f = { src: srcOf(this), cmd: i, pictureId: p[0], name: "", op: "move" };
            pictureFields(f, p);
            emit("picture", f);
          }
        } catch (e) { reportError(e); }
        return orig.apply(this, arguments);
      };
    });

    hook(GI, "Game_Interpreter", "command235", function (orig) {
      return function () {
        try {
          var i = cmdAt(this, 235);
          if (i >= 0 && run !== null) {
            var p = this._list[i].parameters || [];
            emit("picture", { src: srcOf(this), cmd: i, pictureId: p[0], name: "", op: "erase" });
          }
        } catch (e) { reportError(e); }
        return orig.apply(this, arguments);
      };
    });

    function hookPlugin(code) {
      hook(GI, "Game_Interpreter", "command" + code, function (orig) {
        return function () {
          try { notePlugin(this, code); } catch (e) { reportError(e); }
          var r = orig.apply(this, arguments);
          markScreenDirty();
          return r;
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
        beginBattle(this, troopId);
        return r;
      };
    });
    // the battle start record; capturing: it waits for the battle scene (Scene_Battle.start) to take its pictures
    var beginBattle = function (bm, troopId) {
      try { battleStartT = now(); } catch (eb) { reportError(eb); }
      try { ensureActionHook(); } catch (eh) { reportError(eh); }
      try {
        battleLog = { lines: 0, dropped: 0, times: [], lastText: null, lastT: -Infinity, picsT: -Infinity };
        emit("battle", battleStartFields(bm, troopId), capturePictures ? BATTLE_HOLD_MS : false);
      } catch (e) { reportError(e); }
    };
    hook(BM, "BattleManager", "endBattle", function (orig) {
      return function (result) {
        try {
          var names = ["win", "escape", "lose"];
          var fields = { phase: "end", troopId: G.$gameTroop ? G.$gameTroop._troopId : 0 };
          if (names[result]) fields.result = names[result];
          // processAbort (event command "Abort Battle") ends with 1 like a successful escape
          if (result === 1 && !this._escaped) fields.result = "abort";
          if (result === 0) {
            var rw = null;
            try { rw = battleRewards(this); } catch (er) { reportError(er); }
            if (rw) fields.rewards = rw;
          }
          if (battleLog && battleLog.dropped > 0) fields.dropped = battleLog.dropped;
          if (capturePictures) {
            finishHeld(); // a waiting message takes its own snapshot first (the dedupe follows log order)
            var pf = null;
            try { pf = picsFields(); } catch (ep) { reportError(ep); }
            if (pf && pf.pics) fields.pics = pf.pics;
            else if (pf) fields.picsSame = true;
          }
          emit("battle", fields);
        } catch (e) { reportError(e); }
        battleLog = null;
        return orig.apply(this, arguments);
      };
    });
    var SB = G.Scene_Battle && G.Scene_Battle.prototype;
    hook(SB, "Scene_Battle", "start", function (orig) {
      return function () {
        var r = orig.apply(this, arguments);
        // 1.18.0: a battle whose BattleManager.setup this plugin never saw (set up before it loaded, or by a plugin
        // that replaced BattleManager.setup without calling it) still gets its start record
        try {
          if (battleLog === null && run !== null && inBattleNow()) {
            beginBattle(BM, G.$gameTroop && typeof G.$gameTroop._troopId === "number" ? G.$gameTroop._troopId : 0);
          }
        } catch (eb) { reportError(eb); }
        try { if (heldMsg && heldMsg.rec.type === "battle") { finishHeld(); scheduleFlush(); } } catch (e) { reportError(e); }
        try { ensureNoticeHooks(); } catch (en) { reportError(en); }
        return r;
      };
    });
    var SMap = G.Scene_Map && G.Scene_Map.prototype;
    hook(SMap, "Scene_Map", "start", function (orig) {
      return function () {
        var r = orig.apply(this, arguments);
        try { ensureNoticeHooks(); } catch (en) { reportError(en); }
        return r;
      };
    });
    var WB = G.Window_BattleLog && G.Window_BattleLog.prototype;
    hook(WB, "Window_BattleLog", "addText", function (orig) {
      return function (text) {
        try {
          var skip = this._rpgvSkip;
          // the action line displayAction queued was already written with who used it (until the next action)
          if (skip != null && skip === (text == null ? "" : String(text))) this._rpgvSkip = null;
          else if (battleLog && inBattleNow()) battleLine(text);
          markScreenDirty();
        } catch (e) { reportError(e); }
        return orig.apply(this, arguments);
      };
    });
    try { ensureActionHook(); } catch (eh) { reportError(eh); }
    try { ensureNoticeHooks(); } catch (en) { reportError(en); }

    // 1.10.0 screen watch: every image of the picture folder passes through these
    var IM = G.ImageManager;
    var pictureLoads = ["loadPicture", "reservePicture", "requestPicture"];
    for (var pl = 0; pl < pictureLoads.length; pl++) {
      hook(IM, "ImageManager", pictureLoads[pl], function (orig) {
        return function () {
          var b = orig.apply(this, arguments);
          try { watchBitmap(b); } catch (e) { reportError(e); }
          return b;
        };
      });
    }
    // 1.18.0: a picture loaded by its path (plugins drawing it into their own canvas), and that drawing
    hook(IM, "ImageManager", "loadNormalBitmap", function (orig) {
      return function (path) {
        var b = orig.apply(this, arguments);
        try { if (typeof path === "string" && pictureNameOfUrl(path) !== null) watchBitmap(b); } catch (e) { reportError(e); }
        return b;
      };
    });
    var BP = G.Bitmap && G.Bitmap.prototype;
    var bltNames = ["blt", "bltImage"];
    for (var bn = 0; bn < bltNames.length; bn++) {
      hook(BP, "Bitmap", bltNames[bn], function (orig) {
        return function () {
          var r = orig.apply(this, arguments);
          try { noteBlt(this, arguments); } catch (e) { reportError(e); }
          return r;
        };
      });
    }
    var clearNames = ["clear", "clearRect"];
    for (var cn = 0; cn < clearNames.length; cn++) {
      hook(BP, "Bitmap", clearNames[cn], function (orig) {
        return function () {
          var r = orig.apply(this, arguments);
          try { forgetDrawn(this, arguments); } catch (e) { reportError(e); }
          return r;
        };
      });
    }
    var dirtyAfter = function (owner, ownerName, name) {
      hook(owner, ownerName, name, function (orig) {
        return function () {
          var r = orig.apply(this, arguments);
          markScreenDirty();
          return r;
        };
      });
    };
    var GSc = G.Game_Screen && G.Game_Screen.prototype;
    dirtyAfter(GSc, "Game_Screen", "showPicture");
    dirtyAfter(GSc, "Game_Screen", "movePicture");
    dirtyAfter(GSc, "Game_Screen", "erasePicture");
    dirtyAfter(BM, "BattleManager", "startAction");
    dirtyAfter(BM, "BattleManager", "invokeAction");
    dirtyAfter(BM, "BattleManager", "endAction");

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
          try { screenFrame(); } catch (es) { reportError(es); }
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
        markScreenDirty();
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
  try { // extensions loaded before this plugin (1.13.0)
    var early = G.RPGViewerBridgeExtensions;
    if (early && typeof early.length === "number") {
      for (var xi = 0; xi < early.length; xi++) registerExtension(early[xi]);
    }
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
