import { beforeAll, describe, expect, it } from "vitest";
import { loadGame } from "../loader/loadGame";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import type { EventCommand, GameData, ScriptNode } from "../types";
import { interpret } from "../interpret/interpret";
import { buildIndex } from "../index/buildIndex";
import { inlineQuestionStart } from "../live/remaining";
import { readerItems } from "../live/reader";
import { buildHistory } from "../live/history";
import { aftermathStep, newAftermath } from "../live/coverage";
import type { HistoryItem, LogRecord } from "../live/types";
import { advTalkNameLineFromPlugins, messageParts, splitAdvNameLine } from "./advTalk";

let base: GameData;
let adv: GameData;
beforeAll(async () => {
  const r = await loadGame(loadFixtureFolder("sample-mv"));
  if (!r.ok) throw new Error("load failed");
  base = r.data;
  adv = { ...base, advTalkNameLine: true };
});

const cmd = (code: number, indent: number, parameters: unknown[]): EventCommand => ({ code, indent, parameters });
type Msg = Extract<ScriptNode, { kind: "message" }>;
const plugins = (list: unknown[]) => `var $plugins =\n${JSON.stringify(list)};\n`;

describe("advTalkNameLineFromPlugins", () => {
  it("is true only when ADVTalkSystem is enabled", () => {
    expect(advTalkNameLineFromPlugins(plugins([{ name: "ADVTalkSystem", status: true, parameters: {} }]))).toBe(true);
    expect(advTalkNameLineFromPlugins(plugins([{ name: "ADVTalkSystem", status: false, parameters: {} }]))).toBe(false);
    expect(advTalkNameLineFromPlugins(plugins([{ name: "Other", status: true, parameters: {} }]))).toBe(false);
    expect(advTalkNameLineFromPlugins(null)).toBe(false);
    expect(advTalkNameLineFromPlugins("garbage")).toBe(false);
  });
});

describe("splitAdvNameLine / messageParts", () => {
  it("splits 2+ lines; one line or a name-box code is left alone", () => {
    expect(splitAdvNameLine(["가", "안녕", "잘 가"])).toEqual({ name: "가", rest: ["안녕", "잘 가"] });
    expect(splitAdvNameLine(["안녕"])).toBeNull();
    expect(splitAdvNameLine([String.raw`\n<가>안녕`, "둘째"])).toBeNull();
    expect(splitAdvNameLine(null as unknown as unknown[])).toBeNull();
  });
  it("moves the first recorded line to the speaker only when the game uses it and no speaker is recorded", () => {
    expect(messageParts("", "가\n안녕", adv)).toEqual({ speaker: "가", text: "안녕" });
    expect(messageParts("", "가\n안녕", base)).toEqual({ speaker: "", text: "가\n안녕" });
    expect(messageParts("촌장", "가\n안녕", adv)).toEqual({ speaker: "촌장", text: "가\n안녕" });
    expect(messageParts("", "안녕", adv)).toEqual({ speaker: "", text: "안녕" });
    expect(messageParts(undefined, undefined, null)).toEqual({ speaker: "", text: "" });
  });
});

