import { beforeAll, describe, expect, it } from "vitest";
import { fixtureRecords } from "../../../tests/helpers/fixtureLog";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { choiceTexts } from "../../ui/live/historyText";
import { loadGame } from "../loader/loadGame";
import type { GameData } from "../types";
import { branchPath, buildHistory, foldTimeline } from "./history";
import { lastSeqOf, readerItems } from "./reader";
import type { HistoryItem, LogRecord } from "./types";

let data: GameData;
beforeAll(async () => {
  const r = await loadGame(loadFixtureFolder("sample-mz"));
  if (!r.ok) throw new Error("load failed");
  data = r.data;
});

const records = fixtureRecords();
const model = buildHistory(records);
const build = (branch: number) => {
  const path = branchPath(records, model, branch);
  return readerItems(foldTimeline(path, model, {}), data, choiceTexts(path, data), model);
};
const rec = { v: 1, run: 1, branch: 1, t: 0 } as const;
const item = (record: LogRecord): HistoryItem => ({ kind: "record", uncertain: false, changed: false, record });

describe("readerItems", () => {
  it("shows no branch-start chapter for a save-load continuation", () => {
    const recs = [
      { ...rec, seq: 1, type: "branchStart", reason: "newGame", parentBranch: null, fromSeq: null },
      { ...rec, seq: 2, type: "save", slot: 1 },
      { ...rec, seq: 3, branch: 2, type: "branchStart", reason: "load", parentBranch: 1, fromSeq: 2 },
      { ...rec, seq: 4, branch: 2, type: "load", slot: 1 },
    ] as LogRecord[];
    const m = buildHistory(recs);
    const out = readerItems(foldTimeline(branchPath(recs, m, 1), m, {}), data, new Map(), m);
    expect(out).toEqual([{ kind: "chapter", key: "c1", text: "— 1회차 갈래 1 시작 —" }]);
  });

  it("builds the novel-style flow for branch 1", () => {
    const items = build(1);
    expect(items.map(i => i.kind)).toEqual([
      "chapter", "message", "message", "message", "picture", "message", "choice", "message", "message", "message", "chapter",
    ]);
    expect(items[0]).toMatchObject({ kind: "chapter", text: "— 1회차 갈래 1 시작 —" });
    expect(items[1]).toMatchObject({ kind: "message", key: "r2", speaker: "촌장", face: "People1", faceIndex: 3 });
    expect(items[2]).toMatchObject({ speaker: "레나" });
    expect(items[3]).toMatchObject({ speaker: "" });
    expect(items[4]).toMatchObject({ kind: "picture", name: "village_map" });
    expect(items[6]).toMatchObject({ kind: "choice", label: "네, 도울게요", key: "r9" });
    expect(items[9]).toMatchObject({ seq: 13, repeat: 2 });
    expect(items[10]).toMatchObject({ kind: "chapter", text: "— 숲 입구 —" });
    expect(items.some(i => (i.kind as string) === "state")).toBe(false);
  });

  it("shows plugin commands in order as plain rows and keeps repeat folding of the same talk", () => {
    const src = { source: "map", mapId: 2, eventId: 1, page: 0 } as const;
    const msg = (seq: number) => ({ ...rec, seq, type: "message", src, cmd: 0, face: "", faceIndex: 0, speaker: "", text: "안녕" });
    const plug = (seq: number) => ({ ...rec, seq, type: "plugin", src, cmd: 2, code: 356, text: "TMng Search 종이 상자." });
    const recs = [
      { ...rec, seq: 1, type: "branchStart", reason: "newGame", parentBranch: null, fromSeq: null },
      msg(2), plug(3),
      { ...rec, seq: 4, type: "transfer", mapId: 2, x: 0, y: 0 },
      msg(5), plug(6),
      { ...rec, seq: 7, type: "plugin", src: null, cmd: 0, code: 357, text: "Other" },
    ] as LogRecord[];
    const m = buildHistory(recs);
    expect(m.alias.size).toBe(0);
    const folded = foldTimeline(branchPath(recs, m, 1), m, {});
    const out = readerItems(folded, data, new Map(), m);
    expect(out.map(i => i.kind)).toEqual(["chapter", "message", "plugin", "chapter", "message", "plugin"]);
    expect(out[2]).toEqual({ kind: "plugin", key: "r3", seq: 3, text: "종이 상자.", raw: "TMng Search 종이 상자.", name: "TMng", tech: false });
    // 두 번째 같은 대화는 반복으로 접히고(플러그인 줄은 그 안에), 다른 위치의 플러그인 줄은 따로
    expect(out[4]).toMatchObject({ kind: "message", seq: 5, repeat: 1 });
    expect(out[5]).toMatchObject({ kind: "plugin", seq: 7, text: "Other", tech: true });
    expect(lastSeqOf(out[5])).toBe(7);
    // 명령별 설정이 이긴다
    const over = readerItems(folded, data, new Map(), m, { TMng: "hide" });
    expect(over[2]).toMatchObject({ kind: "plugin", tech: true, text: "TMng Search 종이 상자." });
  });

  it("infers speaker from face when empty", () => {
    const items = readerItems([
      item({ ...rec, seq: 1, type: "message", src: null, cmd: 0, face: "Actor1", faceIndex: 0, speaker: "", text: "x" }),
    ], data, new Map(), model);
    const actor = data.actors.find(a => a && a.faceName === "Actor1" && a.faceIndex === 0);
    expect(items[0]).toMatchObject({ kind: "message", src: null, cmd: 0, speaker: actor?.name ?? "" });
  });

  it("falls back for choice labels and never throws on junk", () => {
    const items = readerItems([
      item({ ...rec, seq: 1, type: "choice", src: null, cmd: 0, picked: -2 }),
      item({ ...rec, seq: 2, type: "choice", src: null, cmd: 0, picked: 1 }),
      item({ ...rec, seq: 3, type: "battle", phase: "start", troopId: 1 }),
      item({ ...rec, seq: 4, type: "battle", phase: "end", troopId: 1 }),
      item({ ...rec, seq: 5, type: "transfer", mapId: 999, x: 0, y: 0 }),
      null as never,
    ], data, new Map(), model);
    expect(items.map(i => i.kind)).toEqual(["choice", "choice", "battle", "chapter"]);
    expect(items.map(i => (i as { label?: string }).label)).toEqual(["취소", "2번째 선택지", undefined, undefined]);
    expect(items[3]).toMatchObject({ text: "— #999 —" });
    expect(readerItems(null as never, null as never, null as never, null as never)).toEqual([]);
  });

  it("lastSeqOf", () => {
    const items = build(1);
    expect(lastSeqOf(items[0])).toBeNull();
    expect(lastSeqOf(items[1])).toBe(2);
  });
});

