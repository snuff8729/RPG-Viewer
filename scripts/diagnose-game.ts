// 게임 폴더를 읽기만 해서 자동 진단 보고서(마크다운)를 찍는다. 게임 코드는 실행하지 않고, 아무것도 쓰지 않는다.
// 사용: npm run diagnose -- "<게임 폴더>" [--json]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { GameFolder } from "../src/core/fs/folder.ts";
import { loadGame } from "../src/core/loader/loadGame.ts";
import { parseManifest, type AdapterManifest } from "../src/core/adapters/manifest.ts";
import { diagnoseGame, gatherDiagnosisInput, reportMarkdown, settingsOfAddonFile } from "../src/core/diagnose/index.ts";

export const USAGE = "사용법: npm run diagnose -- \"<게임 폴더>\" [--json]\n  게임 폴더(Game.exe가 있는 곳)를 읽기만 해서 진단 보고서를 찍어요.";

export type ParsedArgs = { ok: true; path: string; json: boolean } | { ok: false; message: string };

/** 명령줄 인자 → 게임 폴더 경로와 --json */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const rest: string[] = [];
  let json = false;
  for (const a of argv) {
    if (a === "--help" || a === "-h") return { ok: false, message: USAGE };
    if (a === "--json") json = true;
    else if (a.startsWith("--")) return { ok: false, message: `모르는 옵션이에요: ${a}\n${USAGE}` };
    else if (a.trim() !== "") rest.push(a);
  }
  if (rest.length === 0) return { ok: false, message: `게임 폴더 경로가 필요해요.\n${USAGE}` };
  if (rest.length > 1) return { ok: false, message: `게임 폴더는 하나만 줄 수 있어요(공백이 든 경로는 따옴표로 감싸세요).\n${USAGE}` };
  return { ok: true, path: rest[0], json };
}

/** 읽기 전용 게임 폴더(경로가 폴더 밖으로 나가면 없음으로 본다) */
export class NodeFolder implements GameFolder {
  private root: string;
  constructor(root: string) { this.root = path.resolve(root); }

  private resolve(rel: string): string | null {
    const segs = String(rel).replace(/\\/g, "/").split("/").filter((s) => s !== "" && s !== ".");
    if (segs.some((s) => s === ".." || s.includes(":"))) return null;
    const p = path.resolve(this.root, ...segs);
    const r = path.relative(this.root, p);
    return r === "" || (!r.startsWith("..") && !path.isAbsolute(r)) ? p : null;
  }

  async readText(rel: string): Promise<string | null> {
    const p = this.resolve(rel);
    if (!p) return null;
    try { return await fs.promises.readFile(p, "utf8"); } catch { return null; }
  }

  async readBinary(rel: string): Promise<ArrayBuffer | null> {
    const p = this.resolve(rel);
    if (!p) return null;
    try {
      const b = await fs.promises.readFile(p);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    } catch { return null; }
  }

  async list(dir: string): Promise<string[]> {
    const p = this.resolve(dir);
    if (!p) return [];
    try { return await fs.promises.readdir(p); } catch { return []; }
  }
}

const REPO_ADAPTERS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../adapters");

/** 저장소 adapters/*\/manifest.json */
export function readAdapterManifests(dir: string = REPO_ADAPTERS): AdapterManifest[] {
  const out: AdapterManifest[] = [];
  try {
    for (const name of fs.readdirSync(dir)) {
      try {
        const m = parseManifest(fs.readFileSync(path.join(dir, name, "manifest.json"), "utf8"));
        if (m && m.id === name) out.push(m);
      } catch { /* 건너뜀 */ }
    }
  } catch { /* 없음 */ }
  return out;
}

export interface MainDeps {
  log(s: string): void;
  error(s: string): void;
  isDir(p: string): boolean;
  openFolder(p: string): GameFolder;
  adapters(): AdapterManifest[];
}

const defaultDeps: MainDeps = {
  log: (s) => process.stdout.write(s.endsWith("\n") ? s : s + "\n"),
  error: (s) => process.stderr.write(s.endsWith("\n") ? s : s + "\n"),
  isDir: (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } },
  openFolder: (p) => new NodeFolder(p),
  adapters: () => readAdapterManifests(),
};

/** 진단을 돌린다. 돌려주는 값: 종료 코드(0 성공, 1 게임을 못 읽음, 2 인자 잘못) */
export async function main(argv: readonly string[], deps: Partial<MainDeps> = {}): Promise<number> {
  const d: MainDeps = { ...defaultDeps, ...deps };
  const args = parseArgs(argv);
  if (!args.ok) { d.error(args.message); return 2; }
  if (!d.isDir(args.path)) { d.error(`폴더가 없어요: ${args.path}\n경로를 확인하고 다시 실행하세요.`); return 1; }
  const folder = d.openFolder(args.path);
  const loaded = await loadGame(folder);
  if (!loaded.ok) {
    d.error(loaded.reason === "notFound"
      ? `RPG Maker 게임 데이터를 찾지 못했어요(찾아본 곳: ${loaded.searched.join(", ")}).`
      : `게임 데이터가 잠겨 있어요(${loaded.file}).`);
    return 1;
  }
  const input = await gatherDiagnosisInput(folder, loaded.data, { readLog: true });
  const report = diagnoseGame(loaded.data, input.pluginsText, input.files, input.log, {
    pluginSources: input.pluginSources, adapters: d.adapters(), settings: settingsOfAddonFile(input.addonFile),
  });
  d.log(args.json ? JSON.stringify(report, null, 2) : reportMarkdown(report));
  return 0;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  void main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
