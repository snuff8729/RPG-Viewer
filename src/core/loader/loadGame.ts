import type { GameFolder } from "@/core/fs/folder";
import type {
  Actor, CommonEvent, GameData, LoadError, MapData, MapInfo, NamedEntry, SystemData, Troop,
} from "@/core/types";

export type LoadResult =
  | { ok: true; data: GameData }
  | { ok: false; reason: "notFound"; searched: string[] }
  | { ok: false; reason: "encrypted"; file: string };

const ROOTS = [
  { data: "www/data", img: "www/img" },
  { data: "data", img: "img" },
];

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

  async function readJson(file: string, mapId?: number): Promise<unknown | undefined> {
    try {
      const text = await folder.readText(file);
      if (text === null) throw new Error("파일을 찾을 수 없습니다");
      return JSON.parse(text.replace(/^\uFEFF/, ""));
    } catch (e) {
      errors.push(mapId === undefined ? { file, message: errMessage(e) } : { file, message: errMessage(e), mapId });
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

  const maps = new Map<number, MapData>();
  for (const info of mapInfos) {
    if (!info || typeof info.id !== "number") continue;
    const file = `${root.data}/Map${String(info.id).padStart(3, "0")}.json`;
    const v = await readJson(file, info.id);
    if (v === undefined) continue;
    if (v === null || typeof v !== "object" || !Array.isArray((v as MapData).events)) {
      errors.push({ file, message: "맵 데이터 형식이 올바르지 않습니다", mapId: info.id });
      continue;
    }
    maps.set(info.id, v as MapData);
  }

  return {
    ok: true,
    data: {
      engine: system.advanced !== undefined ? "MZ" : "MV",
      dataRoot: root.data,
      imgRoot: root.img,
      system, mapInfos, maps, commonEvents, troops, actors, items, weapons, armors, errors,
    },
  };
}
