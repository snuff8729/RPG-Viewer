import { describe, expect, it } from "vitest";
import type { ReaderItem } from "./reader";
import { firstSeqOf, hasSeq, indexOfSeq, itemSummary } from "./readerNav";

const msg = (seq: number, text: string, speaker = ""): ReaderItem =>
  ({ kind: "message", key: `r${seq}`, seq, speaker, face: "", faceIndex: 0, lines: text.split("\n"), src: null, cmd: null });
const chapter = (seq: number, text: string): ReaderItem => ({ kind: "chapter", key: `c${seq}`, text });
const battle = (start: number, last: number): ReaderItem => ({
  kind: "battle", key: `r${start}`, seq: last, troop: "슬라임", result: "win", ended: true, items: [], logLines: 0, dropped: 0, rewards: null, repeat: 0,
});

describe("firstSeqOf / indexOfSeq", () => {
  const items = [chapter(1, "— 마을 —"), msg(2, "a"), battle(5, 9), msg(10, "b")];

  it("reads the starting record from the key", () => {
    expect(items.map(firstSeqOf)).toEqual([1, 2, 5, 10]);
    expect(firstSeqOf({ kind: "cutin", key: "k7", seq: 9, frames: [], best: 0 })).toBe(7);
  });

  it("finds the item holding a record (or the next one)", () => {
    expect(indexOfSeq(items, 2)).toBe(1);
    expect(indexOfSeq(items, 6)).toBe(2); // 전투 안의 기록
    expect(indexOfSeq(items, 10)).toBe(3);
    expect(indexOfSeq(items, 99)).toBe(3);
    expect(indexOfSeq([], 1)).toBe(-1);
  });
});

describe("hasSeq", () => {
  it("binary-searches sorted records, scans otherwise", () => {
    const recs = [1, 3, 5, 8].map((seq) => ({ seq }));
    expect(hasSeq(recs, 5)).toBe(true);
    expect(hasSeq(recs, 4)).toBe(false);
    expect(hasSeq([{ seq: 9 }, { seq: 2 }], 2)).toBe(true);
    expect(hasSeq(null as unknown as [], 1)).toBe(false);
  });
});

describe("itemSummary", () => {
  it("cuts to about 20 characters", () => {
    expect(itemSummary(msg(1, "안녕하세요\n  오늘   날씨가 좋네요 정말로 좋아요", "레이"))).toBe("레이: 안녕하세요 오늘 날씨가 좋네요…");
    expect(itemSummary(msg(1, "짧다"))).toBe("짧다");
    expect(itemSummary(chapter(1, "— 마을 —"))).toBe("마을");
    expect(itemSummary(battle(1, 2))).toBe("전투: 슬라임");
  });
});
