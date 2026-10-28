// RPG Maker MV/MZ Tilemap(rpg_core.js / rmmz_core.js) 타일 그리기 규칙 포팅. DOM 없음, 예외 없음.
import type { GameFolder } from "@/core/fs/folder";
import type { GameData } from "@/core/types";

export interface TilesetInfo { id: number; mode: number; names: string[] /* 9: A1..A5,B,C,D,E */; flags: number[] }
export interface MapTiles { mapId: number; width: number; height: number; tilesetId: number; data: number[] /* width*height*6 */ }
/** sheet: tileset.names 인덱스(0..8). -1 = 그림자(반투명 검정 사각형, sx/sy 무시). */
export interface DrawOp { sheet: number; sx: number; sy: number; dx: number; dy: number; w: number; h: number }

export const TILE_ID_B = 0;
export const TILE_ID_C = 256;
export const TILE_ID_D = 512;
export const TILE_ID_E = 768;
export const TILE_ID_A5 = 1536;
export const TILE_ID_A1 = 2048;
export const TILE_ID_A2 = 2816;
export const TILE_ID_A3 = 4352;
export const TILE_ID_A4 = 5888;
export const TILE_ID_MAX = 8192;

type Quarter = readonly [number, number];
type QuarterSet = readonly [Quarter, Quarter, Quarter, Quarter];

// prettier-ignore
export const FLOOR_AUTOTILE_TABLE: readonly QuarterSet[] = [
  [[2,4],[1,4],[2,3],[1,3]],[[2,0],[1,4],[2,3],[1,3]],
  [[2,4],[3,0],[2,3],[1,3]],[[2,0],[3,0],[2,3],[1,3]],
  [[2,4],[1,4],[2,3],[3,1]],[[2,0],[1,4],[2,3],[3,1]],
  [[2,4],[3,0],[2,3],[3,1]],[[2,0],[3,0],[2,3],[3,1]],
  [[2,4],[1,4],[2,1],[1,3]],[[2,0],[1,4],[2,1],[1,3]],
  [[2,4],[3,0],[2,1],[1,3]],[[2,0],[3,0],[2,1],[1,3]],
  [[2,4],[1,4],[2,1],[3,1]],[[2,0],[1,4],[2,1],[3,1]],
  [[2,4],[3,0],[2,1],[3,1]],[[2,0],[3,0],[2,1],[3,1]],
  [[0,4],[1,4],[0,3],[1,3]],[[0,4],[3,0],[0,3],[1,3]],
  [[0,4],[1,4],[0,3],[3,1]],[[0,4],[3,0],[0,3],[3,1]],
  [[2,2],[1,2],[2,3],[1,3]],[[2,2],[1,2],[2,3],[3,1]],
  [[2,2],[1,2],[2,1],[1,3]],[[2,2],[1,2],[2,1],[3,1]],
  [[2,4],[3,4],[2,3],[3,3]],[[2,4],[3,4],[2,1],[3,3]],
  [[2,0],[3,4],[2,3],[3,3]],[[2,0],[3,4],[2,1],[3,3]],
  [[2,4],[1,4],[2,5],[1,5]],[[2,0],[1,4],[2,5],[1,5]],
  [[2,4],[3,0],[2,5],[1,5]],[[2,0],[3,0],[2,5],[1,5]],
  [[0,4],[3,4],[0,3],[3,3]],[[2,2],[1,2],[2,5],[1,5]],
  [[0,2],[1,2],[0,3],[1,3]],[[0,2],[1,2],[0,3],[3,1]],
  [[2,2],[3,2],[2,3],[3,3]],[[2,2],[3,2],[2,1],[3,3]],
  [[2,4],[3,4],[2,5],[3,5]],[[2,0],[3,4],[2,5],[3,5]],
  [[0,4],[1,4],[0,5],[1,5]],[[0,4],[3,0],[0,5],[1,5]],
  [[0,2],[3,2],[0,3],[3,3]],[[0,2],[1,2],[0,5],[1,5]],
  [[0,4],[3,4],[0,5],[3,5]],[[2,2],[3,2],[2,5],[3,5]],
  [[0,2],[3,2],[0,5],[3,5]],[[0,0],[1,0],[0,1],[1,1]],
];

// prettier-ignore
export const WALL_AUTOTILE_TABLE: readonly QuarterSet[] = [
  [[2,2],[1,2],[2,1],[1,1]],[[0,2],[1,2],[0,1],[1,1]],
  [[2,0],[1,0],[2,1],[1,1]],[[0,0],[1,0],[0,1],[1,1]],
  [[2,2],[3,2],[2,1],[3,1]],[[0,2],[3,2],[0,1],[3,1]],
  [[2,0],[3,0],[2,1],[3,1]],[[0,0],[3,0],[0,1],[3,1]],
  [[2,2],[1,2],[2,3],[1,3]],[[0,2],[1,2],[0,3],[1,3]],
  [[2,0],[1,0],[2,3],[1,3]],[[0,0],[1,0],[0,3],[1,3]],
  [[2,2],[3,2],[2,3],[3,3]],[[0,2],[3,2],[0,3],[3,3]],
  [[2,0],[3,0],[2,3],[3,3]],[[0,0],[3,0],[0,3],[3,3]],
];

