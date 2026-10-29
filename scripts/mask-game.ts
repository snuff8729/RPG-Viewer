// 게임 폴더를 읽기만 해서 AI 에이전트용 "가린 사본"을 만든다. 게임은 절대 고치지 않는다.
// 사용: npm run mask -- "<게임 폴더>" --out "<빈 출력 폴더>" [--note "<문제 설명>"]
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadGame } from "../src/core/loader/loadGame.ts";
import { diagnoseGame, gatherDiagnosisInput, reportMarkdown, settingsOfAddonFile } from "../src/core/diagnose/index.ts";
import {
  buildFreeTextIndex, createMaskContext, keepWordsOf, maskFileName, maskFileText, maskFreeText, mirrorKindOf, scanFiles,
  type MaskContext, type MirrorKind, type ScanResult,
} from "../src/core/mask/index.ts";
import type { AdapterManifest } from "../src/core/adapters/manifest.ts";
import { NodeFolder, readAdapterManifests } from "./diagnose-game.ts";

export const USAGE = "사용법: npm run mask -- \"<게임 폴더>\" --out \"<빈 출력 폴더>\" [--note \"<문제 설명>\"]\n"
  + "  게임 폴더를 읽기만 해서, 게임 글을 T_로 시작하는 토큰으로 가린 사본을 출력 폴더에 만들어요(AI에게 줄 용도).";

export type ParsedArgs = { ok: true; path: string; out: string; note: string | null } | { ok: false; message: string };

/** 명령줄 인자 → 게임 폴더, --out, --note */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const rest: string[] = [];
  let out: string | null = null, note: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") return { ok: false, message: USAGE };
    if (a === "--out" || a === "--note") {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) return { ok: false, message: `${a} 뒤에 값이 필요해요.\n${USAGE}` };
      if (a === "--out") out = v; else note = v;
      i++;
    } else if (a.startsWith("--")) return { ok: false, message: `모르는 옵션이에요: ${a}\n${USAGE}` };
    else if (a.trim() !== "") rest.push(a);
  }
  if (rest.length === 0) return { ok: false, message: `게임 폴더 경로가 필요해요.\n${USAGE}` };
  if (rest.length > 1) return { ok: false, message: `게임 폴더는 하나만 줄 수 있어요(공백이 든 경로는 따옴표로 감싸세요).\n${USAGE}` };
  if (out === null || out.trim() === "") return { ok: false, message: `--out "<빈 출력 폴더>"가 필요해요.\n${USAGE}` };
  return { ok: true, path: rest[0], out, note };
}

/** a가 b 안(또는 같은 곳)인지 */
export function isInside(child: string, parent: string): boolean {
  const r = path.relative(path.resolve(parent), path.resolve(child));
  return r === "" || (!r.startsWith("..") && !path.isAbsolute(r));
}

export interface MirrorEntry { rel: string; maskedRel: string; kind: MirrorKind; text: string | null }

export interface MaskPass {
  ctx: MaskContext;
  entries: MirrorEntry[];
  /** 원래 게임으로 만든 진단 보고서(가리기 전). 게임을 못 읽으면 null */
  report: string | null;
  base: string;
}

const isFile = (p: string) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

/** 게임 폴더에서 옮길 파일(게임 루트 기준 `/` 경로)을 모은다. 심볼릭 링크는 따라가지 않는다. */
export function listMirrorFiles(root: string, base: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    let ents: fs.Dirent[];
    try { ents = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.isFile() && mirrorKindOf(r, base) !== null) out.push(r);
    }
  };
  const b = base ? `${base}/` : "";
  for (const f of ["package.json", "index.html", `${b}package.json`, `${b}index.html`]) {
    if (isFile(path.join(root, f)) && !out.includes(f)) out.push(f);
  }
  for (const d of ["data", "js", "rpg-viewer", "img", "audio", "movies"]) walk(`${b}${d}`);
  return out;
}

/**
 * 가리기 한 번: 모든 글 파일을 가리고(사전이 쌓인다), 원래 게임으로 진단 보고서를 만든다. 아무것도 쓰지 않는다.
 * 되돌리기(unmask)도 이걸 다시 돌려 사전을 얻는다.
 */
