import { afterEach, describe, expect, it, vi } from "vitest";
import { gamePathKey, loadGamePath, saveGamePath } from "./launcher";

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("game path storage", () => {
  it("uses a per-game key", () => {
    expect(gamePathKey("Title|www/data")).toBe("rpgv.gamePath.Title|www/data");
  });

  it("round-trips a path per game", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    expect(loadGamePath("a")).toBeNull();
    saveGamePath("a", "C:\\Games\\A");
    expect(loadGamePath("a")).toBe("C:\\Games\\A");
    expect(loadGamePath("b")).toBeNull();
  });

  it("survives a throwing or missing storage", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    });
    expect(() => saveGamePath("a", "x")).not.toThrow();
    expect(loadGamePath("a")).toBeNull();
    vi.stubGlobal("localStorage", undefined);
    expect(loadGamePath("a")).toBeNull();
  });
});
