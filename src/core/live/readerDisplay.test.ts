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
