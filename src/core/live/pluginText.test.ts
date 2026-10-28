import { describe, expect, it } from "vitest";
import { classifyPluginRecord, looksLikeText, pluginKey, pluginRecOfCommand } from "./pluginText";

const mv = (text: string) => ({ code: 356, text });

describe("classifyPluginRecord", () => {
  it.each([
    ["TMng Search 종이 상자.", "종이 상자."],
    ["TMng Search 아버지의 책장이다. ……야한 책 같은 건 없는 것 같다.", "아버지의 책장이다. ……야한 책 같은 건 없는 것 같다."],
    ["TMng Search 역시 피곤하다. 외출은 하지 말자.", "역시 피곤하다. 외출은 하지 말자."],
    ["Popup 1 낡은 우산이 놓여 있다", "낡은 우산이 놓여 있다"],
    ["ShowInfo 机の上にメモがある。", "机の上にメモがある。"],
    ["Notify 何かが落ちている音がした", "何かが落ちている音がした"],
    ["AddLog Picked up an old key.", "Picked up an old key."],
    // 이름이 기술 명령처럼 보여도 내용이 문장이면 글
    ["PlaySEId 문이 삐걱 열렸다.", "문이 삐걱 열렸다."],
  ])("text: %s", (raw, text) => {
    expect(classifyPluginRecord(mv(raw))).toEqual({ kind: "text", text });
  });

  it.each([
    "FaceId 1 11", "PlaySEId Bath", "PlaySEId Openwood", "setBattleSys DTB",
    "CallCommon [共通]主人公パラメータチェック", "CallCommon イベ条件変数リセット", "EraseMapLight -1", "PSS stop",
    "TE固有イベント呼び出し", "ControlSelfVariable 1 0 5", "SetVar 10 3", "Tone 0 0 0", "Wait 30",
    "TE_CALL_MAP_EVENT 1 상인", "TEマップイベント呼び出し 1 1", "ShowPicture 1 face 0 0", "PlayBgm Town1.ogg 90",
    "SetFlag 主人公フラグ", "Foo bar baz", "", "   ", "MapName 마을",
  ])("tech: %s", raw => {
    expect(classifyPluginRecord(mv(raw))).toEqual({ kind: "tech" });
  });

  it("uses name/args from bridge 1.5.0 records", () => {
    expect(classifyPluginRecord({ code: 356, text: "TMng Search 종이 상자.", name: "TMng", args: ["Search", "종이", "상자."] }))
      .toEqual({ kind: "text", text: "종이 상자." });
    expect(classifyPluginRecord({ code: 356, text: "PlaySEId Bath", name: "PlaySEId", args: ["Bath"] })).toEqual({ kind: "tech" });
  });

  it("MZ: finds sentence-like string args (also inside struct JSON)", () => {
    expect(classifyPluginRecord({ code: 357, plugin: "TextPlugin", name: "show", args: { text: "책상 위에 쪽지가 있다.", id: "3" } }))
      .toEqual({ kind: "text", text: "책상 위에 쪽지가 있다." });
    expect(classifyPluginRecord({ code: 357, plugin: "P", name: "popup", args: { data: JSON.stringify({ message: "扉には鍵がかかっている。" }) } }))
      .toEqual({ kind: "text", text: "扉には鍵がかかっている。" });
    expect(classifyPluginRecord({ code: 357, plugin: "SoundPlugin", name: "playSe", args: { name: "Bath", volume: "90" } }))
      .toEqual({ kind: "tech" });
    expect(classifyPluginRecord({ code: 357, plugin: "TemplateEvent", name: "CALL_ORIGIN_EVENT", args: { pageIndex: "2" } }))
      .toEqual({ kind: "tech" });
    // 구버전 357 기록(text만)
    expect(classifyPluginRecord({ code: 357, text: "TextPlugin show A note on the desk." })).toEqual({ kind: "text", text: "A note on the desk." });
    expect(classifyPluginRecord({ code: 357, text: "P c" })).toEqual({ kind: "tech" });
  });

  it("override wins over the classifier", () => {
    expect(classifyPluginRecord(mv("TMng Search 종이 상자."), { TMng: "hide" })).toEqual({ kind: "tech" });
    expect(classifyPluginRecord(mv("PlaySEId Bath"), { PlaySEId: "show" })).toEqual({ kind: "text", text: "Bath" });
    expect(classifyPluginRecord(mv("TE固有イベント呼び出し"), { "TE固有イベント呼び出し": "show" }))
      .toEqual({ kind: "text", text: "TE固有イベント呼び出し" });
    // 다른 명령의 설정은 상관없다
    expect(classifyPluginRecord(mv("PlaySEId Bath"), { TMng: "show" })).toEqual({ kind: "tech" });
    // MZ는 플러그인/명령 키
    const mz = { code: 357, plugin: "TextPlugin", name: "show", args: { text: "책상 위에 쪽지가 있다." } };
    expect(classifyPluginRecord(mz, { "TextPlugin/show": "hide" })).toEqual({ kind: "tech" });
    expect(classifyPluginRecord(mz, { show: "hide" })).toEqual({ kind: "text", text: "책상 위에 쪽지가 있다." });
  });

  it("never throws on junk", () => {
    expect(classifyPluginRecord(null as never)).toEqual({ kind: "tech" });
    expect(classifyPluginRecord({ code: 357, args: "x" })).toEqual({ kind: "tech" });
    expect(classifyPluginRecord({ code: 356, name: 3, args: [null, 5] })).toEqual({ kind: "tech" });
  });
});

describe("pluginKey / pluginRecOfCommand / looksLikeText", () => {
  it("keys and command conversion", () => {
    expect(pluginKey(mv("TMng Search 종이 상자."))).toBe("TMng");
    expect(pluginKey({ code: 357, plugin: "P", name: "c" })).toBe("P/c");
    expect(pluginKey({ code: 357, text: "P c x" })).toBe("P/c");
    expect(pluginRecOfCommand({ code: 101, parameters: [] })).toBeNull();
    expect(classifyPluginRecord(pluginRecOfCommand({ code: 356, parameters: ["TMng Search 종이 상자."] })!))
      .toEqual({ kind: "text", text: "종이 상자." });
    expect(classifyPluginRecord(pluginRecOfCommand({ code: 357, parameters: ["P", "c", "desc", { msg: "열쇠를 얻었다!" }] })!))
      .toEqual({ kind: "text", text: "열쇠를 얻었다!" });
  });

  it("looksLikeText edge cases", () => {
    expect(looksLikeText("\\C[2]종이\\C[0] 상자")).toBe(true);
    expect(looksLikeText("主人公の部屋の鏡台")).toBe(true);
    expect(looksLikeText("主人公の部屋の鏡台", true)).toBe(false);
    expect(looksLikeText("[共通]主人公パラメータチェック")).toBe(false);
    expect(looksLikeText("立ち絵_主人公01.png")).toBe(false);
    expect(looksLikeText("123 456")).toBe(false);
    expect(looksLikeText('{"a":"b"}')).toBe(false);
  });
});
