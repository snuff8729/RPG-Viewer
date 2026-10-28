import { describe, it, expect } from "vitest";
import {
  adapterPluginName, applyAddonDefaults, defaultRoleOf, enabledPluginsOf, matchesGame, matchingAdapters, parseManifest,
  roleDefaultsOf, spritePatternMatches, type AdapterManifest,
} from "./manifest";
import { buildAdapterBundle } from "./bundle";
import { BUNDLED_ADAPTERS } from "@/app/adapterBundle";
import { roleOf, sceneOf, type ScreenPicture } from "../addons/screenPictures";

const base = { id: "x-1", label: "X", description: "d", match: { plugins: ["A", "B"] } };
const pic = (id: number, name: string, extra: Partial<ScreenPicture> = {}): ScreenPicture => ({
  id, name, origin: 0, x: 0, y: 0, scaleX: 100, scaleY: 100, opacity: 255, blendMode: 0, w: 300, h: 500, ...extra,
});

describe("adapter manifest", () => {
  it("validates id, label and match", () => {
    expect(parseManifest(base)).toEqual(base);
    expect(parseManifest(JSON.stringify(base))).toEqual(base);
    expect(parseManifest({ ...base, id: "Bad Id" })).toBeNull();
    expect(parseManifest({ ...base, id: "../x" })).toBeNull();
    expect(parseManifest({ ...base, label: " " })).toBeNull();
    expect(parseManifest({ ...base, match: {} })).toBeNull();
    expect(parseManifest({ ...base, match: { plugins: [1, ""] } })).toBeNull();
    expect(parseManifest("{bad")).toBeNull();
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest({ ...base, bridgeScript: "../evil.js" })).not.toHaveProperty("bridgeScript");
    expect(parseManifest({ ...base, bridgeScript: "bridge.js" })?.bridgeScript).toBe("bridge.js");
  });

  it("parses defaults: addons, picture id ranges, sprite patterns, decoration = hud", () => {
    const m = parseManifest({
      ...base,
      defaults: {
        addons: { screenPictures: true, unknown: true, notices: "yes" },
        pictureRoles: { "60": "cg", "101-103": "decoration", "111–150": "stand", "5-1": "cg", "x": "cg", "7": "nope" },
        spriteRoles: { "organ/": "stand", "a_*": "decoration", "b": "bad" },
      },
    })!;
    expect(m.defaults).toEqual({
      addons: { screenPictures: true },
      pictureRoles: [{ from: 60, to: 60, role: "cg" }, { from: 101, to: 103, role: "hud" }, { from: 111, to: 150, role: "stand" }],
      spriteRoles: [{ pattern: "organ/", role: "stand" }, { pattern: "a_*", role: "hud" }],
    });
  });

  it("matches enabled plugins (all / any, case-insensitive) and game titles", () => {
    const m = parseManifest(base)!;
    expect(matchesGame(m, { plugins: ["a", "B", "C"] })).toBe(true);
    expect(matchesGame(m, { plugins: ["A"] })).toBe(false);
    const any = parseManifest({ ...base, match: { plugins: ["A", "B"], pluginsMode: "any" } })!;
    expect(matchesGame(any, { plugins: ["B"] })).toBe(true);
    const title = parseManifest({ ...base, match: { gameTitle: ["Moon"] } })!;
    expect(matchesGame(title, { plugins: [], gameTitle: "The moon game" })).toBe(true);
    expect(matchesGame(title, { plugins: [], gameTitle: "Sun" })).toBe(false);
    const both = parseManifest({ ...base, match: { plugins: ["A"], gameTitle: ["Moon"] } })!;
    expect(matchesGame(both, { plugins: ["A"], gameTitle: "Sun" })).toBe(false);
    expect(matchingAdapters([m, any], { plugins: ["B"] })).toEqual([any]);
  });

  it("reads enabled plugin names from plugins.js", () => {
    const text = 'var $plugins =\n[\n{"name":"A","status":true,"description":"","parameters":{}},\n{"name":"B","status":false,"description":"","parameters":{}},\n{"name":"A","status":true,"description":"","parameters":{}}\n];\n';
    expect(enabledPluginsOf(text)).toEqual(["A"]);
    expect(enabledPluginsOf(null)).toEqual([]);
    expect(adapterPluginName("cpm")).toBe("RPGViewerBridge_cpm");
  });

  it("applies addon defaults (turns on only)", () => {
    const m = parseManifest({ ...base, defaults: { addons: { screenPictures: true, notices: false } } })!;
    expect(applyAddonDefaults({ notices: true }, m)).toEqual({ notices: true, screenPictures: true });
    const s = { screenPictures: true };
    expect(applyAddonDefaults(s, m)).toBe(s);
    expect(applyAddonDefaults(s, null)).toBe(s);
  });

  it("sprite patterns: folder prefix, glob over name or key, exact key", () => {
    expect(spritePatternMatches("organ/", "organ/A_b")).toBe(true);
    expect(spritePatternMatches("organ/", "xorgan/A")).toBe(false);
    expect(spritePatternMatches("actor01_cutin_*", "actor01_cutin_A_0001")).toBe(true);
    expect(spritePatternMatches("actor01_cutin_*", "actor02_cutin_A_0001")).toBe(false);
    expect(spritePatternMatches("TickerTest", "TickerTest_3")).toBe(true);
    expect(spritePatternMatches("a.b*", "axb")).toBe(false);
  });
});