export async function runMaskPass(root: string, adapters: AdapterManifest[] = readAdapterManifests()): Promise<MaskPass> {
  const base = isFile(path.join(root, "www/data/System.json")) ? "www" : "";
  const ctx = createMaskContext();
  const entries: MirrorEntry[] = [];
  for (const rel of listMirrorFiles(root, base)) {
    const kind = mirrorKindOf(rel, base)!;
    const maskedRel = maskFileName(rel, ctx);
    if (kind === "placeholder") { entries.push({ rel, maskedRel, kind, text: null }); continue; }
    let text: string;
    try { text = fs.readFileSync(path.join(root, rel), "utf8"); } catch { continue; }
    entries.push({ rel, maskedRel, kind, text: maskFileText(kind, text, ctx).text });
  }
  return { ctx, entries, report: await diagnoseReport(root, adapters), base };
}

/** 폴더의 진단 보고서(마크다운). 게임을 못 읽으면 null */
export async function diagnoseReport(root: string, adapters: AdapterManifest[]): Promise<string | null> {
  const folder = new NodeFolder(root);
  const loaded = await loadGame(folder);
  if (!loaded.ok) return null;
  const input = await gatherDiagnosisInput(folder, loaded.data, { readLog: true });
  return reportMarkdown(diagnoseGame(loaded.data, input.pluginsText, input.files, input.log, {
    pluginSources: input.pluginSources, adapters, settings: settingsOfAddonFile(input.addonFile),
  }));
}

export const AI_README = `# AI-README — 가린 사본 / Masked mirror

이 폴더는 RPG Maker 게임의 **읽기 전용 가린 사본**입니다. 게임 원본은 다른 곳에 있고, 이 사본도 원본도 실행하거나 고치지 않습니다.
This folder is a **read-only masked mirror** of an RPG Maker game. The original game lives elsewhere; never run or edit either.

- \`T_\` + 16진수 14자리(예: \`T_0a1b2c3d4e5f60\`)는 **가려진 글**입니다. 같은 글이면 어디서나 같은 토큰입니다(데이터 JSON, 플러그인 JS, 파일 이름, 기록, 보고서).
  \`T_\` + 14 hex digits stands for **hidden text**. The same text always gets the same token everywhere (data JSON, plugin JS, file names, logs, report).
- 토큰의 원래 글을 알아내려고 하지 마세요. 토큰 그대로 다루면 됩니다.
  Do not try to recover the original text. Work with the tokens as-is.
- ASCII 식별자·숫자·경로·영어 코드는 그대로 남아 있어 흐름을 따라갈 수 있습니다. JS 파일의 줄 번호는 원본과 같습니다.
  ASCII identifiers, numbers, paths and English code are kept. Line numbers in JS files match the original.
- \`img/\`, \`audio/\`, \`movies/\` 아래 파일은 이름만 있는 **빈 파일**입니다.
  Files under \`img/\`, \`audio/\`, \`movies/\` are **empty placeholders** (names only).
- 게임은 절대 고치지 않습니다. 고칠 점은 RPG-Viewer 저장소(adapters/ 등)에 만들고, 그 안에 토큰을 써도 됩니다 — 사용자가 \`npm run unmask\`로 원래 글로 바꿉니다.
  The game is never edited. Put fixes in the RPG-Viewer repo (adapters/ etc.); they may reference tokens — the user converts them with \`npm run unmask\`.
- 문제 설명과 자동 진단 보고서는 \`REPORT.md\`에 있습니다. / The problem description and diagnosis report are in \`REPORT.md\`.
`;

export interface MaskSummary {
  textFiles: number;
  placeholders: number;
  tokens: number;
  replaced: number;
  jsFallbacks: number;
  collisions: number;
  scan: ScanResult;
}

