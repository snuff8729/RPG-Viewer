import type { GameFolder } from "@/core/fs/folder";
import type {
  Actor, CommonEvent, GameData, LoadError, MapData, MapInfo, NamedEntry, SystemData, Troop,
} from "@/core/types";
import { livePaths } from "@/core/live/installer";
import { expandTemplateEvents, templateMapIdFromPlugins } from "./templateEvent";

export type LoadResult =
  | { ok: true; data: GameData }
  | { ok: false; reason: "notFound"; searched: string[] }
  | { ok: false; reason: "encrypted"; file: string };

const ROOTS = [
  { data: "www/data", img: "www/img" },
  { data: "data", img: "img" },
];

const MAP_CONCURRENCY = 8;

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function loadGame(folder: GameFolder): Promise<LoadResult> {
  const searched = ROOTS.map((r) => `${r.data}/System.json`);
  let root: (typeof ROOTS)[number] | null = null;
  let systemText: string | null = null;
  for (const r of ROOTS) {
    let text: string | null = null;
    try { text = await folder.readText(`${r.data}/System.json`); } catch { text = null; }
    if (text !== null) { root = r; systemText = text; break; }
  }
  if (!root || systemText === null) return { ok: false, reason: "notFound", searched };

  const systemFile = `${root.data}/System.json`;
  const head = systemText.replace(/^\uFEFF/, "").trimStart()[0];
  if (head !== "{" && head !== "[") return { ok: false, reason: "encrypted", file: systemFile };

  const errors: LoadError[] = [];
  let system: SystemData;
  try {
    const parsed = JSON.parse(systemText.replace(/^\uFEFF/, ""));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("System.json은 객체여야 합니다");
    system = parsed as SystemData;
  } catch (e) {
    errors.push({ file: systemFile, message: errMessage(e) });
    system = { gameTitle: "", currencyUnit: "", switches: [], variables: [] };
  }

  async function readJson(file: string): Promise<unknown | undefined> {
    try {
      const text = await folder.readText(file);
      if (text === null) throw new Error("파일을 찾을 수 없습니다");
      return JSON.parse(text.replace(/^\uFEFF/, ""));
    } catch (e) {
      errors.push({ file, message: errMessage(e) });
      return undefined;
    }
  }
  async function readList<T>(name: string): Promise<(T | null)[]> {
    const v = await readJson(`${root!.data}/${name}.json`);
    if (v === undefined) return [null];
    if (!Array.isArray(v)) {
      errors.push({ file: `${root!.data}/${name}.json`, message: "배열이 아닙니다" });
      return [null];
    }
    return v as (T | null)[];
  }

  const mapInfos = await readList<MapInfo>("MapInfos");
  const commonEvents = await readList<CommonEvent>("CommonEvents");
  const troops = await readList<Troop>("Troops");
  const actors = await readList<Actor>("Actors");
  const items = await readList<NamedEntry>("Items");
  const weapons = await readList<NamedEntry>("Weapons");
  const armors = await readList<NamedEntry>("Armors");

  // 맵은 동시에 최대 MAP_CONCURRENCY개씩 읽는다. 결과는 MapInfos 순서로, 오류는 mapId 순으로 모은다.
  const mapIds = mapInfos
    .filter((info): info is MapInfo => !!info && typeof info === "object" && typeof info.id === "number")
    .map((info) => info.id);
  const loaded: (MapData | undefined)[] = new Array(mapIds.length);
  const mapErrors: LoadError[] = [];
  const mapFile = (id: number) => `${root!.data}/Map${String(id).padStart(3, "0")}.json`;
  async function loadMap(id: number, mapErrors: LoadError[]): Promise<MapData | undefined> {
    const file = mapFile(id);
    let v: unknown;
    try {
      const text = await folder.readText(file);
      if (text === null) throw new Error("파일을 찾을 수 없습니다");
      v = JSON.parse(text.replace(/^﻿/, ""));
    } catch (e) {
      mapErrors.push({ file, message: errMessage(e), mapId: id });
      return undefined;
    }
    if (v === null || typeof v !== "object" || !Array.isArray((v as MapData).events)) {
      mapErrors.push({ file, message: "맵 데이터 형식이 올바르지 않습니다", mapId: id });
      return undefined;
    }
    const m = v as MapData;
    // 타일 데이터(data) 등은 버리고 필요한 필드만 보관한다.
    return { displayName: typeof m.displayName === "string" ? m.displayName : "", events: m.events };
  }
  let next = 0;
  const worker = async () => {
    while (next < mapIds.length) {
      const i = next++;
      loaded[i] = await loadMap(mapIds[i], mapErrors).catch(() => undefined);
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAP_CONCURRENCY, mapIds.length) }, worker));
  const maps = new Map<number, MapData>();
  mapIds.forEach((id, i) => { const m = loaded[i]; if (m) maps.set(id, m); });
  errors.push(...mapErrors.sort((a, b) => (a.mapId ?? 0) - (b.mapId ?? 0)));

  // TemplateEvent 플러그인: <TE:값> 이벤트의 페이지를 템플릿 맵 이벤트의 페이지로 바꾼다.
  let templateMapId: number | undefined;
  try {
    let pluginsText: string | null = null;
    try { pluginsText = await folder.readText(livePaths(root.data).pluginsJs); } catch { pluginsText = null; }
    const tplId = templateMapIdFromPlugins(pluginsText);
    if (tplId !== null) {
      // MapInfos에 있으면 이미 읽은 것을 쓰고(실패했으면 건너뜀), 없으면 파일을 조용히 읽어 본다.
      const tplMap = mapIds.includes(tplId) ? maps.get(tplId) : await loadMap(tplId, []).catch(() => undefined);
      if (tplMap) {
        errors.push(...expandTemplateEvents(maps, tplMap, tplId, mapFile));
        templateMapId = tplId;
      }
    }
  } catch {
    /* 템플릿을 풀지 못하면 그대로 둔다 */
  }

  return {
    ok: true,
    data: {
      engine: system.advanced !== undefined ? "MZ" : "MV",
      dataRoot: root.data,
      imgRoot: root.img,
      system, mapInfos, maps, commonEvents, troops, actors, items, weapons, armors, errors,
      ...(templateMapId !== undefined ? { templateMapId } : {}),
    },
  };
}
