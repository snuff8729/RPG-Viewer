import { describe, expect, it } from "vitest";
import { adapterControlFlags, parseManifest } from "./manifest";
import { BUNDLED_ADAPTERS } from "@/app/adapterBundle";
import { addonsJson, parseAddonFile } from "../addons/settings";
import { withoutMenuScreens } from "../addons/screenPictures";
import type { LogRecord } from "../live/types";

const base = { id: "x-1", label: "X", description: "d", match: { plugins: ["A"] } };

describe("adapter options (menu pictures)", () => {
  it("parses options; only known control flags are kept", () => {
    const m = parseManifest({
      ...base,
      options: [
        { id: "menuPictures", label: " 메뉴 ", control: "captureMenuScenes" },
        { id: "menuPictures", label: "dup" },
        { id: "bad id", label: "x" },
        { id: "evil", label: "x", control: "capturePictures" },
        { id: "nolabel" },
      ],
    })!;
    expect(m.options).toEqual([{ id: "menuPictures", label: "메뉴" , control: "captureMenuScenes" }, { id: "evil", label: "x" }]);
    expect(adapterControlFlags([m], () => false)).toEqual({});
    expect(adapterControlFlags([m], (a, o) => a === "x-1" && o === "menuPictures")).toEqual({ captureMenuScenes: true });
  });

  it("character-picture-manager offers 메뉴 화면 그림도 기록 (off by default)", () => {
    const cpm = BUNDLED_ADAPTERS.find(a => a.manifest.id === "character-picture-manager")!;
    expect(cpm.manifest.options).toEqual([expect.objectContaining({ id: "menuPictures", label: "메뉴 화면 그림도 기록", control: "captureMenuScenes" })]);
  });

  it("stores option states per game in addons.json", () => {
    const text = addonsJson({}, null, null, null, { "character-picture-manager": true }, null,
      { "character-picture-manager": { menuPictures: true, "bad key": true }, "Bad Id": { a: true }, empty: {} });
    expect(JSON.parse(text).adapterOptions).toEqual({ "character-picture-manager": { menuPictures: true } });
    expect(parseAddonFile(text)?.adapterOptions).toEqual({ "character-picture-manager": { menuPictures: true } });
    expect(parseAddonFile(addonsJson({}))).not.toHaveProperty("adapterOptions");
  });

  it("old menu screen records are hidden unless the option is on", () => {
    const r = (seq: number, scene?: string): LogRecord => ({ v: 1, run: 1, branch: 1, t: 0, seq, type: "screen", scene, pics: [] }) as LogRecord;
    const path = [r(1, "map"), r(2, "menu"), r(3, "battle"), r(4)];
    expect(withoutMenuScreens(path, false).map(x => x.seq)).toEqual([1, 3, 4]);
    expect(withoutMenuScreens(path, true)).toBe(path);
    const noMenu = [r(1, "map")];
    expect(withoutMenuScreens(noMenu, false)).toBe(noMenu);
  });
});
