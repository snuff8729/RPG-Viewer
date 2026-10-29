import { describe, expect, it } from "vitest";
import type { GameFolder, WritableGameFolder } from "@/core/fs/folder";
import {
  addonFileText, addonsFile, addonsStorageKey, loadAddonFile, loadAddonState, readAddonFolderFile, saveAddonFile, saveAddonState, updateAddonFile,
  type KeyStorage,
} from "./addons";
import type { AddonFile } from "@/core/addons/settings";

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
    expect(JSON.parse(f.files["www/rpg-viewer/addons.json"])).toEqual({ v: 1, enabled: { screenPictures: true, notices: false } });
    expect(s.map.get(addonsStorageKey("G|www/data"))).toContain("true");
    s.setItem(addonsStorageKey("G|www/data"), JSON.stringify({ v: 1, enabled: { screenPictures: false } }));
    expect(await loadAddonState(f, "www/data", "G|www/data", s)).toEqual({ screenPictures: true, notices: false });
  });

  it("saves and loads picture groups with the add-on state", async () => {
    const f = folder();
    const s = memStorage();
    await saveAddonFile(f, "data", "K", { state: { screenPictures: true }, pictureRoles: { 111: "stand" } }, s);
    expect(await loadAddonFile(f, "data", "K", s)).toEqual({ state: { screenPictures: true, notices: false }, pictureRoles: { 111: "stand" } });
    expect(await loadAddonFile(null, "data", "K", s)).toEqual({ state: { screenPictures: true, notices: false }, pictureRoles: { 111: "stand" } });
    expect(await loadAddonFile(null, "data", "none", s)).toEqual({ state: {}, pictureRoles: {} });
  });

  it("saves and loads the notices add-on's extra hook paths (valid ones only)", async () => {
    const f = folder();
    const s = memStorage();
    await saveAddonFile(f, "data", "K", { state: { notices: true }, pictureRoles: {}, noticeHooks: ["MyPopup.show", "not valid"] }, s);
    expect(JSON.parse(f.files["rpg-viewer/addons.json"]).noticeHooks).toEqual(["MyPopup.show"]);
    expect((await loadAddonFile(f, "data", "K", s)).noticeHooks).toEqual(["MyPopup.show"]);
    expect((await loadAddonFile(null, "data", "K", s)).noticeHooks).toEqual(["MyPopup.show"]);
  });

  it("falls back to localStorage for read-only folders or a missing file, else all off", async () => {
    const ro = folder({}, false);
    const s = memStorage();
    expect(await saveAddonState(ro, "data", "K", { screenPictures: true }, s)).toBe(false);
    expect(await loadAddonState(ro, "data", "K", s)).toEqual({ screenPictures: true, notices: false });
    expect(await loadAddonState(folder({ "rpg-viewer/addons.json": "{bad" }), "data", "K", s)).toEqual({ screenPictures: true, notices: false });
    expect(await loadAddonState(null, "data", "other", s)).toEqual({});
    expect(await loadAddonState(null, "data", "other", null)).toEqual({});
  });
});

describe("shared addons.json (PC and phone viewers)", () => {
  const turnOn = (id: "screenPictures" | "notices") => (p: AddonFile): AddonFile => ({ ...p, state: { ...p.state, [id]: true } });
  it("applies only this change on top of what the other viewer saved", async () => {
    const f = folder();
    // 이 뷰어는 아직 예전 설정(모두 꺼짐)을 들고 있고, 그사이 다른 뷰어가 알림 문구를 켰다
    await saveAddonState(f, "data", "K", { notices: true }, memStorage());
    const r = await updateAddonFile(f, "data", "K", { state: {}, pictureRoles: {} }, turnOn("screenPictures"), memStorage());
    expect(r.inFolder).toBe(true);
    expect(r.file.state).toMatchObject({ screenPictures: true, notices: true });
    expect(JSON.parse(f.files["rpg-viewer/addons.json"]).enabled).toEqual({ screenPictures: true, notices: true });
    expect(await readAddonFolderFile(f, "data")).toEqual(r.file);
    expect(addonFileText(r.file)).toBe(f.files["rpg-viewer/addons.json"]);
  });
  it("falls back to the given settings when the folder has no file or cannot be written", async () => {
    const r = await updateAddonFile(folder(), "data", "K", { state: { screenPictures: true }, pictureRoles: {} }, turnOn("notices"), memStorage());
    expect(r.file.state).toEqual({ screenPictures: true, notices: true });
    const ro = await updateAddonFile(folder({}, false), "data", "K", { state: {}, pictureRoles: {} }, turnOn("notices"), memStorage());
    expect(ro).toEqual({ file: { state: { notices: true }, pictureRoles: {} }, inFolder: false });
  });
});
