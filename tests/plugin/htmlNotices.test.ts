import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";

// 1.19.0: AXY_Toast ($.toaster), Torigoya achievements, gain / quest context and HTML overlay notices
let h: Harness;
const GLOBALS = ["jQuery", "Torigoya", "Game_System", "document", "MutationObserver", "getComputedStyle"];
afterEach(() => {
  h?.bridge?._flushNow();
  for (const k of GLOBALS) delete (globalThis as any)[k];
});

const CONTROL_PATH = "/game/www/rpg-viewer/control.json";
function newGame(): Harness {
  const harness = createHarness();
  harness.g.DataManager.setupNewGame();
  return harness;
}
const setControl = (hh: Harness, extra: Record<string, unknown>) => {
  hh.fs.dirs.add("/game/www/rpg-viewer");
  hh.fs.writeFileSync(CONTROL_PATH, JSON.stringify({ v: 1, t: hh.clock.t, ...extra }));
  hh.clock.t += 1000;
  hh.bridge._tick();
};
const notices = (hh: Harness) => hh.readLog().filter((r) => r.type === "notice");

// ---- a tiny fake DOM (only what the bridge touches)
class El {
  nodeType = 1;
  parentNode: El | null = null;
  children: El[] = [];
  hidden = false;
  visibility = "visible";
  __rpgvNotice?: boolean;
  tagName: string;
  id: string;
  innerHTML: string;
  constructor(tagName: string, id = "", innerHTML = "") { this.tagName = tagName; this.id = id; this.innerHTML = innerHTML; }
  get lastElementChild(): El | null { return this.children.at(-1) ?? null; }
  get textContent() { return this.innerHTML.replace(/<[^>]*>/g, ""); }
  append(c: El) { c.parentNode = this; this.children.push(c); return c; }
  getClientRects() { return this.hidden ? [] : [{}]; }
}
class FakeObserver {
  static all: FakeObserver[] = [];
  target: El | null = null;
  connected = false;
  cb: (list: any[]) => void;
  constructor(cb: (list: any[]) => void) { this.cb = cb; FakeObserver.all.push(this); }
  observe(t: El) { this.target = t; this.connected = true; }
  disconnect() { this.connected = false; }
}
function installDom(hh: Harness) {
  FakeObserver.all = [];
  const body = new El("BODY");
  const byId = (n: El, id: string): El | null => {
    if (n.id === id) return n;
    for (const c of n.children) { const f = byId(c, id); if (f) return f; }
    return null;
  };
  hh.g.document = { body, getElementById: (id: string) => byId(body, id) };
  hh.g.MutationObserver = FakeObserver;
  hh.g.getComputedStyle = (el: El) => ({ visibility: el.visibility, display: "block" });
  const observer = () => FakeObserver.all.find((o) => o.connected) ?? null;
  /** appends and tells the observer (one batch) */
  const add = (...els: El[]) => {
    for (const e of els) if (!e.parentNode) body.append(e);
    observer()?.cb([{ type: "childList", addedNodes: els }]);
  };
  const change = (el: El, html: string) => {
    el.innerHTML = html;
    observer()?.cb([{ type: "characterData", target: { nodeType: 3, parentNode: el } }]);
  };
  const later = (ms: number) => { hh.clock.t += ms; hh.bridge._tick(); };
  return { body, add, change, later, observer };
}

/** AXY_Toast shape: $.toaster appends <div id="toastMessage"> into #toaster; msg is an expression it evaluates */
function defineToaster(hh: Harness, vars: Record<string, string> = {}) {
  const shown: string[] = [];
  const jq: any = function () {};
  jq.toaster = function (o: any) {
    const message = o.msg ? vars[o.msg] : o.message;
    if (message == null) return;
    shown.push(message);
    const doc = hh.g.document;
    if (!doc) return;
    let box = doc.getElementById("toaster");
    if (!box) box = doc.body.append(new El("DIV", "toaster"));
    box.append(new El("DIV", "toastMessage", `<span class="title"></span><span class="message">${message}</span>`));
  };
  jq.toaster.reset = () => "reset";
  hh.g.jQuery = jq;
  return shown;
}

