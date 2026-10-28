import { describe, expect, it } from "vitest";
import { loadAutoFollow, saveAutoFollow, type FollowStore } from "./autoFollow";

function mem(): FollowStore & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
}
const broken: FollowStore = {
  getItem() { throw new Error("x"); },
  setItem() { throw new Error("x"); },
};

describe("autoFollow", () => {
  it("defaults to on", () => {
    expect(loadAutoFollow(mem())).toBe(true);
    expect(loadAutoFollow(null)).toBe(true);
    expect(loadAutoFollow(broken)).toBe(true);
  });
  it("round-trips", () => {
    const s = mem();
    saveAutoFollow(false, s);
    expect(s.data["rpgv.autoFollow"]).toBe("0");
    expect(loadAutoFollow(s)).toBe(false);
    saveAutoFollow(true, s);
    expect(loadAutoFollow(s)).toBe(true);
  });
  it("save never throws", () => {
    expect(() => saveAutoFollow(false, broken)).not.toThrow();
    expect(() => saveAutoFollow(false, null)).not.toThrow();
  });
});