// prettier-ignore
export const WATERFALL_AUTOTILE_TABLE: readonly QuarterSet[] = [
  [[2,0],[1,0],[2,1],[1,1]],[[0,0],[1,0],[0,1],[1,1]],
  [[2,0],[3,0],[2,1],[3,1]],[[0,0],[3,0],[0,1],[3,1]],
];

export function tileSize(_engine: "MV" | "MZ"): number {
  return 48;
}

export const isVisibleTile = (id: number): boolean => id > 0 && id < TILE_ID_MAX;
export const isAutotile = (id: number): boolean => id >= TILE_ID_A1;
export const getAutotileKind = (id: number): number => Math.floor((id - TILE_ID_A1) / 48);
export const getAutotileShape = (id: number): number => (id - TILE_ID_A1) % 48;
export const makeAutotileId = (kind: number, shape: number): number => TILE_ID_A1 + kind * 48 + shape;
export const isTileA1 = (id: number): boolean => id >= TILE_ID_A1 && id < TILE_ID_A2;
export const isTileA2 = (id: number): boolean => id >= TILE_ID_A2 && id < TILE_ID_A3;
export const isTileA3 = (id: number): boolean => id >= TILE_ID_A3 && id < TILE_ID_A4;
export const isTileA4 = (id: number): boolean => id >= TILE_ID_A4 && id < TILE_ID_MAX;
export const isTileA5 = (id: number): boolean => id >= TILE_ID_A5 && id < TILE_ID_A1;
export const isWaterfallTile = (id: number): boolean =>
  id >= TILE_ID_A1 + 192 && id < TILE_ID_A2 && getAutotileKind(id) % 2 === 1;
/** 탁자 타일: A2 + 카운터 플래그(0x80). 표 윗면만 그리고 엔진의 탁자 다리(edge) 그리기는 생략한다. */
export const isTableTile = (id: number, flags: readonly number[]): boolean =>
  isTileA2(id) && ((flags[id] ?? 0) & 0x80) !== 0;

function normalTileOps(id: number, dx: number, dy: number, size: number): DrawOp[] {
  const sheet = isTileA5(id) ? 4 : 5 + Math.floor(id / 256);
  const sx = ((Math.floor(id / 128) % 2) * 8 + (id % 8)) * size;
  const sy = (Math.floor((id % 256) / 8) % 16) * size;
  return [{ sheet, sx, sy, dx, dy, w: size, h: size }];
}

function autotileOps(id: number, dx: number, dy: number, size: number): DrawOp[] {
  let table: readonly QuarterSet[] = FLOOR_AUTOTILE_TABLE;
  const kind = getAutotileKind(id);
  const shape = getAutotileShape(id);
  const tx = kind % 8;
  const ty = Math.floor(kind / 8);
  let bx = 0;
  let by = 0;
  let sheet = 0;
  // 애니메이션 프레임 0 고정: waterSurfaceIndex = [0,1,2,1][0] = 0, 폭포 by += 0.
  const waterSurfaceIndex = 0;
  if (isTileA1(id)) {
    sheet = 0;
    if (kind === 0) { bx = waterSurfaceIndex * 2; by = 0; }
    else if (kind === 1) { bx = waterSurfaceIndex * 2; by = 3; }
    else if (kind === 2) { bx = 6; by = 0; }
    else if (kind === 3) { bx = 6; by = 3; }
    else {
      bx = Math.floor(tx / 4) * 8;
      by = ty * 6 + (Math.floor(tx / 2) % 2) * 3;
      if (kind % 2 === 0) bx += waterSurfaceIndex * 2;
      else { bx += 6; table = WATERFALL_AUTOTILE_TABLE; }
    }
  } else if (isTileA2(id)) {
    sheet = 1; bx = tx * 2; by = (ty - 2) * 3;
  } else if (isTileA3(id)) {
    sheet = 2; bx = tx * 2; by = (ty - 6) * 2; table = WALL_AUTOTILE_TABLE;
  } else if (isTileA4(id)) {
    sheet = 3; bx = tx * 2; by = Math.floor((ty - 10) * 2.5 + (ty % 2 === 1 ? 0.5 : 0));
    if (ty % 2 === 1) table = WALL_AUTOTILE_TABLE;
  }
  const quarters = table[shape];
  if (!quarters) return [];
  const w1 = size / 2;
  const h1 = size / 2;
  return quarters.map(([qsx, qsy], i) => ({
    sheet,
    sx: (bx * 2 + qsx) * w1,
    sy: (by * 2 + qsy) * h1,
    dx: dx + (i % 2) * w1,
    dy: dy + Math.floor(i / 2) * h1,
    w: w1,
    h: h1,
  }));
}

