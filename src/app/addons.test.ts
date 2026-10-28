import { describe, expect, it } from "vitest";
import type { GameFolder, WritableGameFolder } from "@/core/fs/folder";
import { addonsFile, addonsStorageKey, loadAddonFile, loadAddonState, saveAddonFile, saveAddonState, type KeyStorage } from "./addons";

const memStorage = (): KeyStorage & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); } };
};

function folder(files: Record<string, string> = {}, writable = true): GameFolder & { files: Record<string, string> } {
  const f = {
    files,
    readText: async (p: string) => files[p] ?? null,
    readBinary: async () => null,
    list: async () => [],
  };
  if (!writable) return f;
  const w: WritableGameFolder & { files: Record<string, string> } = {
    ...f,
    stat: async () => null, readRange: async () => null, remove: async () => true, canWrite: async () => true, requestWrite: async () => true,
    writeText: async (p: string, t: string) => { files[p] = t; return true; },
  };
  return w;
}

describe("add-on settings storage", () => {
  it("lives next to the log: rpg-viewer/addons.json", () => {
    expect(addonsFile("www/data")).toBe("www/rpg-viewer/addons.json");
    expect(addonsFile("data")).toBe("rpg-viewer/addons.json");
  });

  it("saves to the game folder and localStorage; the folder file wins on load", async () => {
    const f = folder();
    const s = memStorage();
    expect(await saveAddonState(f, "www/data", "G|www/data", { screenPictures: true }, s)).toBe(true);
    expect(JSON.parse(f.files["www/rpg-viewer/addons.json"])).toEqual({ v: 1, enabled: { screenPictures: true } });
    expect(s.map.get(addonsStorageKey("G|www/data"))).toContain("true");
    s.setItem(addonsStorageKey("G|www/data"), JSON.stringify({ v: 1, enabled: { screenPictures: false } }));
    expect(await loadAddonState(f, "www/data", "G|www/data", s)).toEqual({ screenPictures: true });
  });

  it("saves and loads picture groups with the add-on state", async () => {
    const f = folder();
    const s = memStorage();
    await saveAddonFile(f, "data", "K", { state: { screenPictures: true }, pictureRoles: { 111: "stand" } }, s);
    expect(await loadAddonFile(f, "data", "K", s)).toEqual({ state: { screenPictures: true }, pictureRoles: { 111: "stand" } });
    expect(await loadAddonFile(null, "data", "K", s)).toEqual({ state: { screenPictures: true }, pictureRoles: { 111: "stand" } });
    expect(await loadAddonFile(null, "data", "none", s)).toEqual({ state: {}, pictureRoles: {} });
  });

  it("falls back to localStorage for read-only folders or a missing file, else all off", async () => {
    const ro = folder({}, false);
    const s = memStorage();
    expect(await saveAddonState(ro, "data", "K", { screenPictures: true }, s)).toBe(false);
    expect(await loadAddonState(ro, "data", "K", s)).toEqual({ screenPictures: true });
    expect(await loadAddonState(folder({ "rpg-viewer/addons.json": "{bad" }), "data", "K", s)).toEqual({ screenPictures: true });
    expect(await loadAddonState(null, "data", "other", s)).toEqual({});
    expect(await loadAddonState(null, "data", "other", null)).toEqual({});
  });
});
