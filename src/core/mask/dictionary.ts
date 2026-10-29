// 열린 게임에서 토큰 → 원래 글 사전을 만든다(가린 사본과 같은 파일·같은 규칙). 어댑터의 bridge.js처럼 에이전트가
// 가린 사본만 보고 토큰으로 쓴 글을 설치할 때 원래 글로 되돌리는 데 쓴다. 토큰은 글의 해시라 사전에 남는 것이 더 있어도 틀리지 않는다.
// 필요한 토큰을 다 찾으면 거기서 멈추고, 폴더마다 진행을 기억해 다음 요청은 이어서 찾는다. 예외를 던지지 않는다.
import type { GameFolder } from "../fs/folder";
import { maskFileText, mirrorKindOf } from "./files";
import { createMaskContext, maskFileName, type MaskContext } from "./text";
import { TOKEN_PATTERN } from "./token";

/** dataRoot("www/data", "data") → 바탕 폴더("www", "") */
const baseOf = (dataRoot: string) => dataRoot.split("/").filter((s) => s !== "" && s !== ".").slice(0, -1).join("/");

/** 사전에 넣을 것들을 하나씩: 싼 것(파일 이름·plugins.js·System.json)부터 */
async function* feed(folder: GameFolder, dataRoot: string, ctx: MaskContext): AsyncGenerator<void> {
  const base = baseOf(dataRoot);
  const b = base ? `${base}/` : "";
  const list = async (dir: string) => { try { return await folder.list(dir); } catch { return []; } };
  const read = async (rel: string) => { try { return await folder.readText(rel); } catch { return null; } };
  const maskFile = async (rel: string) => {
    const kind = mirrorKindOf(rel, base);
    maskFileName(rel, ctx);
    if (kind === null || kind === "placeholder") return;
    const text = await read(rel);
    if (text !== null) maskFileText(kind, text, ctx);
  };
  const plugins = (await list(`${b}js/plugins`)).filter((n) => n.toLowerCase().endsWith(".js")).map((n) => `${b}js/plugins/${n}`);
  for (const p of plugins) maskFileName(p, ctx);
  yield;
  await maskFile(`${b}js/plugins.js`);
  yield;
  const data = (await list(`${b}data`)).filter((n) => n.toLowerCase().endsWith(".json")).map((n) => `${b}data/${n}`);
  data.sort((x, y) => Number(!/system\.json$/i.test(x)) - Number(!/system\.json$/i.test(y)));
  for (const d of data) { await maskFile(d); yield; }
  for (const p of plugins) { await maskFile(p); yield; }
  for (const f of ["package.json", "index.html", `${b}package.json`, `${b}index.html`]) await maskFile(f);
  yield;
  // 그림·소리·영상: 이름만. 확장자가 없으면 폴더로 보고 들어가 본다(비었으면 파일 이름으로 셈).
  const walk = async function* (dir: string, depth: number): AsyncGenerator<void> {
    for (const n of await list(dir)) {
      const rel = `${dir}/${n}`;
      if (!/\.[A-Za-z0-9_]{1,8}$/.test(n) && depth < 8) {
        const sub = await list(rel);
        if (sub.length > 0) { yield* walk(rel, depth + 1); continue; }
      }
      maskFileName(rel, ctx);
    }
    yield;
  };
  for (const d of ["img", "audio", "movies"]) yield* walk(`${b}${d}`, 0);
  for (const f of ["log.jsonl", "live.json", "addons.json", "meta.json"]) { await maskFile(`${b}rpg-viewer/${f}`); yield; }
}

interface Progress { ctx: MaskContext; it: AsyncGenerator<void>; done: boolean }
const progress = new WeakMap<GameFolder, Map<string, Progress>>();

/** 글에 든 토큰(중복 없이) */
export function tokensIn(text: string): string[] {
  return typeof text === "string" ? [...new Set(text.match(TOKEN_PATTERN) ?? [])] : [];
}

/**
 * 이 게임에서 want 토큰들의 원래 글을 찾는다(찾은 것만 담은 사전). 다 찾으면 바로 멈춘다.
 * 같은 폴더를 다시 부르면 이어서 찾는다.
 */
export async function findTokenOriginals(folder: GameFolder, dataRoot: string, want: Iterable<string>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const wanted = [...new Set(want)];
    if (wanted.length === 0 || !folder) return out;
    let byRoot = progress.get(folder);
    if (!byRoot) { byRoot = new Map(); progress.set(folder, byRoot); }
    const p = byRoot.get(dataRoot) ?? (() => {
      const ctx = createMaskContext();
      const np: Progress = { ctx, it: feed(folder, dataRoot, ctx), done: false };
      byRoot.set(dataRoot, np);
      return np;
    })();
    const missing = () => wanted.some((t) => !p.ctx.dict.has(t));
    while (!p.done && missing()) {
      const r = await p.it.next();
      if (r.done) p.done = true;
    }
    for (const t of wanted) { const o = p.ctx.dict.get(t); if (o !== undefined) out.set(t, o); }
  } catch { /* 찾은 데까지 */ }
  return out;
}

export interface ResolvedTokens { text: string; replaced: number; unknown: string[] }

/** 글 속 토큰을 이 게임의 원래 글로 바꾼다. 못 찾은 토큰은 그대로 두고 알린다. 토큰이 없으면 게임을 읽지 않는다. */
export async function resolveTokensFromGame(folder: GameFolder, dataRoot: string, text: string): Promise<ResolvedTokens> {
  const want = tokensIn(text);
  if (want.length === 0) return { text, replaced: 0, unknown: [] };
  const dict = await findTokenOriginals(folder, dataRoot, want);
  let replaced = 0;
  const out = text.replace(TOKEN_PATTERN, (t) => {
    const o = dict.get(t);
    if (o === undefined) return t;
    replaced++;
    return o;
  });
  return { text: out, replaced, unknown: want.filter((t) => !dict.has(t)) };
}
