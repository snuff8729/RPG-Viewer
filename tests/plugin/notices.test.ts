import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";

let h: Harness;
const GLOBALS = ["TickerManager", "LiveCommentContainer", "Window_Base", "MyNotice"];
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

/** Ticker plugin shape: a global manager defined by a plugin loaded after the bridge */
function defineTicker(hh: Harness) {
  const shown: string[] = [];
  hh.g.TickerManager = { show(text: string, _needPlus = true) { shown.push(text); } };
  return shown;
}
function defineLiveComment(hh: Harness) {
  const shown: string[] = [];
  function LiveCommentContainer(this: any) {}
  LiveCommentContainer.prototype.show = function (text: string, _bg?: string) { shown.push(text); };
  hh.g.LiveCommentContainer = LiveCommentContainer;
  return shown;
}
/** Window_Base.convertEscapeCharacters like rmmz_windows.js (subset) */
function defineWindowBase(hh: Harness) {
  function Window_Base(this: any) { throw new Error("must not be constructed"); }
  Window_Base.prototype.actorName = function (n: number) { return ["", "리드", "엘"][n] ?? ""; };
  Window_Base.prototype.convertEscapeCharacters = function (this: any, text: string) {
    text = text.replace(/\\/g, "\x1b");
    text = text.replace(/\x1b\x1b/g, "\\");
    text = text.replace(/\x1bV\[(\d+)\]/gi, (_m, p1) => String(hh.g.$gameVariables.value(Number(p1))));
    text = text.replace(/\x1bN\[(\d+)\]/gi, (_m, p1) => this.actorName(Number(p1)));
    return text;
  };
  hh.g.Window_Base = Window_Base;
}

describe("notices (1.9.0)", () => {
  it("flag off: nothing is wrapped or recorded", () => {
    h = newGame();
    const shown = defineTicker(h);
    const fn = h.g.TickerManager.show;
    setControl(h, {});
    new h.g.Scene_Map().start();
    h.g.TickerManager.show("hello");
    expect(h.g.TickerManager.show).toBe(fn);
    expect(shown).toEqual(["hello"]);
    expect(notices(h)).toEqual([]);
    expect(h.readLive()?.assist?.captureNotices ?? false).toBe(false);
  });

  it("globals defined after install are wrapped on scene start, once, and recorded on map and in battle", () => {
    h = newGame();
    setControl(h, { captureNotices: true });
    const ticker = defineTicker(h);
    const comments = defineLiveComment(h);
    h.g.TickerManager.show("before scene start");
    expect(notices(h)).toEqual([]);
    new h.g.Scene_Map().start();
    const wrapped = h.g.TickerManager.show;
    new h.g.Scene_Map().start();
    expect(h.g.TickerManager.show).toBe(wrapped); // wrapped once
    h.g.TickerManager.show("\\i[906]\\c[4]장비 내구도 감소");
    new h.g.LiveCommentContainer().show("ㅋㅋㅋ", "#000");
    h.clock.t += 1000;
    h.g.$gameParty._inBattle = true;
    new h.g.Scene_Battle().start();
    h.g.TickerManager.show("전투 중 대사");
    expect(ticker).toEqual(["before scene start", "\\i[906]\\c[4]장비 내구도 감소", "전투 중 대사"]);
    expect(comments).toEqual(["ㅋㅋㅋ"]);
    expect(notices(h)).toEqual([
      expect.objectContaining({ type: "notice", source: "ticker", text: "\\i[906]\\c[4]장비 내구도 감소", raw: "\\i[906]\\c[4]장비 내구도 감소" }),
      expect.objectContaining({ type: "notice", source: "livecomment", text: "ㅋㅋㅋ" }),
      expect.objectContaining({ type: "notice", source: "ticker", text: "전투 중 대사" }),
    ]);
    h.bridge._snapshotNow();
    expect(h.readLive().assist).toMatchObject({ captureNotices: true, notices: ["TickerManager.show", "LiveCommentContainer.prototype.show"] });
  });

  it("expands \\n[] and \\v[] with Window_Base.convertEscapeCharacters and keeps the other codes", () => {
    h = newGame();
    defineWindowBase(h);
    defineTicker(h);
    h.g.$gameVariables.setValue(5, 42);
    setControl(h, { captureNotices: true });
    h.g.TickerManager.show("\\i[906]\\c[4]\\n[1] : 남은 횟수 \\v[5]");
    expect(notices(h)).toEqual([
      expect.objectContaining({ text: "\\i[906]\\c[4]리드 : 남은 횟수 42", raw: "\\i[906]\\c[4]\\n[1] : 남은 횟수 \\v[5]" }),
    ]);
  });

  it("dedupes identical text within 300 ms and caps 30 per second", () => {
    h = newGame();
    defineTicker(h);
    setControl(h, { captureNotices: true });
    const T = h.g.TickerManager;
    T.show("same"); h.clock.t += 100;
    T.show("same"); h.clock.t += 100;
    T.show("same"); // still within 300 ms of the previous call
    h.clock.t += 400;
    T.show("same");
    expect(notices(h).map((r) => r.text)).toEqual(["same", "same"]);
    h.clock.t += 2000;
    for (let i = 0; i < 50; i++) T.show(`line ${i}`);
    expect(notices(h)).toHaveLength(2 + 30);
    h.clock.t += 1000;
    T.show("after a second");
    expect(notices(h).at(-1)).toMatchObject({ text: "after a second" });
  });

  it("extra hook paths from control.json: validated, wrapped only when they resolve to functions", () => {
    h = newGame();
    const seen: unknown[] = [];
    h.g.MyNotice = { popup: (a: unknown) => { seen.push(a); }, notAFunction: 3 };
    setControl(h, { captureNotices: true, noticeHooks: ["MyNotice.popup", "MyNotice.notAFunction", "bad path!", "__proto__.x", "Missing.fn", 7] });
    h.g.MyNotice.popup("직접 추가한 알림");
    h.g.MyNotice.popup({ message: "객체 알림" });
    h.g.MyNotice.popup(12);
    expect(seen).toHaveLength(3);
    expect(notices(h)).toEqual([
      expect.objectContaining({ source: "MyNotice.popup", text: "직접 추가한 알림" }),
      expect.objectContaining({ source: "MyNotice.popup", text: "객체 알림" }),
    ]);
    expect(h.g.MyNotice.notAFunction).toBe(3);
  });

  it("turning the flag off stops recording (wrappers stay inert)", () => {
    h = newGame();
    defineTicker(h);
    setControl(h, { captureNotices: true });
    h.g.TickerManager.show("on");
    setControl(h, { captureNotices: false });
    h.g.TickerManager.show("off");
    expect(notices(h).map((r) => r.text)).toEqual(["on"]);
  });

  it("a throwing convertEscapeCharacters falls back to the raw text; the game call still runs", () => {
    h = newGame();
    function Window_Base() {}
    Window_Base.prototype.convertEscapeCharacters = () => { throw new Error("needs contents"); };
    h.g.Window_Base = Window_Base;
    const shown = defineTicker(h);
    setControl(h, { captureNotices: true });
    h.g.TickerManager.show("\\n[1] 안녕");
    expect(shown).toEqual(["\\n[1] 안녕"]);
    expect(notices(h)).toEqual([expect.objectContaining({ text: "\\n[1] 안녕", raw: "\\n[1] 안녕" })]);
  });
});