describe("readerItems text pictures", () => {
  const src = { source: "map", mapId: 1, eventId: 2, page: 0 } as const;
  const plugin = (seq: number, cmd: number, text: string) =>
    item({ ...rec, seq, type: "plugin", src, cmd, code: 356, text } as LogRecord);
  const pic = (seq: number, cmd: number, name: string) =>
    item({ ...rec, seq, type: "picture", src, cmd, pictureId: 5, name } as LogRecord);

  it("captions an empty-name picture with the D_TEXT records right before it", () => {
    const out = readerItems([plugin(1, 0, "D_TEXT 안녕하세요 24"), plugin(2, 1, "D_TEXT 또 만나요"), pic(3, 2, "")], data, new Map(), model);
    expect(out.at(-1)).toEqual({ kind: "picture", key: "r3", seq: 3, pictureId: 5, name: "", caption: "안녕하세요 / 또 만나요" });
  });

  it("drops an empty picture slot when no D_TEXT is right before", () => {
    const out = readerItems([plugin(1, 0, "D_TEXT 안녕 24"), pic(2, 3, "")], data, new Map(), model);
    expect(out.some(i => i.kind === "picture")).toBe(false);
  });

  it("never captions a named picture", () => {
    const out = readerItems([plugin(1, 0, "D_TEXT 안녕"), pic(2, 1, "village_map")], data, new Map(), model);
    expect(out.at(-1)).toMatchObject({ name: "village_map" });
    expect(out.at(-1)).not.toHaveProperty("caption");
  });
});
