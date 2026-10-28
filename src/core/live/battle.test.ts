import { beforeAll, describe, expect, it } from "vitest";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { loadGame } from "../loader/loadGame";
import type { GameData } from "../types";
import { picturesBySeq, scenesBySeq, type PictureContext } from "../addons/screenPictures";
import { branchPath, buildHistory, foldTimeline } from "./history";
import { parseLogText } from "./log";
import { lastSeqOf, readerItems, type ReaderItem } from "./reader";
import { choiceFlow } from "./choiceFlow";
import type { Coverage, HistoryItem, LogRecord } from "./types";
import { readStats } from "../../ui/live/readerWindow";
import { filterItems } from "../../ui/live/historyFilter";
import { ALL_KINDS } from "../../ui/live/historyFilter";

let data: GameData;
beforeAll(async () => {
  const r = await loadGame(loadFixtureFolder("sample-mz"));
  if (!r.ok) throw new Error("load failed");
  data = r.data;
});

const base = { v: 1, run: 1, branch: 1, t: 0 } as const;
const troopSrc = { source: "troop", troopId: 4, page: 0 } as never;
const mapSrc = { source: "map", mapId: 1, eventId: 2, page: 0 } as never;
const bs = (seq: number): LogRecord => ({ ...base, seq, type: "branchStart", reason: "newGame", parentBranch: null, fromSeq: null });
const start = (seq: number, extra: object = {}): LogRecord =>
  ({ ...base, seq, type: "battle", phase: "start", troopId: 4, troopName: "고블린*2", enemies: ["고블린 A", "고블린 B"], canEscape: true, canLose: false, ...extra }) as LogRecord;
const end = (seq: number, result: string, extra: object = {}): LogRecord =>
  ({ ...base, seq, type: "battle", phase: "end", troopId: 4, result, ...extra }) as LogRecord;
const line = (seq: number, text: string, extra: object = {}): LogRecord => ({ ...base, seq, type: "battlelog", text, ...extra }) as LogRecord;
const msg = (seq: number, text: string, src: unknown = troopSrc, extra: object = {}): LogRecord =>
  ({ ...base, seq, type: "message", src, cmd: 0, face: "", faceIndex: 0, speaker: "", text, ...extra }) as LogRecord;

const fold = (recs: LogRecord[]) => foldTimeline(recs, buildHistory(recs), {});
const battles = (items: HistoryItem[]) => items.filter((i): i is Extract<HistoryItem, { kind: "battle" }> => i.kind === "battle");

describe("battle records", () => {
  it("parse like any record", () => {
    const text = [
      JSON.stringify(start(2)),
      JSON.stringify(line(3, "\\N[1]의 공격!")),
      JSON.stringify(end(4, "win", { rewards: { exp: 5, gold: 7, items: ["포션"] } })),
    ].join("\n");
    const { records, badLines } = parseLogText(text);
    expect(badLines).toBe(0);
    expect(records.map(r => r.type)).toEqual(["battle", "battlelog", "battle"]);
  });

  it("are not story records: a load right after a battle still continues the branch", () => {
    const b2 = { ...base, branch: 2 };
    const recs: LogRecord[] = [
      bs(1), msg(2, "hi", mapSrc), { ...base, seq: 3, type: "save", slot: 1 }, start(4), line(5, "공격!"), end(6, "win"),
      { ...b2, seq: 7, type: "branchStart", reason: "load", parentBranch: 1, fromSeq: 3 },
    ];
    expect(buildHistory(recs).alias).toEqual(new Map([[2, 1]]));
  });
});

