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
