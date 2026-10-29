import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { formatPluginsJs } from "@/core/live/installer";
import { countLines, tokenOf } from "@/core/mask";
import { MASK_VOCABULARY } from "@/core/mask/keywords";
import { main as maskMain, parseArgs } from "../scripts/mask-game.ts";
import { main as unmaskMain } from "../scripts/unmask-game.ts";
import { main as diagnoseMain } from "../scripts/diagnose-game.ts";

const KW = MASK_VOCABULARY.find((w) => /^[a-z]{4,}$/.test(w))!;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rpgv-mask-"));
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const capture = () => {
  const out: string[] = [], err: string[] = [];
  return { out, err, deps: { log: (s: string) => { out.push(s); }, error: (s: string) => { err.push(s); } } };
};

function write(root: string, rel: string, text: string) {
  const p = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, "utf8");
}

const PLUGIN_SRC = "/*:\n * @plugindesc アリスの機能\n */\n(function() {\n  var name = 'アリス';\n})();\n";

/** PNG 시그니처 + IHDR(크기만) — 픽셀 없는 합성 머리 */
function pngHead(w: number, h: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(b, 0);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

function makeGame(): string {
  const g = path.join(tmp, "game");
  write(g, "data/System.json", JSON.stringify({ gameTitle: "アリスの冒険", currencyUnit: "G", switches: ["", "扉"], variables: [], advanced: { screenWidth: 816, screenHeight: 624 } }));
  write(g, "data/MapInfos.json", '[\nnull,\n{"id":1,"name":"アリスの部屋","parentId":0}\n]');
  write(g, "data/CommonEvents.json", JSON.stringify([null, { id: 1, name: `${KW}_event`, list: [{ code: 401, indent: 0, parameters: ["\\C[2]アリス\\C[0]: やあ"] }, { code: 231, indent: 0, parameters: [1, "アリス", 0, 0, 0, 0, 100, 100, 255, 0] }, { code: 0, indent: 0, parameters: [] }] }]));
  write(g, "data/Map001.json", JSON.stringify({ width: 1, height: 1, data: [], events: [] }));
  write(g, "js/plugins.js", formatPluginsJs([{ name: "アリス_Core", status: true, description: "説明", parameters: { 表示: "true" } }]));
  write(g, "js/plugins/アリス_Core.js", PLUGIN_SRC);
  write(g, "img/pictures/アリス.png", "PNGDATA");
  fs.mkdirSync(path.join(g, "img/faces"), { recursive: true });
  fs.writeFileSync(path.join(g, "img/faces/アリス顔.png"), pngHead(144, 144));
  // 암호화 파일: "RPGMV" 머리 16바이트 + 키로 뒤섞인 앞 16바이트 + 평문 IHDR 크기
  const enc = Buffer.concat([Buffer.from([0x52, 0x50, 0x47, 0x4d, 0x56, 0, 0, 0, 0, 3, 1, 0, 0, 0, 0, 0]), pngHead(576, 288)]);
  for (let i = 16; i < 32; i++) enc[i] ^= 0x5a;
  fs.writeFileSync(path.join(g, "img/faces/Actor1.png_"), enc);
  write(g, "save/file1.rmmzsave", "x");
  write(g, "index.html", "<html><head><title>アリスの冒険</title></head></html>");
  return g;
}

describe("mask-game", () => {
  it("parses arguments", () => {
    expect(parseArgs(["G", "--out", "O"])).toEqual({ ok: true, path: "G", out: "O", note: null });
    expect(parseArgs(["G", "--out", "O", "--note", "멈춰요"])).toMatchObject({ ok: true, note: "멈춰요" });
    expect(parseArgs(["G"])).toMatchObject({ ok: false });
    expect(parseArgs(["--out", "O"])).toMatchObject({ ok: false });
    expect(parseArgs(["G", "--out"])).toMatchObject({ ok: false });
  });

  const game = makeGame();
  const out = path.join(tmp, "mirror");

  it("refuses an output folder inside the game or a non-empty one", async () => {
    const a = capture();
    expect(await maskMain([game, "--out", path.join(game, "m")], a.deps)).toBe(1);
    expect(fs.existsSync(path.join(game, "m"))).toBe(false);
    const full = path.join(tmp, "full");
    write(full, "x.txt", "x");
    const b = capture();
    expect(await maskMain([game, "--out", full], b.deps)).toBe(1);
    expect(b.err.join("")).toContain("비어 있지 않아요");
  });

  it("writes a masked mirror that diagnose can still read, without touching the game", async () => {
    const before = fs.readFileSync(path.join(game, "js/plugins/アリス_Core.js"), "utf8");
    const c = capture();
    const code = await maskMain([game, "--out", out, "--note", "アリスの部屋 에서 게임이 멈춰요"], { ...c.deps, adapters: () => [] });
    expect(c.err).toEqual([]);
    expect(code).toBe(0);
    expect(c.out.join("")).not.toMatch(/[぀-ヿ一-鿿]/);
    expect(fs.readFileSync(path.join(game, "js/plugins/アリス_Core.js"), "utf8")).toBe(before);

    const all: string[] = [];
    const walk = (d: string, rel = "") => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(path.join(d, e.name), r); else all.push(r); } };
    walk(out);
    const plugin = `js/plugins/${tokenOf("アリス_Core")}.js`;
    expect(all.sort()).toEqual([
      "AI-README.md", "REPORT.md", "data/CommonEvents.json", "data/Map001.json", "data/MapInfos.json", "data/System.json",
      `img/pictures/${tokenOf("アリス")}.png`, "index.html", "js/plugins.js", plugin,
      "IMAGES.json", `img/faces/${tokenOf("アリス顔")}.png`, "img/faces/Actor1.png_",
    ].sort());
    const images = JSON.parse(fs.readFileSync(path.join(out, "IMAGES.json"), "utf8"));
    expect(images).toEqual({
      "img/faces/Actor1.png_": { width: 576, height: 288, bytes: 49, cols: 4, rows: 2 },
      [`img/faces/${tokenOf("アリス顔")}.png`]: { width: 144, height: 144, bytes: 33, cols: 1, rows: 1 },
      [`img/pictures/${tokenOf("アリス")}.png`]: { bytes: 7 },
    });
    expect(fs.readFileSync(path.join(out, "AI-README.md"), "utf8")).toContain("engine: MZ");
    expect(fs.readFileSync(path.join(out, "REPORT.md"), "utf8")).toContain("engine: MZ");
    for (const f of all) {
      const text = fs.readFileSync(path.join(out, f), "utf8");
      expect(text, f).not.toMatch(/[぀-ヿ一-鿿]/);
      expect(text.toLowerCase().includes(KW), f).toBe(false);
    }
    expect(fs.statSync(path.join(out, `img/pictures/${tokenOf("アリス")}.png`)).size).toBe(0);
    expect(countLines(fs.readFileSync(path.join(out, plugin), "utf8"))).toBe(countLines(PLUGIN_SRC));
    const report = fs.readFileSync(path.join(out, "REPORT.md"), "utf8");
    expect(report).toContain(`${tokenOf("アリスの部屋")} 에서 게임이 멈춰요`);
    expect(report).toContain("게임 진단");

    const d = capture();
    expect(await diagnoseMain([out], { ...d.deps, adapters: () => [] })).toBe(0);
    expect(d.out.join("")).toContain(tokenOf("アリスの冒険"));
  });

  it("exits 2 and writes warnings when a listed word remains", async () => {
    // 낱말이 든 JS 정규식 플래그 자리 같은 곳은 못 가린다 — 여기선 게임 밖 문자열로 흉내: 확장자에 낱말
    const g2 = path.join(tmp, "game2");
    fs.cpSync(game, g2, { recursive: true });
    write(g2, `img/pictures/a.${KW}`, "x");
    const out2 = path.join(tmp, "mirror2");
    const c = capture();
    expect(await maskMain([g2, "--out", out2], { ...c.deps, adapters: () => [] })).toBe(2);
    const warn = fs.readFileSync(path.join(out2, "MASK-WARNINGS.md"), "utf8");
    expect(warn).toContain("(file names)");
    expect(warn.toLowerCase().includes(KW)).toBe(false);
    expect(c.out.join("").toLowerCase().includes(KW)).toBe(false);
  });

  it("unmask restores tokens in a repo file and reports unknown ones", async () => {
    const f = path.join(tmp, "adapter.json");
    const original = `{"picture":"アリス","plugin":"アリス_Core"}`;
    fs.writeFileSync(f, `{"picture":"${tokenOf("アリス")}","plugin":"${tokenOf("アリス_Core")}"} T_00000000000000`, "utf8");
    const c = capture();
    expect(await unmaskMain([game, f], c.deps)).toBe(0);
    expect(fs.readFileSync(f, "utf8")).toBe(`${original} T_00000000000000`);
    expect(c.out.join("")).toContain("2곳");
    expect(c.out.join("")).toContain("1종");
    expect(c.out.join("")).not.toMatch(/[぀-ヿ]/);
    const e = capture();
    expect(await unmaskMain([game, path.join(game, "js/plugins.js")], e.deps)).toBe(1);
  });
});
