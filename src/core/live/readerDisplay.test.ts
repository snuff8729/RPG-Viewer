import { describe, expect, it } from "vitest";
import type { ReaderItem } from "./reader";
import { displayItems, ReaderDisplayCache, type DisplayConfig } from "./readerDisplay";

const msg = (seq: number, text = `대사 ${seq}`): ReaderItem =>
  ({ kind: "message", key: `r${seq}`, seq, speaker: "", face: "", faceIndex: 0, lines: [text], src: null, cmd: null });
const plugin = (seq: number, tech: boolean): ReaderItem => ({ kind: "plugin", key: `r${seq}`, seq, text: "p", raw: "p", name: "Cmd", tech });
const head = (seq: number) => ({ seq, item: { kind: "chapter", key: `p${seq}`, text: `묶음 ${seq}`, part: true } as ReaderItem });
const keys = (items: ReaderItem[]) => items.map((i) => i.key);

describe("displayItems", () => {
  it("puts part titles before the first item at or after each boundary", () => {
    const cfg: DisplayConfig = { heads: [head(1), head(5), head(6), head(20)] };
    expect(keys(displayItems([msg(1), msg(2), msg(7), msg(8)], cfg))).toEqual(["p1", "r1", "r2", "p6", "r7", "r8"]);
  });

  it("drops items the screen does not show", () => {
    const cfg: DisplayConfig = { heads: [], drop: (it) => it.kind === "plugin" && it.tech };
    expect(keys(displayItems([msg(1), plugin(2, true), plugin(3, false)], cfg))).toEqual(["r1", "r3"]);
  });
});

describe("hidden lines", () => {
  const match = (it: ReaderItem) => (it.kind === "plugin" && it.tech ? 0 : it.kind === "message" && it.lines[0] === "숨김" ? 1 : -1);

  it("folds runs of hidden lines into one `hidden` item, broken by shown lines and part titles", () => {
    const items = [msg(1), plugin(2, true), msg(3, "숨김"), plugin(4, true), msg(5), plugin(6, true), plugin(7, true)];
    const out = displayItems(items, { heads: [head(1), head(7)], match });
    expect(keys(out)).toEqual(["p1", "r1", "hr2", "r5", "hr6", "p7", "hr7"]);
    const h = out[2] as Extract<ReaderItem, { kind: "hidden" }>;
    expect(h.kind).toBe("hidden");
    expect(keys(h.items)).toEqual(["r2", "r3", "r4"]);
    expect(h.seq).toBe(4);
  });

  it("drops lines of silent rules without a placeholder and without breaking runs", () => {
    const items = [msg(1), plugin(2, true), msg(3, "숨김"), plugin(4, true), msg(5, "숨김"), msg(6), plugin(7, true), msg(8)];
    const out = displayItems(items, { heads: [], match, silent: (r) => r === 0 });
    expect(keys(out)).toEqual(["r1", "hr3", "r6", "r8"]);
    expect(keys((out[1] as Extract<ReaderItem, { kind: "hidden" }>).items)).toEqual(["r3", "r5"]);
  });

  it("does not break a hidden run at dropped items", () => {
    const items = [plugin(1, true), { kind: "screen", key: "r2", seq: 2, screen: { kind: "event", pictures: [] } } as unknown as ReaderItem, plugin(3, true)];
    const out = displayItems(items, { heads: [], match, drop: (it) => it.kind === "screen" });
    expect(keys(out)).toEqual(["hr1"]);
  });

  it("counts hidden lines per rule and keeps incremental = full while a hidden run grows", () => {
    const cfg: DisplayConfig = { heads: [head(1), head(20)], match };
    const base: ReaderItem[] = [];
    for (let s = 1; s <= 30; s++) base.push(s % 5 === 0 ? msg(s) : s % 2 === 0 ? plugin(s, true) : msg(s, "숨김"));
    const cache = new ReaderDisplayCache();
    for (let n = 0; n <= base.length; n++) {
      const items = base.slice(0, n);
      expect(cache.get(items, cfg)).toEqual(displayItems(items, cfg));
    }
    const want = [base.filter((x) => match(x) === 0).length, base.filter((x) => match(x) === 1).length];
    expect(cache.hiddenCounts(2)).toEqual(want);
  });
});

describe("ReaderDisplayCache", () => {
  it("matches the full pass while items are appended or the tail changes", () => {
    const cfg: DisplayConfig = { heads: [head(1), head(10), head(25)], drop: (it) => it.kind === "plugin" && it.tech };
    const cache = new ReaderDisplayCache();
    const base: ReaderItem[] = [];
    for (let s = 1; s <= 40; s++) base.push(s % 4 === 0 ? plugin(s, s % 8 === 0) : msg(s));
    let prevOut: ReaderItem[] | null = null;
    for (let n = 0; n <= base.length; n++) {
      const items = base.slice(0, n);
      // 끝 항목은 이어 만들 때 새 객체로 바뀔 수 있다
      if (n > 0 && n % 3 === 0) items[n - 1] = { ...items[n - 1] };
      const got = cache.get(items, cfg);
      expect(got).toEqual(displayItems(items, cfg));
      if (prevOut) expect(got).not.toBe(prevOut);
      prevOut = got;
    }
    // 같은 항목이면 같은 배열
    expect(cache.get(base.slice(), cfg)).toBe(cache.get(base.slice(), cfg));
    // 줄어들어도 맞다
    expect(cache.get(base.slice(0, 12), cfg)).toEqual(displayItems(base.slice(0, 12), cfg));
    // 설정이 바뀌면 처음부터
    const cfg2: DisplayConfig = { heads: [head(3)] };
    expect(cache.get(base, cfg2)).toEqual(displayItems(base, cfg2));
  });
});