describe("bundled adapters", () => {
  it("bundles every adapters/ folder with valid manifests", () => {
    const ids = BUNDLED_ADAPTERS.map(a => a.manifest.id);
    expect(ids).toEqual(["character-picture-manager", "ddaggeo-mode"]);
    const cpm = BUNDLED_ADAPTERS[0];
    expect(cpm.script).toContain("registerExtension");
    expect(cpm.viewer?.standGroupLabel?.({ key: "a1", actorId: 1, actorName: "아마네", pictures: [] })).toBe("아마네 스탠딩");
    expect(cpm.manifest.defaults?.addons).toEqual({ screenPictures: true });
    expect(BUNDLED_ADAPTERS[1].script).toBeNull();
  });

  it("matches the two games", () => {
    const list = BUNDLED_ADAPTERS.map(a => a.manifest);
    expect(matchingAdapters(list, { plugins: ["PluginCommonBase", "CharacterPictureManager", "NUUN_BattleStyleEX"] }).map(m => m.id))
      .toEqual(["character-picture-manager"]);
    expect(matchingAdapters(list, { plugins: ["CallStand", "CallCutin", "Ticker", "X"] }).map(m => m.id)).toEqual(["ddaggeo-mode"]);
    expect(matchingAdapters(list, { plugins: ["CallStand", "Ticker"] })).toEqual([]);
  });

  it("ddaggeo-mode roles: gauge HUD, stands, cg, small cut-in layers stay stand", () => {
    const dd = BUNDLED_ADAPTERS.find(a => a.manifest.id === "ddaggeo-mode")!.manifest;
    expect(dd.defaults?.addons).toEqual({ screenPictures: true, notices: true });
    const d = roleDefaultsOf([dd]);
    const ctx = { screen: { width: 816, height: 624 }, defaultRole: (p: ScreenPicture) => defaultRoleOf(p, d) };
    expect(roleOf(pic(102, "gauge", { w: 800, h: 600 }), ctx)).toBe("hud");
    expect(roleOf(pic(60, "small", { w: 10, h: 10 }), ctx)).toBe("cg");
    expect(roleOf(pic(120, "tiny", { w: 10, h: 10 }), ctx)).toBe("stand");
    expect(roleOf(pic(1000, "organ/A_b", { kind: "sprite", w: 20, h: 20 }), ctx)).toBe("stand");
    expect(roleOf(pic(1001, "actor01_cutin_A_0001", { kind: "sprite", w: 20, h: 20 }), ctx)).toBe("stand");
    expect(roleOf(pic(1002, "other", { kind: "sprite", w: 20, h: 20 }), ctx)).toBe("hud"); // automatic: small
    // user choice still wins
    expect(roleOf(pic(102, "gauge"), { ...ctx, roles: { 102: "stand" } })).toBe("stand");
    expect(sceneOf([pic(102, "gauge"), pic(115, "s")], ctx).stand.map(p => p.id)).toEqual([115]);
  });

  it("buildAdapterBundle skips mismatched ids and missing scripts", () => {
    const m: AdapterManifest = { id: "a", label: "A", description: "", match: { plugins: ["P"] }, bridgeScript: "bridge.js" };
    const out = buildAdapterBundle(
      { "../../adapters/a/manifest.json": m, "../../adapters/b/manifest.json": { ...m, id: "c" }, "../../adapters/d/manifest.json": { ...m, id: "d" } },
      { "../../adapters/a/bridge.js": "src" },
      { "../../adapters/a/viewer.ts": { viewer: {} } },
    );
    expect(out.map(a => [a.manifest.id, a.script, !!a.viewer])).toEqual([["a", "src", true]]);
  });
});