describe("toasts, achievements and gain / quest context (1.19.0)", () => {
  it("records AXY_Toast toasts as plain text (message or evaluated msg), keeps $.toaster.reset", () => {
    h = newGame();
    const dom = installDom(h);
    const shown = defineToaster(h, { "$gameVariables.value(18)": "퀘스트 접수<br>「<span style=\"color:#FFFF00\">잃어버린 반지</span>」" });
    setControl(h, { captureNotices: true });
    h.g.jQuery.toaster({ message: "<span style=\"color:#00FF00\">포션</span> *<span style=\"color:white\">3</span> 획득" });
    h.g.jQuery.toaster({ msg: "$gameVariables.value(18)" });
    expect(h.g.jQuery.toaster.reset()).toBe("reset");
    expect(shown).toHaveLength(2);
    expect(notices(h)).toEqual([
      expect.objectContaining({ source: "toast", text: "포션 *3 획득" }),
      expect.objectContaining({ source: "toast", text: "퀘스트 접수 「잃어버린 반지」" }),
    ]);
    // the HTML watcher does not record the same toasts again
    const box = h.g.document.getElementById("toaster");
    dom.add(...box.children);
    dom.later(300);
    expect(notices(h)).toHaveLength(2);
  });

  it("without a DOM the message option is used; a msg-only toast is skipped", () => {
    h = newGame();
    defineToaster(h, { x: "숨은 글" });
    setControl(h, { captureNotices: true });
    h.g.jQuery.toaster({ message: "골드 &amp; 보석" });
    h.g.jQuery.toaster({ msg: "x" });
    expect(notices(h).map((r) => r.text)).toEqual(["골드 & 보석"]);
  });

  it("marks toasts shown inside gainItem / gainGold as gain and inside quest functions as quest", () => {
    h = newGame();
    defineToaster(h);
    function Game_System() {}
    Game_System.prototype.questAdd = function (id: number) { h.g.jQuery.toaster({ message: `퀘스트 ${id} 시작` }); };
    h.g.Game_System = Game_System;
    const P = h.g.Game_Party.prototype;
    const origGain = P.gainItem;
    P.gainItem = function (this: any, item: any, n: number, e: boolean) { origGain.call(this, item, n, e); h.g.jQuery.toaster({ message: `${item.name} ×${n}` }); };
    P.gainGold = function (n: number) { h.g.jQuery.toaster({ message: `${n} G` }); };
    setControl(h, { captureNotices: true });
    h.g.$gameParty.gainItem({ id: 1, name: "포션" }, 2, false);
    h.g.$gameParty.gainGold(50);
    new (h.g.Game_System)().questAdd(3);
    h.g.jQuery.toaster({ message: "그냥 알림" });
    const rs = notices(h);
    expect(rs.map((r) => [r.text, r.kind])).toEqual([["포션 ×2", "gain"], ["50 G", "gain"], ["퀘스트 3 시작", "quest"], ["그냥 알림", undefined]]);
  });

  it("records a Torigoya achievement unlock with its title and description", () => {
    h = newGame();
    const items: Record<number, any> = { 1: { id: 1, title: "\\c[1]첫 승리", description: "첫 전투에서 이기기" } };
    const popups: any[] = [];
    function Manager(this: any) { this._u = {}; }
    Manager.prototype.data = function (id: number) { return items[id] ?? null; };
    Manager.prototype.notify = function (this: any, id: number) { popups.push(this.data(id)); };
    Manager.prototype.unlock = function (this: any, id: number) { if (!this.data(id) || this._u[id]) return; this._u[id] = true; this.notify(id); };
    const manager = new (Manager as any)();
    h.g.Torigoya = { Achievement: { Manager: manager } };
    setControl(h, { captureNotices: true });
    manager.unlock(1);
    manager.unlock(1);
    manager.unlock(2);
    expect(popups).toHaveLength(1);
    expect(notices(h)).toEqual([expect.objectContaining({ source: "achievement", text: "업적: \\c[1]첫 승리 — 첫 전투에서 이기기" })]);
    expect(notices(h)[0].kind).toBeUndefined();
  });

  it("Torigoya Achievement2 (MZ): only a real new unlock is recorded", () => {
    h = newGame();
    const unlocked = new Set<string>();
    const manager = {
      data: (key: string) => (key === "a" ? { key: "a", title: "모험의 시작", description: "" } : null),
      isUnlocked: (key: string) => unlocked.has(key),
      unlock(key: string) { if (!this.data(key) || unlocked.has(key)) return false; unlocked.add(key); return true; },
    };
    h.g.Torigoya = { Achievement2: { manager } };
    setControl(h, { captureNotices: true });
    manager.unlock("a");
    manager.unlock("a");
    manager.unlock("zz");
    expect(notices(h).map((r) => r.text)).toEqual(["업적: 모험의 시작"]);
  });
});

