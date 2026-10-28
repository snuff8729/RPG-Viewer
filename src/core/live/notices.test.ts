import { beforeAll, describe, expect, it } from "vitest";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { loadGame } from "../loader/loadGame";
import type { GameData } from "../types";
import { buildHistory, foldTimeline } from "./history";
import { parseLogText } from "./log";
import { readerItems, type ReaderItem } from "./reader";
import type { HistoryItem, LogRecord } from "./types";
import { ALL_KINDS, filterItems } from "../../ui/live/historyFilter";

let data: GameData;
beforeAll(async () => {
  const r = await loadGame(loadFixtureFolder("sample-mz"));
  if (!r.ok) throw new Error("load failed");
  data = r.data;
});

const base = { v: 1, run: 1, branch: 1, t: 0 } as const;
const mapSrc = { source: "map", mapId: 1, eventId: 2, page: 0 } as never;
const bs = (seq: number): LogRecord => ({ ...base, seq, type: "branchStart", reason: "newGame", parentBranch: null, fromSeq: null });
const start = (seq: number): LogRecord =>
  ({ ...base, seq, type: "battle", phase: "start", troopId: 4, troopName: "고블린*2", enemies: [], canEscape: true, canLose: false }) as LogRecord;
const end = (seq: number): LogRecord => ({ ...base, seq, type: "battle", phase: "end", troopId: 4, result: "win" }) as LogRecord;
const line = (seq: number, text: string): LogRecord => ({ ...base, seq, type: "battlelog", text }) as LogRecord;
const notice = (seq: number, text: string, source = "ticker", raw?: string): LogRecord =>
  ({ ...base, seq, type: "notice", source, text, ...(raw !== undefined ? { raw } : {}) }) as LogRecord;
const msg = (seq: number, text: string): LogRecord =>
  ({ ...base, seq, type: "message", src: mapSrc, cmd: 0, face: "", faceIndex: 0, speaker: "", text }) as LogRecord;

const fold = (recs: LogRecord[]) => foldTimeline(recs, buildHistory(recs), {});
const read = (recs: LogRecord[], opts: { notices?: boolean } = {}) => {
  const model = buildHistory(recs);
  return readerItems(foldTimeline(recs, model, {}), data, new Map(), model, null, null, opts);
};
const battleOf = (items: ReaderItem[]) => items.find((i): i is Extract<ReaderItem, { kind: "battle" }> => i.kind === "battle")!;

describe("notice records (1.9.0)", () => {
  it("parse like any record", () => {
    const { records, badLines } = parseLogText(JSON.stringify(notice(2, "\\i[906]\\c[4]안녕", "ticker", "\\i[906]\\c[4]\\n[1]")));
    expect(badLines).toBe(0);
    expect(records[0]).toMatchObject({ type: "notice", source: "ticker", text: "\\i[906]\\c[4]안녕" });
  });

  it("reader: a muted notice row outside battle, escape codes formatted (icons / colors stripped, names expanded)", () => {
    const items = read([bs(1), msg(2, "hi"), notice(3, "\\i[906]\\c[4]\\n[1] : 뜨거운 물", "ticker"), notice(4, "ㅋㅋ", "livecomment")]);
    expect(items.filter(i => i.kind === "notice")).toEqual([
      { kind: "notice", key: "r3", seq: 3, text: `${data.actors[1]?.name} : 뜨거운 물`, source: "티커" },
      { kind: "notice", key: "r4", seq: 4, text: "ㅋㅋ", source: "코멘트" },
    ]);
  });

  it("reader: empty or code-only notices are dropped; raw is used when text is missing", () => {
    const items = read([bs(1), notice(2, "\\c[3]"), { ...base, seq: 3, type: "notice", source: "My.fn", raw: "원문" } as LogRecord]);
    expect(items.filter(i => i.kind === "notice")).toEqual([{ kind: "notice", key: "r3", seq: 3, text: "원문", source: "My.fn" }]);
  });

  it("notices: false hides them everywhere and takes them out of the battle line count", () => {
    const recs = [bs(1), notice(2, "map"), start(3), line(4, "공격!"), notice(5, "전투 대사"), end(6)];
    const shown = read(recs);
    expect(shown.some(i => i.kind === "notice")).toBe(true);
    expect(battleOf(shown).logLines).toBe(2);
    const hidden = read(recs, { notices: false });
    expect(hidden.some(i => i.kind === "notice")).toBe(false);
    expect(battleOf(hidden).items.some(i => i.kind === "notice")).toBe(false);
    expect(battleOf(hidden).logLines).toBe(1);
  });

  it("battle blocks keep notices in order with the log lines and count them as battle lines", () => {
    const recs = [bs(1), start(2), line(3, "고블린 A이(가) 나타났다!"), notice(4, "레나 : 간다!"), line(5, "레나의 공격!"), end(6)];
    const b = fold(recs).find((i): i is Extract<HistoryItem, { kind: "battle" }> => i.kind === "battle")!;
    expect(b.logLines).toBe(3);
    const rb = battleOf(read(recs));
    expect(rb.items.map(i => i.kind)).toEqual(["battlelog", "notice", "battlelog"]);
    expect(rb.items[1]).toMatchObject({ kind: "notice", text: "레나 : 간다!" });
  });

  it("battles with different notices are not folded as the same battle", () => {
    const recs = [bs(1), start(2), notice(3, "A"), end(4), start(5), notice(6, "B"), end(7), start(8), notice(9, "B"), end(10)];
    const bs_ = fold(recs).filter((i): i is Extract<HistoryItem, { kind: "battle" }> => i.kind === "battle");
    expect(bs_.map(b => b.repeat)).toEqual([0, 0, 1]);
  });

  it("history filter: hideNotices drops notices outside and inside battles and lowers the line count", () => {
    const items = fold([bs(1), notice(2, "map"), start(3), line(4, "공격!"), notice(5, "전투"), end(6)]);
    const all = filterItems(items, new Set(ALL_KINDS));
    expect(all.some(i => i.kind === "record" && i.record.type === "notice")).toBe(true);
    const hidden = filterItems(items, new Set(ALL_KINDS), undefined, true);
    expect(hidden.some(i => i.kind === "record" && i.record.type === "notice")).toBe(false);
    const b = hidden.find((i): i is Extract<HistoryItem, { kind: "battle" }> => i.kind === "battle")!;
    expect(b.items.some(i => i.kind === "record" && i.record.type === "notice")).toBe(false);
    expect(b.logLines).toBe(1);
  });
});