/**
 * 타일 하나의 그리기 명령. x, y는 맵 칸 좌표, size는 칸 픽셀 크기(원본 시트와 같은 48을 권장).
 * sx/sy도 size 단위로 계산하므로 시트 원본 크기로 그리려면 size = tileSize(engine).
 * mapData는 계약상 받지만(탁자 다리 등) 현재 쓰지 않는다.
 */
export function drawOpsForTile(
  tileId: number, x: number, y: number, size: number, _tileset: TilesetInfo, _mapData?: MapTiles,
): DrawOp[] {
  if (!Number.isInteger(tileId) || !isVisibleTile(tileId)) return [];
  const dx = x * size;
  const dy = y * size;
  return isAutotile(tileId) ? autotileOps(tileId, dx, dy, size) : normalTileOps(tileId, dx, dy, size);
}

/** 그림자 레이어(z=4)의 하위 4비트 → 반 칸 크기 검은 사각형(sheet -1). */
export function shadowOps(bits: number, x: number, y: number, size: number): DrawOp[] {
  const out: DrawOp[] = [];
  if (!(bits & 0x0f)) return out;
  const w1 = size / 2;
  const h1 = size / 2;
  for (let i = 0; i < 4; i++) {
    if (bits & (1 << i)) {
      out.push({ sheet: -1, sx: 0, sy: 0, dx: x * size + (i % 2) * w1, dy: y * size + Math.floor(i / 2) * h1, w: w1, h: h1 });
    }
  }
  return out;
}

export function tileAt(map: MapTiles, x: number, y: number, z: number): number {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return 0;
  const v = map.data[(z * map.height + y) * map.width + x];
  return typeof v === "number" ? v : 0;
}

/** Tilemap._paintTiles 순서: z0, z1, 그림자, z2, z3. 별(0x10) 타일은 upper. */
export function layerOps(map: MapTiles, tileset: TilesetInfo, size: number): { lower: DrawOp[]; upper: DrawOp[] } {
  const lower: DrawOp[] = [];
  const upper: DrawOp[] = [];
  const flags = tileset.flags ?? [];
  const put = (id: number, x: number, y: number) => {
    const ops = drawOpsForTile(id, x, y, size, tileset, map);
    if (ops.length === 0) return;
    ((flags[id] ?? 0) & 0x10 ? upper : lower).push(...ops);
  };
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      put(tileAt(map, x, y, 0), x, y);
      put(tileAt(map, x, y, 1), x, y);
      lower.push(...shadowOps(tileAt(map, x, y, 4), x, y, size));
      put(tileAt(map, x, y, 2), x, y);
      put(tileAt(map, x, y, 3), x, y);
    }
  }
  return { lower, upper };
}

// ---- 로딩 ----
const tilesetCache = new WeakMap<GameData, Promise<unknown[] | null>>();

function parseJson(text: string | null): unknown {
  if (text === null) return undefined;
  try { return JSON.parse(text.replace(/^﻿/, "")); } catch { return undefined; }
}

async function readTilesets(folder: GameFolder, data: GameData): Promise<unknown[] | null> {
  let p = tilesetCache.get(data);
  if (!p) {
    p = (async () => {
      try {
        const v = parseJson(await folder.readText(`${data.dataRoot}/Tilesets.json`));
        return Array.isArray(v) ? v : null;
      } catch { return null; }
    })();
    tilesetCache.set(data, p);
    // 실패는 캐시하지 않는다(다음에 다시 시도).
    void p.then((v) => { if (v === null && tilesetCache.get(data) === p) tilesetCache.delete(data); });
  }
  return p;
}

const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Map###.json(타일 data 포함)과 Tilesets.json을 필요할 때 읽는다. 실패하면 null. */
export async function loadMapTiles(
  folder: GameFolder, data: GameData, mapId: number,
): Promise<{ map: MapTiles; tileset: TilesetInfo } | null> {
  try {
    const file = `${data.dataRoot}/Map${String(mapId).padStart(3, "0")}.json`;
    const [mapText, tilesets] = await Promise.all([
      folder.readText(file).catch(() => null),
      readTilesets(folder, data),
    ]);
    const m = parseJson(mapText) as Record<string, unknown> | undefined;
    if (!m || typeof m !== "object" || !tilesets) return null;
    const width = Math.floor(num(m.width));
    const height = Math.floor(num(m.height));
    const tilesetId = num(m.tilesetId, -1);
    if (width <= 0 || height <= 0 || !Array.isArray(m.data)) return null;
    const t = tilesets[tilesetId] as Record<string, unknown> | null | undefined;
    if (!t || typeof t !== "object") return null;
    const names = Array.isArray(t.tilesetNames) ? t.tilesetNames.map((n) => (typeof n === "string" ? n : "")) : [];
    while (names.length < 9) names.push("");
    const flags = Array.isArray(t.flags) ? t.flags.map((f) => num(f)) : [];
    return {
      map: { mapId, width, height, tilesetId, data: (m.data as unknown[]).map((v) => num(v)) },
      tileset: { id: num(t.id, tilesetId), mode: num(t.mode, 1), names, flags },
    };
  } catch {
    return null;
  }
}
