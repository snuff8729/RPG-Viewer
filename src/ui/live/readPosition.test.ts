import { describe, it, expect } from "vitest";
import { clearReadPositions, initialReadSeq, loadReadSeq, readKey, saveReadSeq, type StoreLike } from "./readPosition";

function fake(): StoreLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map, getItem: k => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); },
    removeItem: k => { map.delete(k); }, get length() { return map.size; }, key: i => [...map.keys()][i] ?? null,
  };
}

describe("readPosition", () => {
  it("key format", () => expect(readKey("게임/data", 3)).toBe("rpgv.read.게임/data.3"));
  it("nothing saved → -1", () => expect(loadReadSeq("g", 1, fake())).toBe(-1));
  it("saves and loads", () => {
    const s = fake();
    saveReadSeq("g", 1, 10, s);
    expect(loadReadSeq("g", 1, s)).toBe(10);
    expect(loadReadSeq("g", 2, s)).toBe(-1);
    expect(s.map.get("rpgv.read.g.1")).toBe("10");
  });
  it("only increases", () => {
    const s = fake();
    saveReadSeq("g", 1, 10, s);
    saveReadSeq("g", 1, 5, s);
    expect(loadReadSeq("g", 1, s)).toBe(10);
    saveReadSeq("g", 1, 12, s);
    expect(loadReadSeq("g", 1, s)).toBe(12);
  });
  it("garbage value → -1, and can be overwritten", () => {
    const s = fake();
    s.map.set("rpgv.read.g.1", "abc");
    expect(loadReadSeq("g", 1, s)).toBe(-1);
    saveReadSeq("g", 1, 3, s);
    expect(loadReadSeq("g", 1, s)).toBe(3);
  });
  it("ignores non-integer seq", () => {
    const s = fake();
    saveReadSeq("g", 1, Number.NaN, s);
    saveReadSeq("g", 1, 1.5, s);
    expect(s.map.size).toBe(0);
  });
  it("throwing or missing storage never throws", () => {
    const bad: StoreLike = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };
    expect(loadReadSeq("g", 1, bad)).toBe(-1);
    expect(() => saveReadSeq("g", 1, 4, bad)).not.toThrow();
    expect(loadReadSeq("g", 1, null)).toBe(-1);
    expect(() => saveReadSeq("g", 1, 4, null)).not.toThrow();
  });
});

describe("initialReadSeq", () => {
  const path = [{ seq: 1, branch: 1 }, { seq: 5, branch: 1 }, { seq: 20, branch: 2 }, { seq: 22, branch: 2 }];
  it("own saved value wins when larger", () => {
    const s = fake();
    saveReadSeq("g", 2, 21, s);
    saveReadSeq("g", 1, 5, s);
    expect(initialReadSeq("g", 2, path, null, s)).toBe(21);
  });
  it("inherits ancestor position, clamped to the ancestor's part of the path", () => {
    const s = fake();
    saveReadSeq("g", 1, 3, s);
    expect(initialReadSeq("g", 2, path, null, s)).toBe(3);
    saveReadSeq("g", 1, 40, s); // 조상 갈래에서 갈라진 뒤 더 읽은 부분은 이 경로에 없다
    expect(initialReadSeq("g", 2, path, null, s)).toBe(5);
  });
  it("nothing saved → -1", () => expect(initialReadSeq("g", 2, path, null, fake())).toBe(-1));
});

describe("initialReadSeq stale", () => {
  it("ignores a saved seq beyond the end of the (fully loaded) path", () => {
    const s = fake();
    saveReadSeq("g", 1, 500, s);
    expect(initialReadSeq("g", 1, [{ seq: 1, branch: 1 }, { seq: 9, branch: 1 }], null, s)).toBe(-1);
    expect(initialReadSeq("g", 1, [{ seq: 1, branch: 1 }, { seq: 500, branch: 1 }], null, s)).toBe(500);
  });
});

describe("initialReadSeq with continuations", () => {
  // R=1, P=2는 R에 이어진 갈래(alias 2→1), X=3은 P의 seq 20(F)에서 갈라진 진짜 갈래
  const model = { alias: new Map([[2, 1]]) };
  const path = [
    { seq: 1, branch: 1 }, { seq: 12, branch: 1 }, { seq: 13, branch: 2 }, { seq: 16, branch: 2 },
    { seq: 20, branch: 2 }, { seq: 22, branch: 3 }, { seq: 23, branch: 3 },
  ];
  it("real fork off a continuation inherits the representative's position up to F", () => {
    const s = fake();
    saveReadSeq("g", 1, 50, s); // R에서 갈라진 뒤까지 읽음
    expect(initialReadSeq("g", 3, path, model, s)).toBe(20);
    const s2 = fake();
    saveReadSeq("g", 1, 14, s2);
    expect(initialReadSeq("g", 3, path, model, s2)).toBe(14);
  });
  it("reads legacy keys saved under a raw continuation id (max)", () => {
    const s = fake();
    saveReadSeq("g", 1, 5, s);
    saveReadSeq("g", 2, 16, s); // 예전에 이어진 갈래 id로 저장된 값
    expect(initialReadSeq("g", 3, path, model, s)).toBe(16);
    // 대표 갈래 자신을 볼 때도
    const own = [{ seq: 1, branch: 1 }, { seq: 12, branch: 1 }, { seq: 13, branch: 2 }, { seq: 30, branch: 2 }];
    expect(initialReadSeq("g", 1, own, model, s)).toBe(16);
    // 이어진 갈래 id로 물어도 대표 갈래로 본다
    expect(initialReadSeq("g", 2, own, model, s)).toBe(16);
  });
});

describe("clearReadPositions", () => {
  it("removes every branch of that game only", () => {
    const s = fake();
    saveReadSeq("g", 1, 5, s);
    saveReadSeq("g", 2, 7, s);
    saveReadSeq("g.x", 1, 3, s); // 이름이 접두어로 겹치는 다른 게임
    s.map.set("rpgv.readerMode", "full");
    clearReadPositions("g", s);
    expect(loadReadSeq("g", 1, s)).toBe(-1);
    expect(loadReadSeq("g", 2, s)).toBe(-1);
    expect(loadReadSeq("g.x", 1, s)).toBe(3);
    expect(s.map.get("rpgv.readerMode")).toBe("full");
  });
  it("never throws", () => {
    const bad: StoreLike = { getItem: () => null, setItem: () => {}, removeItem: () => { throw new Error("x"); }, length: 1, key: () => "rpgv.read.g.1" };
    expect(() => clearReadPositions("g", bad)).not.toThrow();
    expect(() => clearReadPositions("g", null)).not.toThrow();
    expect(() => clearReadPositions("g", { getItem: () => null, setItem: () => {} })).not.toThrow();
  });
});
