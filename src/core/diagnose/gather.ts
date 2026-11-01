import { parseAddonFile, type AddonFile } from "../addons/settings";
import type { GameFolder } from "../fs/folder";
import { livePaths, PLUGIN_NAME } from "../live/installer";
import type { LogRecord } from "../live/types";
import type { GameData } from "../types";
import { enabledPluginsOf } from "../adapters/manifest";
import type { ImageListing } from "./types";

/** 진단에 쓰려고 게임 폴더에서 읽은 것(모두 글로만 읽는다 — 실행하지 않는다) */
export interface GatheredInput {
  pluginsText: string | null;
  /** 켜진 플러그인 이름 → 본문 */
  pluginSources: Record<string, string>;
  /** 그림 목록(img/pictures를 못 읽으면 null) */
  files: ImageListing | null;
  /** rpg-viewer/log.jsonl 기록(readLog일 때만, 없으면 null) */
  log: LogRecord[] | null;
  /** rpg-viewer/addons.json 설정(없으면 null) */
  addonFile: AddonFile | null;
}

/** 플러그인 본문은 이만큼까지, 이만큼 개수까지만 읽는다 */
export const PLUGIN_SOURCE_MAX = 3_000_000;
export const PLUGIN_COUNT_MAX = 400;
const PICTURE_MAX = 50_000;
const LOG_RECORDS_MAX = 300_000;
const IMAGE_EXT = /\.(png|png_|rpgmvp|webp|jpe?g)$/i;

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try { return await p; } catch { return fallback; }
}

/** img/pictures 아래 그림 이름(확장자 뺌). 확장자 없는 항목은 하위 폴더로 보고 두 단계까지 들어간다. 폴더가 없으면 null. */
export async function listPictures(folder: GameFolder, imgRoot: string): Promise<ImageListing | null> {
  const root = `${imgRoot}/pictures`;
  const top = await safe(folder.list(root), [] as string[]);
  if (top.length === 0) return null;
  const out: string[] = [];
  const walk = async (dir: string, prefix: string, names: string[], depth: number) => {
    for (const n of names) {
      if (out.length >= PICTURE_MAX) return;
      if (IMAGE_EXT.test(n)) out.push(prefix + n.replace(IMAGE_EXT, ""));
      else if (!n.includes(".") && depth < 2) {
        const sub = await safe(folder.list(`${dir}/${n}`), [] as string[]);
        if (sub.length > 0) await walk(`${dir}/${n}`, `${prefix}${n}/`, sub, depth + 1);
      }
    }
  };
  await walk(root, "", top, 0);
  // 다른 img/ 폴더(faces·characters 등, 한 단계 하위 폴더까지)의 그림 이름: 빠진 그림이 게임 어디에도 없는지 보려고
  const others = new Set<string>();
  const imgTop = await safe(folder.list(imgRoot), [] as string[]);
  const walkOther = async (dir: string, names: string[], depth: number) => {
    for (const n of names) {
      if (others.size >= PICTURE_MAX) return;
      if (IMAGE_EXT.test(n)) others.add(n.replace(IMAGE_EXT, ""));
      else if (!n.includes(".") && depth < 1) await walkOther(`${dir}/${n}`, await safe(folder.list(`${dir}/${n}`), [] as string[]), depth + 1);
    }
  };
  for (const d of imgTop) {
    if (d.includes(".") || d.toLowerCase() === "pictures") continue;
    await walkOther(`${imgRoot}/${d}`, await safe(folder.list(`${imgRoot}/${d}`), [] as string[]), 0);
  }
  return { pictures: [...new Set(out)], others: [...others] };
}

/** 기록 플러그인(1.31.0)이 복사해 둔 그림 이름(rpg-viewer/pictures 아래 .png, 확장자 뺌, 하위 폴더 두 단계까지). 없으면 빈 목록. */
export async function listPictureCopies(folder: GameFolder, logDir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, prefix: string, depth: number) => {
    for (const n of await safe(folder.list(dir), [] as string[])) {
      if (out.length >= PICTURE_MAX) return;
      if (/\.png$/i.test(n)) out.push(prefix + n.slice(0, -4));
      else if (!n.includes(".") && depth < 2) await walk(`${dir}/${n}`, `${prefix}${n}/`, depth + 1);
    }
  };
  await walk(`${logDir}/pictures`, "", 0);
  return out;
}

/** log.jsonl 본문 → 기록(못 읽는 줄은 버린다) */
export function parseLogText(text: string | null | undefined): LogRecord[] {
  const out: LogRecord[] = [];
  if (typeof text !== "string") return out;
  for (const line of text.split(/\r?\n/)) {
    if (out.length >= LOG_RECORDS_MAX) break;
    const t = line.trim();
    if (t === "" || t[0] !== "{") continue;
    try {
      const v = JSON.parse(t) as unknown;
      if (v && typeof v === "object" && (v as { v?: unknown }).v === 1 && typeof (v as { type?: unknown }).type === "string") out.push(v as LogRecord);
    } catch { /* 버림 */ }
  }
  return out;
}

/**
 * 진단 재료를 모은다: plugins.js, 켜진 플러그인 본문(js/plugins/<이름>.js), 그림 목록, (readLog면) 기록, 설정 파일.
 * 쓰지 않는다. 예외를 던지지 않는다.
 */
export async function gatherDiagnosisInput(
  folder: GameFolder, data: GameData, opts: { readLog?: boolean } = {},
): Promise<GatheredInput> {
  const out: GatheredInput = { pluginsText: null, pluginSources: {}, files: null, log: null, addonFile: null };
  try {
    const p = livePaths(data.dataRoot);
    out.pluginsText = await safe(folder.readText(p.pluginsJs), null);
    const names = enabledPluginsOf(out.pluginsText).filter(n => n !== PLUGIN_NAME && !n.startsWith(`${PLUGIN_NAME}_`)).slice(0, PLUGIN_COUNT_MAX);
    const base = p.base ? `${p.base}/` : "";
    for (const name of names) {
      if (!/^[^/\\:*?"<>|]+$/.test(name) || name.includes("..")) continue;
      const src = await safe(folder.readText(`${base}js/plugins/${name}.js`), null);
      if (typeof src === "string") out.pluginSources[name] = src.length > PLUGIN_SOURCE_MAX ? src.slice(0, PLUGIN_SOURCE_MAX) : src;
    }
    out.files = await safe(listPictures(folder, data.imgRoot), null);
    if (out.files) out.files.copies = await safe(listPictureCopies(folder, p.logDir), [] as string[]);
    out.addonFile = parseAddonFile(await safe(folder.readText(`${p.logDir}/addons.json`), null));
    if (opts.readLog) {
      const text = await safe(folder.readText(p.logFile), null);
      out.log = typeof text === "string" ? parseLogText(text) : null;
    }
  } catch { /* 모은 데까지 */ }
  return out;
}
