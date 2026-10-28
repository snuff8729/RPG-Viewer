import { describe, expect, it } from "vitest";
import { isReaderMode, loadReaderMode, saveReaderMode, type ModeStore } from "./readerMode";

const mem = (): ModeStore & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
};
const broken: ModeStore = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };

describe("readerMode", () => {
  it("defaults to full", () => {
    expect(loadReaderMode(mem())).toBe("full");
    expect(loadReaderMode(null)).toBe("full");
  });
  it("round-trips under rpgv.readerMode", () => {
    const s = mem();
    saveReaderMode("flow", s);
    expect(s.m.get("rpgv.readerMode")).toBe("flow");
    expect(loadReaderMode(s)).toBe("flow");
  });
  it("ignores junk and broken storage", () => {
    const s = mem();
    s.setItem("rpgv.readerMode", "weird");
    expect(loadReaderMode(s)).toBe("full");
    expect(loadReaderMode(broken)).toBe("full");
    expect(() => saveReaderMode("flow", broken)).not.toThrow();
    expect(isReaderMode("flow")).toBe(true);
    expect(isReaderMode("")).toBe(false);
  });
});
