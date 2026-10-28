import { describe, expect, it } from "vitest";
import { cleanNoticeHooks, isNoticeHookPath, NOTICE_HOOKS_MAX, noticePluginsOf, noticeSourceLabel } from "./notices";
import { addonControlFlags, ADDONS } from "./registry";
import { addonsJson, parseAddonFile } from "./settings";

const pluginsJs = (entries: object[]) => `var $plugins =\n${JSON.stringify(entries)};\n`;

describe("notices add-on", () => {
  it("is registered off by default and sends captureNotices (+ extra hooks) only when on", () => {
    const a = ADDONS.find(x => x.id === "notices")!;
    expect(a.label).toBe("알림 문구 기록");
    expect(a.hint).toBe("이 게임에서 쓸 수 있어요");
    expect(addonControlFlags({})).toEqual({});
    expect(addonControlFlags({ notices: true })).toEqual({ captureNotices: true });
    expect(addonControlFlags({ notices: true }, { noticeHooks: ["My.fn", "bad path"] })).toEqual({ captureNotices: true, noticeHooks: ["My.fn"] });
    expect(addonControlFlags({ notices: false }, { noticeHooks: ["My.fn"] })).toEqual({});
    expect(addonControlFlags({ screenPictures: true, notices: true })).toEqual({ capturePictures: true, captureNotices: true });
  });

  it("validates hook paths", () => {
    for (const ok of ["TickerManager.show", "LiveCommentContainer.prototype.show", "$gameSystem.pushInfo", "_a.b_c.$d", "solo"]) {
      expect(isNoticeHookPath(ok)).toBe(true);
    }
    for (const bad of ["", "a..b", ".a", "a.", "a.b()", "a b", "1a.b", "a.__proto__.b", "a[0]", 3, null, "a".repeat(201)]) {
      expect(isNoticeHookPath(bad)).toBe(false);
    }
    expect(cleanNoticeHooks([" My.fn ", "My.fn", "x y", 5, "Other.fn"])).toEqual(["My.fn", "Other.fn"]);
    expect(cleanNoticeHooks(Array.from({ length: 30 }, (_, i) => `A.f${i}`))).toHaveLength(NOTICE_HOOKS_MAX);
    expect(cleanNoticeHooks("My.fn")).toEqual([]);
  });

  it("saves extra hooks per game in addons.json (only valid ones)", () => {
    const body = addonsJson({ notices: true }, null, ["My.fn", "bad!"]);
    expect(JSON.parse(body)).toEqual({ v: 1, enabled: { screenPictures: false, notices: true }, noticeHooks: ["My.fn"] });
    expect(parseAddonFile(body)).toEqual({ state: { screenPictures: false, notices: true }, pictureRoles: {}, noticeHooks: ["My.fn"] });
    expect(parseAddonFile(JSON.stringify({ v: 1, enabled: {}, noticeHooks: ["x y", 1] }))).not.toHaveProperty("noticeHooks");
    expect(JSON.parse(addonsJson({}, null, []))).not.toHaveProperty("noticeHooks");
  });

  it("finds enabled plugins known to show notices in plugins.js", () => {
    const text = pluginsJs([
      { name: "Ticker", status: true, description: "ティッカープラグイン", parameters: {} },
      { name: "TickerSystem", status: true, description: "", parameters: {} },
      { name: "LiveComment", status: false, description: "", parameters: {} },
      { name: "Other", status: true, description: "", parameters: {} },
    ]);
    expect(noticePluginsOf(text)).toEqual(["Ticker", "TickerSystem"]);
    expect(noticePluginsOf(pluginsJs([{ name: "livecomment", status: true, description: "", parameters: {} }]))).toEqual(["LiveComment"]);
    expect(noticePluginsOf(null)).toEqual([]);
    expect(noticePluginsOf("garbage")).toEqual([]);
  });

  it("labels sources", () => {
    expect(noticeSourceLabel("ticker")).toBe("티커");
    expect(noticeSourceLabel("livecomment")).toBe("코멘트");
    expect(noticeSourceLabel("My.fn")).toBe("My.fn");
    expect(noticeSourceLabel(undefined)).toBe("알림");
  });
});
