import { describe, it, expect } from "vitest";
import type { ReaderItem } from "@/core/live/reader";
import { initialWindow, readStats } from "./readerWindow";

const msg = (seq: number, repeat?: number): ReaderItem => ({ kind: "message", key: `r${seq}`, seq, speaker: "", face: "", faceIndex: 0, lines: ["x"], src: null, cmd: null, ...(repeat ? { repeat } : {}) });
const chapter = (k: string): ReaderItem => ({ kind: "chapter", key: k, text: "— 숲 —" });
const pic = (seq: number): ReaderItem => ({ kind: "picture", key: `r${seq}`, seq, name: "p" });
const scroll = (seq: number): ReaderItem => ({ kind: "scroll", key: `r${seq}`, seq, lines: ["s"] });

describe("readStats", () => {
  const items = [chapter("c1"), msg(1), pic(2), chapter("c3"), msg(4), msg(5, 3), scroll(6)];
  it("nothing read", () => expect(readStats(items, -1)).toEqual({ lastReadIdx: -1, firstUnreadIdx: 1, unread: 3 }));
  it("partly read; repeat items not counted", () => expect(readStats(items, 2)).toEqual({ lastReadIdx: 2, firstUnreadIdx: 4, unread: 2 }));
  it("only a repeat left: first unread found, count 0", () => expect(readStats(items.slice(0, 6), 4)).toEqual({ lastReadIdx: 4, firstUnreadIdx: 5, unread: 0 }));
  it("all read", () => expect(readStats(items, 6)).toEqual({ lastReadIdx: 6, firstUnreadIdx: -1, unread: 0 }));
});

describe("initialWindow", () => {
  const stats = (firstUnreadIdx: number) => ({ lastReadIdx: firstUnreadIdx - 1, firstUnreadIdx, unread: 1 });
  it("all read → bottom", () => expect(initialWindow(1000, { lastReadIdx: 999, firstUnreadIdx: -1, unread: 0 }, 50, 300)).toEqual({ shown: 300, at: "bottom", armed: true }));
  it("saved position: window covers first unread with no cap", () => {
    expect(initialWindow(5000, stats(100), 50, 300)).toEqual({ shown: 4905, at: "item", armed: true });
    expect(initialWindow(1000, stats(990), 50, 300)).toEqual({ shown: 300, at: "item", armed: true });
    expect(initialWindow(10, stats(2), 50, 300)).toEqual({ shown: 10, at: "item", armed: true });
  });
  it("never read, fits → from the start", () => expect(initialWindow(120, stats(0), -1, 300)).toEqual({ shown: 120, at: "top", armed: true }));
  it("never read, long → recent window top, marking deferred", () => expect(initialWindow(2000, stats(0), -1, 300)).toEqual({ shown: 300, at: "top", armed: false }));
});