describe("foldTimeline battle blocks", () => {
  it("groups start … end with the troop dialogue, log lines and state changes inside", () => {
    const recs: LogRecord[] = [
      bs(1), msg(2, "before", mapSrc), start(3), line(4, "고블린 A이(가) 나타났다!"), msg(5, "대장: 덤벼라!"),
      { ...base, seq: 6, type: "state", src: troopSrc, cmd: 3, changes: [{ kind: "switch", id: 1, value: true }] },
      line(7, "공격!"), end(8, "win"), msg(9, "after", { source: "map", mapId: 1, eventId: 3, page: 0 }),
    ];
    const items = fold(recs);
    expect(items.map(i => i.kind)).toEqual(["record", "record", "battle", "record"]);
    const b = battles(items)[0];
    expect(b.start.seq).toBe(3);
    expect(b.end?.seq).toBe(8);
    expect(b.logLines).toBe(2);
    expect(b.repeat).toBe(0);
    expect(b.items.map(i => (i.kind === "record" ? i.record.type : i.kind))).toEqual(["battlelog", "message", "state", "battlelog"]);
  });

  it("an unfinished battle ends before the next battle, a transfer or a new branch", () => {
    const items = fold([bs(1), start(2), line(3, "a"), start(4), line(5, "b"), { ...base, seq: 6, type: "transfer", mapId: 2, x: 0, y: 0 }, line(7, "stray")]);
    expect(items.map(i => (i.kind === "record" ? i.record.type : i.kind))).toEqual(["branchStart", "battle", "battle", "transfer", "battlelog"]);
    expect(battles(items).map(b => [b.end, b.logLines])).toEqual([[null, 1], [null, 1]]);
  });

  it("folds repeated identical battles (same troop, result, log and dialogue) like repeated talks", () => {
    const fight = (s: number, dmg = "12") => [start(s), line(s + 1, "공격!"), line(s + 2, `${dmg}의 데미지!`), end(s + 3, "win")];
    const items = fold([bs(1), ...fight(10), ...fight(20), ...fight(30), msg(40, "x", mapSrc), ...fight(50), ...fight(60, "13")]);
    const b = battles(items);
    expect(b.map(x => [x.start.seq, x.repeat])).toEqual([[10, 0], [20, 2], [50, 1], [60, 0]]);
  });

  it("never folds a battle with a choice or a different result", () => {
    const choice = (s: number): LogRecord[] => [
      start(s), { ...base, seq: s + 1, type: "choices", src: troopSrc, cmd: 1, options: ["a", "b"] },
      { ...base, seq: s + 2, type: "choice", src: troopSrc, cmd: 1, picked: 0 }, end(s + 3, "win"),
    ];
    expect(battles(fold([bs(1), ...choice(10), ...choice(20)])).map(b => b.repeat)).toEqual([0, 0]);
    expect(battles(fold([bs(1), start(10), end(11, "win"), start(20), end(21, "escape")])).map(b => b.repeat)).toEqual([0, 0]);
  });
});

