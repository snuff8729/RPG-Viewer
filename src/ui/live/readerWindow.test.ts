import { describe, it, expect } from "vitest";
import type { ReaderItem } from "@/core/live/reader";
import { capRange, clampRange, extendDown, extendUp, grownRange, initialView, rangeShowing, readStats, sameRange, tailRange, trimToTail, visibleReaderIndex } from "./readerWindow";

const msg = (seq: number, repeat?: number): ReaderItem => ({ kind: "message", key: `r${seq}`, seq, speaker: "", face: "", faceIndex: 0, lines: ["x"], src: null, cmd: null, ...(repeat ? { repeat } : {}) });
const chapter = (k: string): ReaderItem => ({ kind: "chapter", key: k, text: "— 숲 —" });
const pic = (seq: number): ReaderItem => ({ kind: "picture", key: `r${seq}`, seq, pictureId: 1, name: "p" });
const scroll = (seq: number): ReaderItem => ({ kind: "scroll", key: `r${seq}`, seq, lines: ["s"] });

describe("readStats", () => {
  const items = [chapter("c1"), msg(1), pic(2), chapter("c3"), msg(4), msg(5, 3), scroll(6)];
  it("nothing read", () => expect(readStats(items, -1)).toEqual({ lastReadIdx: -1, firstUnreadIdx: 1, unread: 3 }));
  it("partly read; repeat items not counted", () => expect(readStats(items, 2)).toEqual({ lastReadIdx: 2, firstUnreadIdx: 4, unread: 2 }));
  it("only a repeat left: first unread found, count 0", () => expect(readStats(items.slice(0, 6), 4)).toEqual({ lastReadIdx: 4, firstUnreadIdx: 5, unread: 0 }));
  it("all read", () => expect(readStats(items, 6)).toEqual({ lastReadIdx: 6, firstUnreadIdx: -1, unread: 0 }));
});

describe("initialView", () => {
  const stats = (firstUnreadIdx: number) => ({ lastReadIdx: firstUnreadIdx - 1, firstUnreadIdx, unread: 1 });
  it("all read → tail page at bottom, armed", () => {
    expect(initialView(1000, { lastReadIdx: 999, firstUnreadIdx: -1, unread: 0 }, 50, 300)).toEqual({ range: { start: 700, end: 1000 }, at: "bottom", armed: true });
    expect(initialView(10, { lastReadIdx: 9, firstUnreadIdx: -1, unread: 0 }, 50, 300)).toEqual({ range: { start: 0, end: 10 }, at: "bottom", armed: true });
  });
  it("saved position: bounded range around first unread, not armed", () => {
    expect(initialView(5000, stats(100), 50, 300)).toEqual({ range: { start: 95, end: 400 }, at: "item", armed: false });
    expect(initialView(1000, stats(990), 50, 300)).toEqual({ range: { start: 985, end: 1000 }, at: "item", armed: false });
    expect(initialView(10, stats(2), 50, 300)).toEqual({ range: { start: 0, end: 10 }, at: "item", armed: false });
  });
  it("never read → from the first item, not armed", () => {
    expect(initialView(120, stats(0), -1, 300)).toEqual({ range: { start: 0, end: 120 }, at: "top", armed: false });
    expect(initialView(2000, stats(0), -1, 300)).toEqual({ range: { start: 0, end: 300 }, at: "top", armed: false });
  });
});

