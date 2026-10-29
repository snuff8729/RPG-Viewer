import type { GameFolder, WritableGameFolder } from "../fs/folder";
import { PLUGIN_NAME, formatPluginsJs, livePaths, parsePluginsJs, type InstallResult, type PluginEntry } from "../live/installer";
import { resolveTokensFromGame } from "../mask/dictionary";
import { adapterPluginName } from "./manifest";

/**
 * 게임 쪽 확장(adapters/<id>/bridge.js) 설치: js/plugins/RPGViewerBridge_<id>.js를 쓰고 plugins.js에서 기록 플러그인
 * (RPGViewerBridge) 바로 뒤에 넣는다(기록 플러그인이 없으면 끝에 — 기록 플러그인이 나중에 설치되면 그 앞에 들어간다).
 * plugins.js를 처음 바꿀 때 rpg-viewer/plugins.js.bak을 남긴다(기록 플러그인 설치와 같은 파일, 이미 있으면 그대로).
 * 본문의 가린 글 토큰(T_…, 가린 사본을 보고 만든 어댑터)은 설치할 때 이 게임의 원래 글로 바꾼다.
 * 모두 예외를 던지지 않는다.
 */
const UNSUPPORTED = "이 게임은 자동 설치를 지원하지 않아요";
const NO_WRITE = "쓰기 권한이 필요해요";

export const adapterPluginFile = (dataRoot: string, id: string): string => {
  const base = livePaths(dataRoot).base;
  const p = `js/plugins/${adapterPluginName(id)}.js`;
  return base ? `${base}/${p}` : p;
};

export type AdapterInstallStatus =
  | { state: "unsupported" }
  | { state: "notInstalled" }
  /** outdated: 설치된 파일이 뷰어에 든 것과 다름 */
  | { state: "installed"; outdated: boolean };

/** plugins.js 항목들에 확장 항목을 넣는다(있으면 켜기만, 없으면 기록 플러그인 바로 뒤나 끝에) */
export function withAdapterEntry(entries: PluginEntry[], id: string, label: string): PluginEntry[] {
  const name = adapterPluginName(id);
  const out = entries.slice();
  const i = out.findIndex(e => e && e.name === name);
  if (i >= 0) { out[i] = { ...out[i], status: true }; return out; }
  const entry: PluginEntry = { name, status: true, description: `RPG Viewer 게임 전용 확장: ${label}`, parameters: {} };
  const main = out.findIndex(e => e && e.name === PLUGIN_NAME);
  if (main < 0) { out.push(entry); return out; }
  // 기록 플러그인 뒤의 다른 확장들 다음에(설치 순서대로)
  let at = main + 1;
  while (at < out.length && typeof out[at]?.name === "string" && out[at].name.startsWith(`${PLUGIN_NAME}_`)) at++;
  out.splice(at, 0, entry);
  return out;
}

/** unknownTokens: 이 게임에서 원래 글을 찾지 못해 그대로 둔 토큰 종류 수(있을 때만) */
export type AdapterInstallResult = { ok: true; unknownTokens?: number } | { ok: false; message: string };

/** 설치는 했지만 이 게임에서 찾지 못한 토큰이 남았을 때 알릴 글 */
export const unknownTokensNote = (n: number): string =>
  `확장 안의 가린 글(T_로 시작) ${n}종을 이 게임에서 찾지 못해 그대로 두었어요. 다른 게임의 사본으로 만든 것일 수 있어요 — 잘 안 되면 AI에게 알려 주세요.`;

export async function getAdapterInstallStatus(folder: GameFolder, dataRoot: string, id: string, source: string): Promise<AdapterInstallStatus> {
  try {
    const text = await folder.readText(livePaths(dataRoot).pluginsJs);
    const entries = text === null ? null : parsePluginsJs(text);
    if (!entries) return { state: "unsupported" };
    if (!entries.some(e => e && e.name === adapterPluginName(id) && e.status === true)) return { state: "notInstalled" };
    const src = await folder.readText(adapterPluginFile(dataRoot, id));
    if (src === null) return { state: "notInstalled" };
    const norm = (s: string) => s.replace(/\r\n/g, "\n");
    const want = (await resolveTokensFromGame(folder, dataRoot, source)).text;
    return { state: "installed", outdated: norm(src) !== norm(want) };
  } catch {
    return { state: "unsupported" };
  }
}

export async function installAdapter(folder: WritableGameFolder, dataRoot: string, id: string, label: string, source: string): Promise<AdapterInstallResult> {
  try {
    const p = livePaths(dataRoot);
    const original = await folder.readText(p.pluginsJs);
    const entries = original === null ? null : parsePluginsJs(original);
    if (original === null || !entries) return { ok: false, message: UNSUPPORTED };
    const fail = { ok: false, message: NO_WRITE } as const;
    if ((await folder.stat(p.backupFile)) === null && !(await folder.writeText(p.backupFile, original))) return fail;
    const resolved = await resolveTokensFromGame(folder, dataRoot, source);
    if (!(await folder.writeText(adapterPluginFile(dataRoot, id), resolved.text))) return fail;
    if (!(await folder.writeText(p.pluginsJs, formatPluginsJs(withAdapterEntry(entries, id, label))))) return fail;
    return resolved.unknown.length > 0 ? { ok: true, unknownTokens: resolved.unknown.length } : { ok: true };
  } catch {
    return { ok: false, message: NO_WRITE };
  }
}

export async function uninstallAdapter(folder: WritableGameFolder, dataRoot: string, id: string): Promise<InstallResult> {
  try {
    const p = livePaths(dataRoot);
    const text = await folder.readText(p.pluginsJs);
    const entries = text === null ? null : parsePluginsJs(text);
    if (text === null || !entries) return { ok: false, message: UNSUPPORTED };
    const name = adapterPluginName(id);
    if (entries.some(e => e && e.name === name)) {
      if ((await folder.stat(p.backupFile)) === null && !(await folder.writeText(p.backupFile, text))) return { ok: false, message: NO_WRITE };
      if (!(await folder.writeText(p.pluginsJs, formatPluginsJs(entries.filter(e => !e || e.name !== name))))) return { ok: false, message: NO_WRITE };
    }
    const file = adapterPluginFile(dataRoot, id);
    if ((await folder.stat(file)) !== null && !(await folder.remove(file))) return { ok: false, message: NO_WRITE };
    return { ok: true };
  } catch {
    return { ok: false, message: NO_WRITE };
  }
}
