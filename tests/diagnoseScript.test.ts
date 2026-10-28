import { describe, expect, it } from "vitest";
import { MemoryFolder } from "@/core/fs/folder";
import { formatPluginsJs } from "@/core/live/installer";
import { main, NodeFolder, parseArgs, readAdapterManifests } from "../scripts/diagnose-game.ts";

const capture = () => {
  const out: string[] = [], err: string[] = [];
  return { out, err, deps: { log: (s: string) => { out.push(s); }, error: (s: string) => { err.push(s); } } };
};

describe("diagnose-game arguments", () => {
  it("takes one folder path and --json", () => {
    expect(parseArgs(["C:/Games/My Game"])).toEqual({ ok: true, path: "C:/Games/My Game", json: false });
    expect(parseArgs(["--json", "D:/x"])).toEqual({ ok: true, path: "D:/x", json: true });
  });

  it("rejects missing, extra and unknown arguments", () => {
    expect(parseArgs([])).toMatchObject({ ok: false });
    expect(parseArgs(["a", "b"])).toMatchObject({ ok: false });
    expect(parseArgs(["--write", "a"])).toMatchObject({ ok: false });
    expect(parseArgs(["-h"])).toMatchObject({ ok: false });
  });

  it("exits 2 on bad arguments and 1 when the folder does not exist", async () => {
    const a = capture();
    expect(await main([], a.deps)).toBe(2);
    expect(a.err.join("")).toContain("게임 폴더 경로가 필요해요");
    const b = capture();
    expect(await main(["Z:/no/such/game"], { ...b.deps, isDir: () => false })).toBe(1);
    expect(b.err.join("")).toContain("폴더가 없어요");
  });

  it("exits 1 when the folder is not an RPG Maker game", async () => {
    const c = capture();
    expect(await main(["X:/empty"], { ...c.deps, isDir: () => true, openFolder: () => new MemoryFolder({}) })).toBe(1);
    expect(c.err.join("")).toContain("찾지 못했어요");
  });

  it("prints the markdown report for a synthetic game (or JSON)", async () => {
    const folder = new MemoryFolder({
      "data/System.json": JSON.stringify({ gameTitle: "합성", currencyUnit: "G", switches: [], variables: [], advanced: { screenWidth: 1280, screenHeight: 720 } }),
      "data/MapInfos.json": "[null]",
      "data/CommonEvents.json": "[null]",
      "js/plugins.js": formatPluginsJs([{ name: "Ticker", status: true, description: "", parameters: {} }]),
    });
    const d = capture();
    expect(await main(["X:/game"], { ...d.deps, isDir: () => true, openFolder: () => folder, adapters: () => [] })).toBe(0);
    expect(d.out.join("")).toContain("# 게임 진단: 합성 (MZ)");
    expect(d.out.join("")).toContain("화면 크기 1280×720");
    const j = capture();
    expect(await main(["--json", "X:/game"], { ...j.deps, isDir: () => true, openFolder: () => folder, adapters: () => [] })).toBe(0);
    expect(JSON.parse(j.out.join("")).findings.some((f: { id: string }) => f.id === "notices")).toBe(true);
  });

  it("the node folder never leaves its root", async () => {
    const f = new NodeFolder("Z:/definitely/not/here");
    expect(await f.readText("../../etc/passwd")).toBeNull();
    expect(await f.list("..")).toEqual([]);
  });

  it("reads the repo adapters", () => {
    expect(readAdapterManifests().map((m) => m.id)).toContain("character-picture-manager");
  });
});
