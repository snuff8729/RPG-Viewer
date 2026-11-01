import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";

// 1.30.0: WinGetInfo acquisition popups (Game_Screen.prototype._showGetInfo) recorded as gain notices
let h: Harness;
afterEach(() => {
  h?.bridge?._flushNow();
  delete (globalThis as any).TextManager;
});

const CONTROL_PATH = "/game/www/rpg-viewer/control.json";
const setControl = (hh: Harness, extra: Record<string, unknown>) => {
  hh.fs.dirs.add("/game/www/rpg-viewer");
  hh.fs.writeFileSync(CONTROL_PATH, JSON.stringify({ v: 1, t: hh.clock.t, ...extra }));
  hh.clock.t += 1000;
  hh.bridge._tick();
};
const notices = (hh: Harness) => hh.readLog().filter((r) => r.type === "notice");

/** WinGetInfo shape: pushes a window onto this._infoWindow unless the disable switch is on */
function defineGetInfo(hh: Harness) {
  const state = { disabled: false, shown: 0 };
  hh.g.TextManager = { currencyUnit: "G" };
  hh.g.Game_Screen.prototype._showGetInfo = function (this: any, _item: unknown, _amount: number, _isAll: boolean) {
    if (state.disabled) return;
    this._infoWindow = this._infoWindow || [];
    this._infoWindow.push({ disposed: false });
    state.shown++;
  };
  return state;
}

describe("WinGetInfo acquisition notices (1.30.0)", () => {
  it("records item, money and variable popups as gain notices with their text", () => {
    h = createHarness();
    h.g.DataManager.setupNewGame();
    const st = defineGetInfo(h);
    setControl(h, { captureNotices: true });
    const screen = h.g.$gameScreen;
    screen._showGetInfo({ name: "포션", iconIndex: 176 }, 3, true);
    screen._showGetInfo({ type: "money" }, 500, false);
    screen._showGetInfo({ type: "variable", name: "호감도" }, 2, true);
    screen._showGetInfo({ type: "variable", name: "호감도" }, -1, true);
    expect(st.shown).toBe(4);
    expect(notices(h).map((r) => [r.source, r.raw, r.kind])).toEqual([
      ["getinfo", "\\I[176]포션 x3", "gain"],
      ["getinfo", "500G", "gain"],
      ["getinfo", "호감도 +2", "gain"],
      ["getinfo", "호감도 -1", "gain"],
    ]);
  });

  it("records nothing when the popup is disabled, when notices are off, or for a nameless item", () => {
    h = createHarness();
    h.g.DataManager.setupNewGame();
    const st = defineGetInfo(h);
    setControl(h, { captureNotices: true });
    st.disabled = true;
    h.g.$gameScreen._showGetInfo({ name: "포션", iconIndex: 1 }, 1, true);
    st.disabled = false;
    h.g.$gameScreen._showGetInfo({ name: "", iconIndex: 1 }, 1, true);
    setControl(h, { captureNotices: false });
    h.g.$gameScreen._showGetInfo({ name: "포션", iconIndex: 1 }, 1, true);
    expect(st.shown).toBe(2);
    expect(notices(h)).toEqual([]);
  });
});
