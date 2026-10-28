import { afterEach, describe, expect, it, vi } from "vitest";
import { autoBackupKey, initialWatch, isEmptyBackup, loadAutoBackup, MIN_GAP_MS, nextWatch, saveAutoBackup, type WatchState } from "./backups";

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("auto backup setting", () => {
  it("defaults to on and is stored per game", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    expect(autoBackupKey("g")).toBe("rpgv.autoBackup.g");
    expect(loadAutoBackup("a")).toBe(true);
    saveAutoBackup("a", false);
    expect(loadAutoBackup("a")).toBe(false);
    expect(loadAutoBackup("b")).toBe(true);
    saveAutoBackup("a", true);
    expect(loadAutoBackup("a")).toBe(true);
  });

  it("survives a throwing storage", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    });
    expect(loadAutoBackup("a")).toBe(true);
    expect(() => saveAutoBackup("a", false)).not.toThrow();
  });
});

describe("nextWatch", () => {
  const feed = (sigs: [string, number][], start: WatchState = initialWatch) => {
    let s = start;
    const fired: number[] = [];
    for (const [sig, t] of sigs) {
      const r = nextWatch(s, sig, t);
      s = r.state;
      if (r.backup) fired.push(t);
    }
    return { state: s, fired };
  };

  it("backs up the first stable signature (the server skips duplicates)", () => {
    expect(feed([["a", 0]]).fired).toEqual([]);
    expect(feed([["a", 0], ["a", 15]]).fired).toEqual([15]);
  });

  it("waits until a changed signature settles", () => {
    const base = feed([["a", 0], ["a", 1]]).state;
    const r = feed([["b", 200_000], ["c", 215_000], ["c", 230_000], ["c", 245_000]], base);
    expect(r.fired).toEqual([230_000]);
    expect(r.state.baseline).toBe("c");
  });

  it("backs up at most once per two minutes, then catches up", () => {
    const base = feed([["a", 0], ["a", 1]]).state; // backup at t=1
    const r = feed([["b", 15_000], ["b", 30_000], ["b", 45_000], ["b", MIN_GAP_MS + 1], ["b", MIN_GAP_MS + 20_000]], base);
    expect(r.fired).toEqual([MIN_GAP_MS + 1]);
  });

  it("does nothing while the signature stays the same", () => {
    const base = feed([["a", 0], ["a", 1]]).state;
    expect(feed([["a", 500_000], ["a", 515_000]], base).fired).toEqual([]);
  });
});

describe("isEmptyBackup", () => {
  it("marks backups without files", () => {
    expect(isEmptyBackup({ fileCount: 0 })).toBe(true);
    expect(isEmptyBackup({ fileCount: 3 })).toBe(false);
  });
});
