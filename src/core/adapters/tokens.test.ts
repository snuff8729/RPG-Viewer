import { describe, it, expect } from "vitest";
import { MemoryFolder } from "../fs/folder";
import { formatPluginsJs } from "../live/installer";
import { maskFileName, maskString } from "../mask";
import { getAdapterInstallStatus, installAdapter } from "./install";
import { matchesGame, parseManifest, spritePatternMatches } from "./manifest";

// 가린 사본을 보고 만든 어댑터: 게임 이름·파일 이름 자리에 토큰(T_…)이 온다.
const M = (s: string) => maskString(s);

describe("manifest with tokens", () => {
  it("matches plugins and game titles by original or token", () => {
    const m = parseManifest({ id: "x", label: "X", match: { plugins: [M("アリス_Core"), "Plain"] } })!;
    expect(M("アリス_Core")).toMatch(/^T_[0-9a-f]{14}$/);
    expect(matchesGame(m, { plugins: ["アリス_Core", "Plain"] })).toBe(true);
    expect(matchesGame(m, { plugins: ["ボブ_Core", "Plain"] })).toBe(false);
    const raw = parseManifest({ id: "x", label: "X", match: { plugins: ["アリス_Core"] } })!;
    expect(matchesGame(raw, { plugins: ["アリス_core"] })).toBe(true);
    const title = parseManifest({ id: "x", label: "X", match: { gameTitle: [M("アリスの冒険")] } })!;
    expect(matchesGame(title, { plugins: [], gameTitle: "アリスの冒険 v1.2" })).toBe(true);
    expect(matchesGame(title, { plugins: [], gameTitle: "ボブの冒険" })).toBe(false);
  });

  it("matches sprite rules written with tokens against original picture names", () => {
    const dir = maskFileName("かお") + "/";
    expect(spritePatternMatches(dir, "かお/A_1")).toBe(true);
    expect(spritePatternMatches(dir, "め/A_1")).toBe(false);
    expect(spritePatternMatches(M("えがお_3"), "えがお_3")).toBe(true);
    expect(spritePatternMatches(M("えがお_3"), "えがお_4")).toBe(false);
    expect(spritePatternMatches("cut/" + M("えがお") + "*", "cut/えがお")).toBe(true);
    expect(spritePatternMatches("organ/", "organ/A")).toBe(true);
  });
});

describe("bridge install with tokens", () => {
  const SRC_JS = "(function() {\n  var who = 'ボブ';\n})();\n";
  const game = () => new MemoryFolder({
    "js/plugins.js": formatPluginsJs([{ name: "アリス_Core", status: true, description: "", parameters: {} }]),
    "js/plugins/アリス_Core.js": SRC_JS,
    "data/System.json": JSON.stringify({ gameTitle: "アリスの冒険" }),
    "img/pictures/えがお.png": "x",
  });

  it("replaces known tokens with the game's originals and reports unknown ones", async () => {
    const f = game();
    const unknown = "T_00000000000000";
    const bridge = `// ${maskFileName("img/pictures/えがお.png")}\nvar P = '${M("アリス_Core")}', W = "${M("ボブ")}", N = '${unknown}';\n`;
    const r = await installAdapter(f, "data", "x", "X", bridge);
    expect(r).toEqual({ ok: true, unknownTokens: 1 });
    const out = (await f.readText("js/plugins/RPGViewerBridge_x.js"))!;
    expect(out).toBe(`// img/pictures/えがお.png\nvar P = 'アリス_Core', W = "ボブ", N = '${unknown}';\n`);
    expect(await getAdapterInstallStatus(f, "data", "x", bridge)).toEqual({ state: "installed", outdated: false });
    expect(await getAdapterInstallStatus(f, "data", "x", bridge + "//\n")).toEqual({ state: "installed", outdated: true });
  });

  it("leaves token-free sources untouched", async () => {
    const f = game();
    expect(await installAdapter(f, "data", "y", "Y", "var a = 1;\n")).toEqual({ ok: true });
    expect(await f.readText("js/plugins/RPGViewerBridge_y.js")).toBe("var a = 1;\n");
  });
});