describe("readerItems battle blocks", () => {
  const items = (recs: LogRecord[], scenes: ReturnType<typeof scenesBySeq> | null = null, battlesOn = true) => {
    const model = buildHistory(recs);
    const path = branchPath(recs, model, 1);
    return readerItems(foldTimeline(path, model, {}), data, new Map(), model, null, scenes, { battles: battlesOn });
  };
  const recs: LogRecord[] = [
    bs(1), start(2), line(3, "\\C[2]고블린 A\\C[0]이(가) 나타났다!"), msg(4, "대장: 덤벼라!"), line(5, "공격!"),
    end(6, "win", { rewards: { exp: 10, gold: 25, items: ["포션", "열쇠"] }, dropped: 3 }),
  ];

  it("builds one battle item: troop, result, rewards, dialogue and cleaned log lines", () => {
    const out = items(recs);
    expect(out.map(i => i.kind)).toEqual(["chapter", "battle"]);
    const b = out[1] as Extract<ReaderItem, { kind: "battle" }>;
    expect(b).toMatchObject({
      key: "r2", seq: 6, troop: "고블린*2", result: "win", ended: true, logLines: 2, dropped: 3, repeat: 0,
      rewards: "경험치 10 · 골드 25 · 얻은 것: 포션, 열쇠",
    });
    expect(b.items.map(i => i.kind)).toEqual(["battlelog", "message", "battlelog"]);
    expect(b.items[0]).toMatchObject({ text: "고블린 A이(가) 나타났다!" });
    expect(b.items[1]).toMatchObject({ kind: "message", lines: ["대장: 덤벼라!"] });
    expect(lastSeqOf(b)).toBe(6);
  });

  it("result labels, in-progress battles and the troop name fallback", () => {
    const out = items([bs(1), start(2, { troopName: undefined, troopId: 999 }), line(3, "x")]);
    expect(out[1]).toMatchObject({ kind: "battle", troop: "#999", result: null, ended: false, seq: 3 });
    expect(items([bs(1), start(2), end(3, "abort")])[1]).toMatchObject({ result: "abort" });
    expect(items([bs(1), start(2), end(3, "weird")])[1]).toMatchObject({ result: null, ended: true });
  });

  it("`전투 기록 보기` off leaves battles out entirely", () => {
    expect(items([...recs, msg(7, "after", mapSrc)], null, false).map(i => i.kind)).toEqual(["chapter", "message"]);
  });

  it("counts the battle's dialogue as unread, not its log lines", () => {
    expect(readStats(items(recs), 1).unread).toBe(1);
    expect(readStats(items(recs), 6).unread).toBe(0);
  });

  it("battle pictures: start / changed log lines / end feed the same screen sequence as messages", () => {
    const CG = [60, "boss_cg", 0, 0, 0, 100, 100, 255, 0, 0, 0, 1024, 768];
    const STAND = [111, "stand/hurt", 0, 380, 0, 100, 100, 255, 0, 0, 0, 400, 700];
    const ctx: PictureContext = { screen: { width: 1024, height: 768 } };
    const prs: LogRecord[] = [
      bs(1), start(2, { pics: [CG] }), line(3, "공격!"), msg(4, "보스: 크윽", troopSrc, { picsSame: true }),
      line(5, "12의 데미지!", { pics: [CG, STAND] }), end(6, "win", { picsSame: true }), msg(7, "after", mapSrc, { picsSame: true }),
    ];
    const pics = picturesBySeq(prs);
    expect([...pics.keys()]).toEqual([2, 4, 5, 6, 7]);
    const out = items(prs, scenesBySeq(pics, ctx));
    const b = out[1] as Extract<ReaderItem, { kind: "battle" }>;
    expect(b.screen?.pictures.map(p => p.id)).toEqual([60]);
    expect(b.items[0]).not.toHaveProperty("screen"); // a log line without pictures
    expect(b.items[1]).not.toHaveProperty("screen"); // same as the start
    expect((b.items[2] as { screen?: { pictures: { id: number }[] } }).screen?.pictures.map(p => p.id)).toEqual([60, 111]);
    expect(b.endScreen).toBeUndefined();
    expect(out[2]).not.toHaveProperty("screen"); // unchanged after the battle
  });

  it("a repeated battle carries no pictures and is counted in the choice flow segment", () => {
    const fight = (s: number) => [start(s, { pics: [] }), msg(s + 1, "대사"), end(s + 2, "win")];
    const prs = [bs(1), ...fight(10), ...fight(20)];
    const model = buildHistory(prs);
    const folded = foldTimeline(prs, model, {});
    const reader = readerItems(folded, data, new Map(), model, null, null);
    expect(reader.map(i => (i.kind === "battle" ? i.repeat : i.kind))).toEqual(["chapter", 0, 1]);
    const coverage: Coverage = { seen: new Set(), picks: new Map(), uncertainSeqs: new Set(), changedSeqs: new Set(), touched: new Set(), pluginRan: new Set() };
    const flow = choiceFlow({ items: folded, reader, data, model, coverage, branch: 1, choiceText: new Map() });
    const seg = flow.find(f => f.kind === "segment");
    expect(seg).toMatchObject({ messages: 1 });
    expect(seg?.kind === "segment" && seg.items.map(i => i.kind)).toEqual(["battle", "battle"]);
  });
});

describe("history filter with battle blocks", () => {
  it("the 전투 toggle hides the whole block; tech plugin rows inside are filtered", () => {
    const recs: LogRecord[] = [
      bs(1), start(2), { ...base, seq: 3, type: "plugin", src: troopSrc, cmd: 0, code: 356, text: "SetVar 1" }, msg(4, "x"), end(5, "win"),
    ];
    const items = fold(recs);
    const noBattle = new Set(ALL_KINDS.filter(k => k !== "battle"));
    expect(filterItems(items, noBattle).map(i => i.kind)).toEqual(["record"]);
    const shown = filterItems(items, new Set(ALL_KINDS), r => r.text.startsWith("SetVar"));
    const b = shown.find(i => i.kind === "battle");
    expect(b?.kind === "battle" && b.items.map(i => (i.kind === "record" ? i.record.type : i.kind))).toEqual(["message"]);
  });
});
