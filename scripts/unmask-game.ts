// 에이전트가 가린 사본을 보고 만든 저장소 파일(어댑터 등)의 토큰을 원래 게임 글로 바꾼다. 게임은 읽기만 한다.
// 사용: npm run unmask -- "<게임 폴더>" <파일...>
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildFreeTextIndex, maskFreeText, unmaskText } from "../src/core/mask/index.ts";
import { isInside, runMaskPass } from "./mask-game.ts";

export const USAGE = "사용법: npm run unmask -- \"<게임 폴더>\" <파일...>\n"
  + "  파일 속 T_ 토큰을 그 게임의 원래 글로 바꿔요(파일을 그 자리에서 고침). 바뀐 내용은 화면에 찍지 않아요.";

export type ParsedArgs = { ok: true; game: string; files: string[] } | { ok: false; message: string };

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const rest: string[] = [];
  for (const a of argv) {
    if (a === "--help" || a === "-h") return { ok: false, message: USAGE };
    if (a.startsWith("--")) return { ok: false, message: `모르는 옵션이에요: ${a}\n${USAGE}` };
    if (a.trim() !== "") rest.push(a);
  }
  if (rest.length < 2) return { ok: false, message: `게임 폴더와 바꿀 파일이 필요해요.\n${USAGE}` };
  return { ok: true, game: rest[0], files: rest.slice(1) };
}

export interface MainDeps { log(s: string): void; error(s: string): void }
const defaultDeps: MainDeps = {
  log: (s) => process.stdout.write(s.endsWith("\n") ? s : s + "\n"),
  error: (s) => process.stderr.write(s.endsWith("\n") ? s : s + "\n"),
};

/** 돌려주는 값: 0 성공, 1 못 함 */
export async function main(argv: readonly string[], deps: Partial<MainDeps> = {}): Promise<number> {
  const d: MainDeps = { ...defaultDeps, ...deps };
  const args = parseArgs(argv);
  if (!args.ok) { d.error(args.message); return 1; }
  const game = path.resolve(args.game);
  try { if (!fs.statSync(game).isDirectory()) throw new Error(); } catch { d.error(`게임 폴더가 없어요: ${args.game}`); return 1; }
  for (const f of args.files) {
    if (isInside(f, game)) { d.error(`게임 폴더 안의 파일은 고치지 않아요: ${f}`); return 1; }
    try { if (!fs.statSync(f).isFile()) throw new Error(); } catch { d.error(`파일이 없어요: ${f}`); return 1; }
  }
  const pass = await runMaskPass(game);
  // 보고서에서만 생긴 토큰도 되돌릴 수 있게 같은 방법으로 사전에 더한다
  if (pass.report !== null) maskFreeText(pass.report, buildFreeTextIndex(pass.ctx.dict), pass.ctx);
  let replaced = 0, changed = 0;
  const unknown = new Set<string>();
  for (const f of args.files) {
    const text = fs.readFileSync(f, "utf8");
    const r = unmaskText(text, pass.ctx.dict);
    r.unknown.forEach((t) => unknown.add(t));
    if (r.replaced > 0) { fs.writeFileSync(f, r.text, "utf8"); changed++; replaced += r.replaced; }
  }
  d.log(`토큰 ${replaced}곳을 원래 글로 바꿨어요(파일 ${changed}/${args.files.length}개).`
    + (unknown.size > 0 ? ` 이 게임에서 찾지 못한 토큰 ${unknown.size}종은 그대로 두었어요.` : ""));
  return 0;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  void main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