/** 가린 사본을 out에 쓴다(out은 비어 있어야 한다). */
export async function writeMirror(pass: MaskPass, out: string, note: string | null, adapters: AdapterManifest[] = []): Promise<MaskSummary> {
  const index = buildFreeTextIndex(pass.ctx.dict);
  const written: { path: string; text: string }[] = [];
  const put = (rel: string, text: string) => {
    const p = path.join(out, ...rel.split("/"));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, "utf8");
    written.push({ path: rel, text });
  };
  let placeholders = 0;
  for (const e of pass.entries) {
    if (e.text === null) {
      const p = path.join(out, ...e.maskedRel.split("/"));
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, "");
      placeholders++;
    } else put(e.maskedRel, e.text);
  }
  const textFiles = written.length;
  put("AI-README.md", AI_README);
  // 가린 사본으로 다시 진단하면 게임 글은 이미 토큰이라, 거기 남은 한국어 낱말은 뷰어 자신의 문구다 — 그건 사전으로 바꾸지 않는다
  const keep = [...keepWordsOf(await diagnoseReport(out, adapters) ?? ""), ...keepWordsOf(AI_README)];
  const parts = ["# 문제와 진단 / Problem and diagnosis", ""];
  if (note !== null && note.trim() !== "") parts.push("## 사용자 설명 / User note", "", maskFreeText(note, index, pass.ctx, keep), "");
  parts.push("## 자동 진단 / Automatic diagnosis", "", pass.report === null ? "(게임을 읽지 못해 진단을 만들지 못했어요.)" : maskFreeText(pass.report, index, pass.ctx, keep));
  put("REPORT.md", parts.join("\n") + "\n");
  // 파일 이름도 검사한다
  const scan = scanFiles([...written, { path: "(file names)", text: pass.entries.map((e) => e.maskedRel).join("\n") }]);
  if (scan.count > 0) {
    const byFile = new Map<string, number[]>();
    for (const h of scan.hits) byFile.set(h.file, [...(byFile.get(h.file) ?? []), h.line]);
    const lines = ["# MASK-WARNINGS", "", "가리지 못한 낱말이 남은 자리(낱말은 적지 않음) / Locations where a listed word remains (words not shown):", ""];
    for (const [f, ls] of byFile) lines.push(`- \`${f}\`: ${ls.length}건, 줄 ${[...new Set(ls)].slice(0, 50).join(", ")}${ls.length > 50 ? " …" : ""}`);
    const p = path.join(out, "MASK-WARNINGS.md");
    fs.writeFileSync(p, lines.join("\n") + "\n", "utf8");
  }
  return {
    textFiles, placeholders, tokens: pass.ctx.dict.size, replaced: pass.ctx.replaced,
    jsFallbacks: pass.ctx.jsFallbacks, collisions: pass.ctx.collisions, scan,
  };
}

export interface MainDeps {
  log(s: string): void;
  error(s: string): void;
  adapters(): AdapterManifest[];
}

const defaultDeps: MainDeps = {
  log: (s) => process.stdout.write(s.endsWith("\n") ? s : s + "\n"),
  error: (s) => process.stderr.write(s.endsWith("\n") ? s : s + "\n"),
  adapters: () => readAdapterManifests(),
};

const isDir = (p: string) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

/** 돌려주는 값: 종료 코드(0 성공, 1 못 함, 2 사본은 만들었지만 남은 낱말이 있음) */
export async function main(argv: readonly string[], deps: Partial<MainDeps> = {}): Promise<number> {
  const d: MainDeps = { ...defaultDeps, ...deps };
  const args = parseArgs(argv);
  if (!args.ok) { d.error(args.message); return 1; }
  const game = path.resolve(args.path), out = path.resolve(args.out);
  if (!isDir(game)) { d.error(`게임 폴더가 없어요: ${args.path}`); return 1; }
  if (isInside(out, game)) { d.error("출력 폴더가 게임 폴더 안에 있어요. 게임 밖의 빈 폴더를 주세요."); return 1; }
  if (isInside(game, out)) { d.error("게임 폴더가 출력 폴더 안에 있어요. 다른 빈 폴더를 주세요."); return 1; }
  if (fs.existsSync(out)) {
    if (!isDir(out)) { d.error(`출력 경로가 폴더가 아니에요: ${args.out}`); return 1; }
    if (fs.readdirSync(out).length > 0) { d.error(`출력 폴더가 비어 있지 않아요: ${args.out}\n빈 폴더나 아직 없는 경로를 주세요.`); return 1; }
  }
  const pass = await runMaskPass(game, d.adapters());
  if (pass.report === null && !pass.entries.some((e) => e.kind === "json" && /(^|\/)data\/system\.json$/i.test(e.rel))) {
    d.error("RPG Maker 게임 데이터를 찾지 못했어요(www/data/System.json 또는 data/System.json).");
    return 1;
  }
  fs.mkdirSync(out, { recursive: true });
  const s = await writeMirror(pass, out, args.note, d.adapters());
  d.log([
    `가린 사본을 만들었어요: ${out}`,
    `- 글 파일 ${s.textFiles}개, 빈 자리 파일(그림·소리·영상) ${s.placeholders}개`,
    `- 토큰 ${s.tokens}종, 바꾼 곳 ${s.replaced}곳${s.jsFallbacks ? `, 줄 단위로 가린 JS ${s.jsFallbacks}개` : ""}${s.collisions ? `, 토큰 충돌 ${s.collisions}건` : ""}`,
    s.scan.count === 0
      ? "- 안전 검사: 남은 낱말 없음"
      : `- 안전 검사: 남은 낱말 ${s.scan.count}건(${new Set(s.scan.hits.map((h) => h.file)).size}개 파일) — MASK-WARNINGS.md에 위치만 적었어요.`,
  ].join("\n"));
  return s.scan.count === 0 ? 0 : 2;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  void main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