describe("interpret with ADVTalkSystem name lines", () => {
  const msg = (lines: string[], face = "", name?: string) =>
    [cmd(101, 0, name === undefined ? [face, 0, 0, 2] : [face, 0, 0, 2, name]), ...lines.map(l => cmd(401, 0, [l]))];

  it("takes the first of 2+ lines as the formatted speaker", () => {
    const n = interpret(msg([String.raw`\N[1]`, "안녕", "잘 가"]), adv)[0] as Msg;
    expect(n).toEqual({ kind: "message", cmd: 0, speaker: base.actors[1]?.name, lines: ["안녕", "잘 가"], nameLine: true });
  });
  it("leaves one-line messages and games without the plugin alone", () => {
    expect(interpret(msg(["안녕"]), adv)[0]).toEqual({ kind: "message", cmd: 0, lines: ["안녕"] });
    expect(interpret(msg(["가", "안녕"]), base)[0]).toEqual({ kind: "message", cmd: 0, lines: ["가", "안녕"] });
  });
  it("a name-box code or an MZ speaker still wins", () => {
    expect(interpret(msg([String.raw`\n<하롤드>안녕`, "둘째"]), adv)[0]).toEqual({ kind: "message", cmd: 0, speaker: "하롤드", lines: ["안녕", "둘째"] });
    const mz: GameData = { ...adv, engine: "MZ" };
    expect(interpret(msg(["가", "안녕"], "", "촌장"), mz)[0]).toEqual({ kind: "message", cmd: 0, speaker: "촌장", lines: ["가", "안녕"] });
  });
  it("an empty name line is dropped like the plugin does", () => {
    expect(interpret(msg(["", "안녕"]), adv)[0]).toEqual({ kind: "message", cmd: 0, lines: ["안녕"], nameLine: true });
  });
  it("keeps the following command in place and the inline question detection", () => {
    const nodes = interpret([...msg(["가", "질문?"]), cmd(102, 0, [["네", "아니"], 1]), cmd(402, 0, [0, "네"]), cmd(0, 1, []),
      cmd(402, 0, [1, "아니"]), cmd(0, 1, []), cmd(404, 0, [])], adv);
    expect(nodes.map(n => n.kind)).toEqual(["message", "choices"]);
    expect((nodes[1] as { cmd: number }).cmd).toBe(3);
    expect(inlineQuestionStart(nodes, 1)).toBe(0);
  });
  it("search index sees the name as the speaker, not as a text line", () => {
    const map = base.maps.get(1)!;
    const ev = { id: 1, name: "EV001", note: "", x: 0, y: 0, pages: [{ ...map.events[1]!.pages[0], list: [...msg(["가나다", "본문 줄"]), cmd(0, 0, [])] }] };
    const idx = buildIndex({ ...adv, maps: new Map([[1, { ...map, events: [null, ev] }]]) });
    const hit = idx.search("가나다")[0];
    expect(hit?.entry.nodes[0]).toMatchObject({ kind: "message", speaker: "가나다", lines: ["본문 줄"] });
    expect(hit?.entry.title).toContain(`가나다 — "본문 줄"`);
  });
});

describe("live reader with ADVTalkSystem name lines", () => {
  const rec = { v: 1, run: 1, branch: 1, t: 0 } as const;
  const message = (text: string, speaker = ""): LogRecord =>
    ({ ...rec, seq: 1, type: "message", src: null, cmd: 0, face: "", faceIndex: 0, speaker, text }) as LogRecord;
  const item = (record: LogRecord): HistoryItem => ({ kind: "record", uncertain: false, changed: false, record });
  const read = (r: LogRecord, d: GameData) => readerItems([item(r)], d, new Map(), buildHistory([r]))[0];

  it("shows the first recorded line as the speaker and keeps it out of the text", () => {
    expect(read(message("\\C[2]가\\C[0]\n안녕\n잘 가"), adv)).toMatchObject({
      kind: "message", speaker: "가", rawSpeaker: "\\C[2]가\\C[0]", lines: ["안녕", "잘 가"], rawText: "안녕\n잘 가",
    });
  });
  it("one-line messages, recorded speakers and other games are unchanged", () => {
    expect(read(message("안녕"), adv)).toMatchObject({ speaker: "", lines: ["안녕"] });
    expect(read(message("가\n안녕", "촌장"), adv)).toMatchObject({ speaker: "촌장", lines: ["가", "안녕"] });
    expect(read(message("가\n안녕"), base)).toMatchObject({ speaker: "", lines: ["가", "안녕"] });
  });
  it("choice aftermath uses the same speaker", () => {
    const st = newAftermath();
    aftermathStep(st, message("가\n안녕"), adv);
    expect(st.out).toEqual([`가: "안녕"`]);
  });
});
