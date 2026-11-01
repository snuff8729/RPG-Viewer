import { describe, expect, it } from "vitest";
import { classifyNotice, cleanNoticeHooks, isMoneyOrExp, isNoticeHidden, isNoticeHookPath, NOTICE_HOOKS_MAX, noticePluginsOf, noticeRecordKind, noticeSourceLabel } from "./notices";
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

  it("WinGetInfo popups: known plugin, labelled and always a gain", () => {
    expect(noticePluginsOf(pluginsJs([{ name: "WinGetInfo", status: true, description: "", parameters: {} }]))).toEqual(["WinGetInfo"]);
    expect(noticeSourceLabel("getinfo")).toBe("획득 알림");
    expect(classifyNotice("getinfo", "\\I[5]무언가 x1")).toBe("gain");
  });

  it("labels sources", () => {
    expect(noticeSourceLabel("ticker")).toBe("티커");
    expect(noticeSourceLabel("livecomment")).toBe("코멘트");
    expect(noticeSourceLabel("My.fn")).toBe("My.fn");
    expect(noticeSourceLabel(undefined)).toBe("알림");
    expect(noticeSourceLabel("toast")).toBe("토스트 알림");
    expect(noticeSourceLabel("achievement")).toBe("업적");
    expect(noticeSourceLabel("html")).toBe("화면 위 글(HTML)");
  });

  it("knows AXY_Toast and Torigoya_Achievement (1.19.0)", () => {
    const text = pluginsJs([
      { name: "AXY_Toast", status: true, description: "", parameters: {} },
      { name: "Torigoya_Achievement", status: true, description: "", parameters: {} },
    ]);
    expect(noticePluginsOf(text)).toEqual(["AXY_Toast", "Torigoya_Achievement"]);
  });

  it("classifies notices: record kind, then source, then text", () => {
    expect(classifyNotice("toast", "아무 글", "gain")).toBe("gain");
    expect(classifyNotice("toast", "아무 글", "quest")).toBe("quest");
    expect(classifyNotice("achievement", "아무 글")).toBe("achievement");
    for (const t of ["업적 달성!", "実績解除", "Achievement unlocked", "成就达成"]) expect(classifyNotice("html", t)).toBe("achievement");
    for (const t of ["퀘스트 완료", "クエスト受注", "New quest", "任务完成"]) expect(classifyNotice("toast", t)).toBe("quest");
    for (const t of ["120 EXP", "경험치 +30", "経験値 50", "50 G", "골드 100", "ゴールド", "포션 획득", "薬草を入手", "Obtained a potion", "레벨 업!"]) {
      expect(classifyNotice("toast", t)).toBe("gain");
    }
    for (const t of ["문이 열렸다", "Good morning", ""]) expect(classifyNotice("ticker", t)).toBe("info");
    expect(classifyNotice(undefined, null, "bogus")).toBe("info");
    expect(isMoneyOrExp("120 EXP")).toBe(true);
    expect(isMoneyOrExp("포션 획득")).toBe(false);
    expect(noticeRecordKind({ source: "toast", raw: "퀘스트 시작" })).toBe("quest");
    expect(noticeRecordKind(null)).toBe("info");
    expect(isNoticeHidden({ source: "achievement" }, new Set(["achievement" as const]))).toBe(true);
    expect(isNoticeHidden({ source: "achievement" }, new Set(["gain" as const]))).toBe(false);
    expect(isNoticeHidden({ source: "x" }, true)).toBe(true);
    expect(isNoticeHidden({ source: "x" }, false)).toBe(false);
  });
});
