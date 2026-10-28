import { describe, expect, it } from "vitest";
import type { GameData } from "@/core/types";
import { MemoryFolder } from "@/core/fs/folder";
import { AssetStore } from "./assets";
import { classifiedName, pictureFolderRulesFromPlugins, type FolderRule } from "./pictureFolders";

// plugins.js entry written the way RPG Maker MV stores struct lists (as in DOP)
const tokens = JSON.stringify(["cg_09", "cg_88", "cg_888", "cg_99"].map((t) => JSON.stringify({ token: t, floderToken: t })));
const pluginsJs = (sw = "true", status = true) =>
  `var $plugins =\n[\n${JSON.stringify({ name: "BY_PictureClassify", status, description: "", parameters: { tokens, switch: sw } })}\n];\n`;
const RULES: FolderRule[] = pictureFolderRulesFromPlugins(pluginsJs());
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe("pictureFolderRulesFromPlugins", () => {
  it("reads BY_PictureClassify tokens in order", () =>
    expect(RULES).toEqual([
      { token: "cg_09", folder: "cg_09" }, { token: "cg_88", folder: "cg_88" },
      { token: "cg_888", folder: "cg_888" }, { token: "cg_99", folder: "cg_99" },
    ]));
  it("is empty when the plugin or its switch is off, or on junk", () => {
    expect(pictureFolderRulesFromPlugins(pluginsJs("false"))).toEqual([]);
    expect(pictureFolderRulesFromPlugins(pluginsJs("true", false))).toEqual([]);
    expect(pictureFolderRulesFromPlugins("garbage")).toEqual([]);
    expect(pictureFolderRulesFromPlugins(null)).toEqual([]);
  });
});

describe("classifiedName", () => {
  it("moves a name containing a token into its folder (first rule wins, like the game)", () => {
    expect(classifiedName("cg_09_0_06", RULES)).toBe("cg_09/cg_09_0_06");
    expect(classifiedName("cg_99_07_01", RULES)).toBe("cg_99/cg_99_07_01");
    // "cg_888_0_01" contains "cg_88" first: DOP keeps those files in pictures/cg_88/
    expect(classifiedName("cg_888_0_01", RULES)).toBe("cg_88/cg_888_0_01");
  });
  it("leaves other names and names already in the folder alone", () => {
    expect(classifiedName("CG_d", RULES)).toBeNull();
    expect(classifiedName("cg02_00", RULES)).toBeNull();
    expect(classifiedName("cg_09/cg_09_0_06", RULES)).toBeNull();
    expect(classifiedName("cg_09_0_06", [])).toBeNull();
    expect(classifiedName("cg_09_0_06", undefined)).toBeNull();
  });
  it("keeps a sub folder written in the name", () => expect(classifiedName("x/cg_09_a", RULES)).toBe("x/cg_09/cg_09_a"));
});

describe("AssetStore with picture folders", () => {
  const data = {
    engine: "MV", imgRoot: "img", dataRoot: "data", system: {}, pictureFolders: RULES,
  } as unknown as GameData;
  const store = () => new AssetStore(new MemoryFolder({
    "img/pictures/cg_09/cg_09_0_06.png": PNG,
    "img/pictures/CG_d.png": PNG,
    "img/pictures/cg_99_root.png": PNG,
  }), data);
  it("loads a Show Picture name from its classified folder", async () =>
    expect(await store().load("pictures", "cg_09_0_06")).not.toBeNull());
  it("loads a name the bridge recorded with the folder", async () =>
    expect(await store().load("pictures", "cg_09/cg_09_0_06")).not.toBeNull());
  it("still loads unclassified names and falls back to the plain path", async () => {
    expect(await store().load("pictures", "CG_d")).not.toBeNull();
    expect(await store().load("pictures", "cg_99_root")).not.toBeNull();
    expect(await store().load("pictures", "cg_09_nope")).toBeNull();
  });
  it("without rules a classified-only file stays missing", async () => {
    const plain = new AssetStore(new MemoryFolder({ "img/pictures/cg_09/cg_09_0_06.png": PNG }), { ...data, pictureFolders: undefined });
    expect(await plain.load("pictures", "cg_09_0_06")).toBeNull();
  });
});