describe("HTML overlay notices (1.19.0)", () => {
  it("records a new visible element with readable text once it settles; flag off disconnects", () => {
    h = newGame();
    const dom = installDom(h);
    setControl(h, { captureNotices: true });
    expect(dom.observer()?.target).toBe(dom.body);
    dom.add(new El("DIV", "BYNPStext7", "<p>문이 열렸다</p>"));
    expect(notices(h)).toEqual([]); // not settled yet
    dom.later(250);
    expect(notices(h)).toEqual([expect.objectContaining({ source: "html", text: "문이 열렸다" })]);
    h.bridge._snapshotNow();
    expect(h.readLive().assist.htmlNotices).toBe(true);
    setControl(h, { captureNotices: false });
    expect(dom.observer()).toBeNull();
  });

  it("waits for a hidden element to show (up to 2 s); skips canvas, digits-only text and the game's own boxes", () => {
    h = newGame();
    const dom = installDom(h);
    setControl(h, { captureNotices: true });
    const late = new El("DIV", "", "늦게 보이는 알림");
    late.visibility = "hidden";
    dom.add(late);
    dom.add(new El("CANVAS", "GameCanvas", "x"));
    dom.add(new El("DIV", "", "1234 / 99"));
    dom.add(new El("DIV", "fpsCounterBox", "FPS 60"));
    dom.later(250);
    expect(notices(h)).toEqual([]);
    late.visibility = "visible";
    dom.later(250);
    expect(notices(h).map((r) => r.text)).toEqual(["늦게 보이는 알림"]);
    const never = new El("DIV", "", "끝내 숨은 글");
    never.hidden = true;
    dom.add(never);
    dom.later(2500);
    never.hidden = false;
    dom.later(250);
    expect(notices(h)).toHaveLength(1);
  });

  it("ignores an element that changes more than twice a second, and panels of 4+ elements built at once", () => {
    h = newGame();
    const dom = installDom(h);
    setControl(h, { captureNotices: true });
    const hud = dom.body.append(new El("DIV", "BYNPStextDDS2", "<p>Day 1</p>"));
    dom.change(hud, "<p>Time 10</p>");
    h.clock.t += 100;
    dom.change(hud, "<p>Time 11</p>");
    h.clock.t += 100;
    dom.change(hud, "<p>Time 12</p>");
    dom.later(250);
    expect(notices(h)).toEqual([]);
    dom.add(new El("DIV", "DDS1", "날짜"), new El("DIV", "DDS2", "Day 3"), new El("DIV", "DDS3", "돈"), new El("DIV", "DDS4", "Gold 50"));
    dom.later(250);
    expect(notices(h)).toEqual([]);
    // a slow change of the same box after it went quiet is recorded
    dom.later(4000);
    dom.change(hud, "<p>새 의뢰가 도착했다</p>");
    dom.later(250);
    expect(notices(h).map((r) => r.text)).toEqual(["새 의뢰가 도착했다"]);
  });

  it("dedupes the same text within 2 s, the same element text within 5 min, and caps 10 per second", () => {
    h = newGame();
    const dom = installDom(h);
    setControl(h, { captureNotices: true });
    dom.add(new El("SPAN", "", "보물 상자 발견"));
    dom.later(200);
    dom.add(new El("SPAN", "", "보물 상자 발견"));
    dom.later(200);
    expect(notices(h)).toHaveLength(1);
    dom.later(2500);
    dom.add(new El("SPAN", "", "보물 상자 발견"));
    dom.later(200);
    expect(notices(h)).toHaveLength(2);
    // the same id with the same text (an overlay rebuilt) once per 5 minutes
    dom.add(new El("DIV", "label", "마을 광장"));
    dom.later(200);
    dom.later(3000);
    dom.add(new El("DIV", "label", "마을 광장"));
    dom.later(200);
    expect(notices(h)).toHaveLength(3);
    dom.later(3000);
    for (let i = 0; i < 15; i++) dom.add(new El("SPAN", "", `알림 ${i}`)); // one per batch
    dom.later(200);
    expect(notices(h)).toHaveLength(3 + 10);
  });

  it("the helper works with an injected observer and visibility check", () => {
    h = newGame();
    const body = new El("BODY");
    let cb: ((l: any[]) => void) | null = null;
    const got: string[] = [];
    let t = 0;
    const w = h.bridge._createHtmlWatch({
      body, now: () => t, isVisible: () => true, record: (s: string) => got.push(s),
      observe: (f: any) => { cb = f; return () => { cb = null; }; },
    });
    w.start();
    const el = body.append(new El("DIV", "", "레벨 업!"));
    cb!([{ type: "childList", addedNodes: [el] }]);
    t = 200;
    w.check();
    w.stop();
    expect(cb).toBeNull();
    expect(got).toEqual(["레벨 업!"]);
  });
});