describe("range helpers", () => {
  it("tailRange", () => {
    expect(tailRange(1000, 300)).toEqual({ start: 700, end: 1000 });
    expect(tailRange(20, 300)).toEqual({ start: 0, end: 20 });
  });
  it("extendUp / extendDown clamp to bounds", () => {
    expect(extendUp({ start: 400, end: 700 }, 300)).toEqual({ start: 100, end: 700 });
    expect(extendUp({ start: 100, end: 400 }, 300)).toEqual({ start: 0, end: 400 });
    expect(extendDown({ start: 100, end: 400 }, 1000, 300)).toEqual({ start: 100, end: 700 });
    expect(extendDown({ start: 100, end: 900 }, 1000, 300)).toEqual({ start: 100, end: 1000 });
  });
  it("grownRange: attached range takes new items up to 2×page", () => {
    expect(grownRange({ start: 700, end: 1000 }, 1000, 1010, 300)).toEqual({ start: 700, end: 1010 });
    expect(grownRange({ start: 700, end: 1000 }, 1000, 5000, 300)).toEqual({ start: 700, end: 1300 });
    // 이미 2×page 길이여도 새 항목은 page개까지 붙는다
    expect(grownRange({ start: 0, end: 600 }, 600, 700, 300)).toEqual({ start: 0, end: 700 });
    expect(grownRange({ start: 0, end: 600 }, 600, 5000, 300)).toEqual({ start: 0, end: 900 });
  });
  it("burst after 이전 대사 더 보기: first new item still inside", () => {
    const up = extendUp(extendUp(tailRange(1000, 300), 300), 300); // [100, 1000) — 2×page 넘음
    expect(up).toEqual({ start: 100, end: 1000 });
    const g = grownRange(up, 1000, 9000, 300);
    expect(g).toEqual({ start: 400, end: 1300 });
    expect(g.start <= 1000 && 1000 < g.end).toBe(true);
  });
  it("grownRange: detached range stays", () => {
    const r = { start: 95, end: 400 };
    expect(grownRange(r, 5000, 5100, 300)).toBe(r);
  });
  it("grownRange: shrink clamps", () => {
    expect(grownRange({ start: 700, end: 1000 }, 1000, 800, 300)).toEqual({ start: 700, end: 800 });
    expect(grownRange({ start: 900, end: 1000 }, 1000, 800, 300)).toEqual({ start: 500, end: 800 });
  });
  it("burst: first new item is always inside the grown follow range", () => {
    const g = grownRange(tailRange(1000, 300), 1000, 9000, 300);
    expect(g.start <= 1000 && 1000 < g.end).toBe(true);
  });
  it("rangeShowing", () => {
    const r = { start: 100, end: 400 };
    expect(rangeShowing(r, 200, 1000, 300)).toBe(r);
    expect(rangeShowing(r, 400, 1000, 300)).toEqual({ start: 395, end: 700 });
    expect(rangeShowing(r, 2, 1000, 300)).toEqual({ start: 0, end: 302 });
    expect(rangeShowing(r, 900, 1000, 300)).toEqual({ start: 895, end: 1000 });
  });
  it("trimToTail", () => {
    expect(trimToTail({ start: 700, end: 1010 }, 1010, 300)).toEqual({ start: 710, end: 1010 });
    const small = { start: 0, end: 50 };
    expect(trimToTail(small, 50, 300)).toBe(small);
  });
  it("clampRange / sameRange", () => {
    expect(clampRange({ start: 0, end: 10 }, 0, 300)).toEqual({ start: 0, end: 0 });
    expect(sameRange({ start: 1, end: 2 }, { start: 1, end: 2 })).toBe(true);
    expect(sameRange({ start: 1, end: 2 }, { start: 1, end: 3 })).toBe(false);
  });
});


describe("bounded reading window", () => {
  it("caps the opposite edge and preserves identity below the limit", () => {
    const r = { start: 100, end: 1000 };
    expect(capRange(r, 900, "up")).toBe(r);
    expect(capRange(r, 450, "down")).toEqual({ start: 550, end: 1000 });
    expect(capRange(r, 450, "up")).toEqual({ start: 100, end: 550 });
  });
  it("stays bounded over repeated loads down, then back up to the beginning", () => {
    let r = { start: 0, end: 150 };
    for (let n = 0; n < 100; n++) {
      r = extendDown(r, 5000, 150);
      expect(r.end - r.start).toBeLessThanOrEqual(450);
    }
    expect(r).toEqual({ start: 4550, end: 5000 });
    for (let n = 0; n < 100; n++) {
      r = extendUp(r, 150);
      expect(r.end - r.start).toBeLessThanOrEqual(450);
    }
    expect(r).toEqual({ start: 0, end: 450 });
  });
  it("caps live growth while retaining the first newly appended item", () => {
    const r = grownRange({ start: 0, end: 450 }, 450, 10000, 150);
    expect(r).toEqual({ start: 150, end: 600 });
    expect(r.start <= 450 && r.end > 450).toBe(true);
    expect(trimToTail(r, 600, 150)).toEqual({ start: 450, end: 600 });
  });
  it("honors a supplied cap in either direction", () => {
    expect(extendDown({ start: 0, end: 300 }, 1000, 150, 350)).toEqual({ start: 100, end: 450 });
    expect(extendUp({ start: 400, end: 700 }, 150, 350)).toEqual({ start: 250, end: 600 });
  });
  it("keeps picture hiding out of the first-unread and read-position stats", () => {
    const screen: ReaderItem = { kind: "screen", key: "r1", seq: 1, screen: { kind: "stand", pictures: [] } };
    expect(readStats([screen, msg(2)], -1, false)).toEqual({ lastReadIdx: -1, firstUnreadIdx: 1, unread: 1 });
    expect(readStats([msg(0), screen], 1, false)).toEqual({ lastReadIdx: 0, firstUnreadIdx: -1, unread: 0 });
  });
});


describe("jumps with pictures hidden", () => {
  const screen: ReaderItem = { kind: "screen", key: "r1", seq: 1, screen: { kind: "stand", pictures: [] } };
  it("uses the next visible item, or the preceding one at the tail", () => {
    expect(visibleReaderIndex([msg(0), screen, msg(2)], 1, false)).toBe(2);
    expect(visibleReaderIndex([msg(0), screen], 1, false)).toBe(0);
    expect(visibleReaderIndex([msg(0), screen], 1, true)).toBe(1);
    expect(visibleReaderIndex([screen], 0, false)).toBe(-1);
    expect(visibleReaderIndex([], 0, true)).toBe(-1);
  });
});
