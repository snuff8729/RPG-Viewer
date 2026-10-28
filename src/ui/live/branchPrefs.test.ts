import { describe, expect, it } from "vitest";
import { MemoryFolder, type GameFolder } from "@/core/fs/folder";
import { emptyPrefs, updatePref } from "@/core/live/branchTidy";
import { loadBranchPrefs, prefsFilePath, prefsStoreKey, saveBranchPrefs } from "./branchPrefs";

const memStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
};
const prefs = (t: number, label: string) => updatePref(emptyPrefs(), 2, { label }, t);

describe("branch prefs storage", () => {
  it("writes the game folder file and reads it back from another browser", async () => {
    const folder = new MemoryFolder({ "www/data/System.json": "{}" });
    expect(await saveBranchPrefs(prefs(5, "보스 앞"), folder, "www/data", "g", memStore())).toBe(true);
    expect(prefsFilePath("www/data")).toBe("www/rpg-viewer/branches.json");
    expect(await folder.readText("www/rpg-viewer/branches.json")).toContain("보스 앞");
    // 새 브라우저: localStorage 비어 있음
    expect((await loadBranchPrefs(folder, "www/data", "g", memStore())).branches).toEqual({ 2: { label: "보스 앞" } });
  });
  it("falls back to localStorage when the folder is read-only", async () => {
    const readOnly: GameFolder = { readText: async () => null, readBinary: async () => null, list: async () => [] };
    const store = memStore();
    expect(await saveBranchPrefs(prefs(5, "a"), readOnly, "data", "g", store)).toBe(false);
    expect(store.m.has(prefsStoreKey("g"))).toBe(true);
    expect((await loadBranchPrefs(readOnly, "data", "g", store)).branches).toEqual({ 2: { label: "a" } });
  });
  it("does not write the folder without permission", async () => {
    const folder = new MemoryFolder({});
    folder.canWrite = async () => false;
    expect(await saveBranchPrefs(prefs(5, "a"), folder, "data", "g", memStore())).toBe(false);
    expect(await folder.readText("rpg-viewer/branches.json")).toBeNull();
  });
  it("uses the newer of file and localStorage", async () => {
    const folder = new MemoryFolder({});
    const store = memStore();
    await saveBranchPrefs(prefs(5, "old"), folder, "data", "g", store);
    store.setItem(prefsStoreKey("g"), JSON.stringify(prefs(9, "new")));
    expect((await loadBranchPrefs(folder, "data", "g", store)).branches[2].label).toBe("new");
  });
  it("never throws when storage fails", async () => {
    const bad = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };
    const folder = new MemoryFolder({});
    folder.writeText = async () => { throw new Error("disk"); };
    folder.readText = async () => { throw new Error("disk"); };
    expect(await saveBranchPrefs(prefs(1, "a"), folder, "data", "g", bad)).toBe(false);
    expect(await loadBranchPrefs(folder, "data", "g", bad)).toEqual(emptyPrefs());
  });
});
