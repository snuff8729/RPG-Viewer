import { describe, expect, it } from "vitest";
import { MemoryFolder } from "@/core/fs/folder";
import type { GameData } from "@/core/types";
import {
  FLOOR_AUTOTILE_TABLE, TILE_ID_A1, TILE_ID_A2, TILE_ID_A3, TILE_ID_A4, TILE_ID_A5, TILE_ID_C, TILE_ID_MAX,
  WALL_AUTOTILE_TABLE, WATERFALL_AUTOTILE_TABLE, drawOpsForTile, getAutotileKind, getAutotileShape, isAutotile,
  isTableTile, isTileA1, isTileA2, isTileA3, isTileA4, isTileA5, isWaterfallTile, layerOps, loadMapTiles,
  makeAutotileId, tileSize, type MapTiles, type TilesetInfo,
} from "./tiles";

const S = 48;
const H = S / 2;

function tileset(flags: Record<number, number> = {}): TilesetInfo {
  const f = new Array<number>(TILE_ID_MAX).fill(0);
  f[0] = 0x10;
  for (const [k, v] of Object.entries(flags)) f[Number(k)] = v;
  return { id: 1, mode: 1, names: ["A1", "A2", "A3", "A4", "A5", "B", "C", "D", "E"], flags: f };
}

/** 사분면 표를 규칙으로 다시 만든다(엔진 표와 독립적인 검증용). */
function floorByRule(shape: number): number[][] {
  // 내부/모서리/안쪽모서리 사분면 원천: q = 0 TL, 1 TR, 2 BL, 3 BR
  const interior = [[2, 4], [1, 4], [2, 3], [1, 3]];
  const inner = [[2, 0], [3, 0], [2, 1], [3, 1]];
  // 변: 위/아래/왼/오
  const topEdge = { 0: [2, 2], 1: [1, 2] } as Record<number, number[]>;
  const bottomEdge = { 2: [2, 5], 3: [1, 5] } as Record<number, number[]>;
  const leftEdge = { 0: [0, 4], 2: [0, 3] } as Record<number, number[]>;
  const rightEdge = { 1: [3, 4], 3: [3, 3] } as Record<number, number[]>;
  const outer = [[0, 2], [3, 2], [0, 5], [3, 5]];
  const build = (top: boolean, bottom: boolean, left: boolean, right: boolean, innerCorners: number[]) =>
    [0, 1, 2, 3].map((q) => {
      const isTop = q < 2, isLeft = q % 2 === 0;
      const v = isTop ? top : bottom, h = isLeft ? left : right;
      if (v && h) return outer[q];
      if (v) return (isTop ? topEdge : bottomEdge)[q];
      if (h) return (isLeft ? leftEdge : rightEdge)[q];
      return innerCorners.includes(q) ? inner[q] : interior[q];
    });
  // 엔진의 비트 배치: 각 모양 묶음에서 남은 안쪽 모서리를 순서대로 비트로 쓴다.
  const pick = (bits: number, corners: number[]) => corners.filter((_, i) => bits & (1 << i));
  if (shape < 16) return build(false, false, false, false, pick(shape, [0, 1, 3, 2]));
  if (shape < 20) return build(false, false, true, false, pick(shape - 16, [1, 3]));
  if (shape < 24) return build(true, false, false, false, pick(shape - 20, [3, 2]));
  if (shape < 28) return build(false, false, false, true, pick(shape - 24, [2, 0]));
  if (shape < 32) return build(false, true, false, false, pick(shape - 28, [0, 1]));
  if (shape === 32) return build(false, false, true, true, []);
  if (shape === 33) return build(true, true, false, false, []);
  if (shape < 36) return build(true, false, true, false, pick(shape - 34, [3]));
  if (shape < 38) return build(true, false, false, true, pick(shape - 36, [2]));
  if (shape < 40) return build(false, true, false, true, pick(shape - 38, [0]));
  if (shape < 42) return build(false, true, true, false, pick(shape - 40, [1]));
  if (shape === 42) return build(true, false, true, true, []);
  if (shape === 43) return build(true, true, true, false, []);
  if (shape === 44) return build(false, true, true, true, []);
  if (shape === 45) return build(true, true, false, true, []);
  if (shape === 46) return build(true, true, true, true, []);
  return [[0, 0], [1, 0], [0, 1], [1, 1]];
}

describe("tile id ranges", () => {
  it("matches RPG Maker constants", () => {
    expect([TILE_ID_C, TILE_ID_A5, TILE_ID_A1, TILE_ID_A2, TILE_ID_A3, TILE_ID_A4, TILE_ID_MAX])
      .toEqual([256, 1536, 2048, 2816, 4352, 5888, 8192]);
  });
  it("classifies ids", () => {
    expect(isAutotile(2047)).toBe(false);
    expect(isAutotile(2048)).toBe(true);
    expect(isTileA5(1536)).toBe(true);
    expect(isTileA5(2048)).toBe(false);
    expect(isTileA1(2815)).toBe(true);
    expect(isTileA2(2816)).toBe(true);
    expect(isTileA3(4352)).toBe(true);
    expect(isTileA4(8191)).toBe(true);
    expect(isTileA4(8192)).toBe(false);
    expect(getAutotileKind(makeAutotileId(17, 33))).toBe(17);
    expect(getAutotileShape(makeAutotileId(17, 33))).toBe(33);
    expect(getAutotileKind(TILE_ID_A2)).toBe(16);
    expect(getAutotileKind(TILE_ID_A3)).toBe(48);
    expect(getAutotileKind(TILE_ID_A4)).toBe(80);
  });
  it("waterfall = odd A1 kinds from kind 4", () => {
    expect(isWaterfallTile(makeAutotileId(5, 0))).toBe(true);
    expect(isWaterfallTile(makeAutotileId(4, 0))).toBe(false);
    expect(isWaterfallTile(makeAutotileId(3, 0))).toBe(false);
    expect(isWaterfallTile(makeAutotileId(15, 3))).toBe(true);
  });
  it("table tile = A2 with counter flag", () => {
    const id = makeAutotileId(20, 0);
    expect(isTableTile(id, tileset({ [id]: 0x80 }).flags)).toBe(true);
    expect(isTableTile(id, tileset().flags)).toBe(false);
    expect(isTableTile(1600, tileset({ 1600: 0x80 }).flags)).toBe(false);
  });
  it("tileSize is 48", () => {
    expect(tileSize("MV")).toBe(48);
    expect(tileSize("MZ")).toBe(48);
  });
});

describe("autotile tables", () => {
  it("has the right sizes", () => {
    expect(FLOOR_AUTOTILE_TABLE).toHaveLength(48);
    expect(WALL_AUTOTILE_TABLE).toHaveLength(16);
    expect(WATERFALL_AUTOTILE_TABLE).toHaveLength(4);
  });
  it("pins known floor shapes", () => {
    expect(FLOOR_AUTOTILE_TABLE[0]).toEqual([[2, 4], [1, 4], [2, 3], [1, 3]]);
    expect(FLOOR_AUTOTILE_TABLE[1]).toEqual([[2, 0], [1, 4], [2, 3], [1, 3]]);
    expect(FLOOR_AUTOTILE_TABLE[15]).toEqual([[2, 0], [3, 0], [2, 1], [3, 1]]);
    expect(FLOOR_AUTOTILE_TABLE[16]).toEqual([[0, 4], [1, 4], [0, 3], [1, 3]]);
    expect(FLOOR_AUTOTILE_TABLE[33]).toEqual([[2, 2], [1, 2], [2, 5], [1, 5]]);
    expect(FLOOR_AUTOTILE_TABLE[46]).toEqual([[0, 2], [3, 2], [0, 5], [3, 5]]);
    expect(FLOOR_AUTOTILE_TABLE[47]).toEqual([[0, 0], [1, 0], [0, 1], [1, 1]]);
  });
  it("every floor shape matches the edge/corner rule", () => {
    for (let s = 0; s < 48; s++) expect(FLOOR_AUTOTILE_TABLE[s], `shape ${s}`).toEqual(floorByRule(s));
  });
  it("every wall shape matches the edge rule (1 left, 2 top, 4 right, 8 bottom)", () => {
    for (let s = 0; s < 16; s++) {
      const l = s & 1, t = s & 2, r = s & 4, b = s & 8;
      expect(WALL_AUTOTILE_TABLE[s], `shape ${s}`).toEqual([
        [l ? 0 : 2, t ? 0 : 2], [r ? 3 : 1, t ? 0 : 2], [l ? 0 : 2, b ? 3 : 1], [r ? 3 : 1, b ? 3 : 1],
      ]);
    }
  });
  it("waterfall shapes (1 left, 2 right)", () => {
    expect(WATERFALL_AUTOTILE_TABLE).toEqual([
      [[2, 0], [1, 0], [2, 1], [1, 1]], [[0, 0], [1, 0], [0, 1], [1, 1]],
      [[2, 0], [3, 0], [2, 1], [3, 1]], [[0, 0], [3, 0], [0, 1], [3, 1]],
    ]);
  });
});

describe("drawOpsForTile", () => {
  const ts = tileset();
  it("draws nothing for tile 0 and out of range ids", () => {
    expect(drawOpsForTile(0, 0, 0, S, ts)).toEqual([]);
    expect(drawOpsForTile(TILE_ID_MAX, 0, 0, S, ts)).toEqual([]);
    expect(drawOpsForTile(-3, 0, 0, S, ts)).toEqual([]);
  });
  it("normal B tile", () => {
    // id 9: 열 1, 행 1
    expect(drawOpsForTile(9, 2, 3, S, ts)).toEqual([{ sheet: 5, sx: 48, sy: 48, dx: 96, dy: 144, w: 48, h: 48 }]);
    // id 130: 오른쪽 절반(128..255) → 열 8+2
    expect(drawOpsForTile(130, 0, 0, S, ts)).toEqual([{ sheet: 5, sx: 10 * 48, sy: 0, dx: 0, dy: 0, w: 48, h: 48 }]);
  });
  it("C/D/E sheets", () => {
    expect(drawOpsForTile(256 + 255, 0, 0, S, ts)[0]).toMatchObject({ sheet: 6, sx: 15 * 48, sy: 15 * 48 });
    expect(drawOpsForTile(512, 0, 0, S, ts)[0]).toMatchObject({ sheet: 7, sx: 0, sy: 0 });
    expect(drawOpsForTile(768 + 8, 0, 0, S, ts)[0]).toMatchObject({ sheet: 8, sx: 0, sy: 48 });
  });
  it("A5 tile", () => {
    // 1536 + 8*3 + 5 → 열 5, 행 3
    expect(drawOpsForTile(1536 + 29, 1, 0, S, ts)).toEqual([{ sheet: 4, sx: 5 * 48, sy: 3 * 48, dx: 48, dy: 0, w: 48, h: 48 }]);
  });
  it("A2 floor autotile shape 0 (interior)", () => {
    // kind 16 = A2 첫 칸: bx 0, by 0
    expect(drawOpsForTile(makeAutotileId(16, 0), 1, 1, S, ts)).toEqual([
      { sheet: 1, sx: 2 * H, sy: 4 * H, dx: 48, dy: 48, w: H, h: H },
      { sheet: 1, sx: 1 * H, sy: 4 * H, dx: 48 + H, dy: 48, w: H, h: H },
      { sheet: 1, sx: 2 * H, sy: 3 * H, dx: 48, dy: 48 + H, w: H, h: H },
      { sheet: 1, sx: 1 * H, sy: 3 * H, dx: 48 + H, dy: 48 + H, w: H, h: H },
    ]);
  });
  it("A2 kind offset (kind 27 → tx 3, ty 3 → bx 6, by 3)", () => {
    const ops = drawOpsForTile(makeAutotileId(27, 46), 0, 0, S, ts);
    expect(ops.map((o) => [o.sx, o.sy])).toEqual([
      [(12 + 0) * H, (6 + 2) * H], [(12 + 3) * H, (6 + 2) * H], [(12 + 0) * H, (6 + 5) * H], [(12 + 3) * H, (6 + 5) * H],
    ]);
    expect(ops.every((o) => o.sheet === 1)).toBe(true);
  });
  it("A1 kinds: water, deep water, fixed, waterfall (frame 0)", () => {
    expect(drawOpsForTile(makeAutotileId(0, 47), 0, 0, S, ts)[0]).toMatchObject({ sheet: 0, sx: 0, sy: 0 });
    expect(drawOpsForTile(makeAutotileId(1, 47), 0, 0, S, ts)[0]).toMatchObject({ sheet: 0, sx: 0, sy: 6 * H });
    expect(drawOpsForTile(makeAutotileId(2, 47), 0, 0, S, ts)[0]).toMatchObject({ sheet: 0, sx: 12 * H, sy: 0 });
    expect(drawOpsForTile(makeAutotileId(3, 47), 0, 0, S, ts)[0]).toMatchObject({ sheet: 0, sx: 12 * H, sy: 6 * H });
    // kind 4: tx 4 → bx 8, by 0
    expect(drawOpsForTile(makeAutotileId(4, 47), 0, 0, S, ts)[0]).toMatchObject({ sx: 16 * H, sy: 0 });
    // kind 5 = 폭포: bx 8+6 = 14, by 0, 폭포 표 shape 3
    expect(drawOpsForTile(makeAutotileId(5, 3), 0, 0, S, ts).map((o) => [o.sx, o.sy])).toEqual([
      [28 * H, 0], [31 * H, 0], [28 * H, H], [31 * H, H],
    ]);
    // kind 6: tx 6 → bx 8, by 3
    expect(drawOpsForTile(makeAutotileId(6, 47), 0, 0, S, ts)[0]).toMatchObject({ sx: 16 * H, sy: 6 * H });
    // kind 8: tx 0, ty 1 → bx 0, by 6
    expect(drawOpsForTile(makeAutotileId(8, 47), 0, 0, S, ts)[0]).toMatchObject({ sx: 0, sy: 12 * H });
  });
  it("A3 uses the wall table", () => {
    // kind 48 + 8 + 2 = 58: tx 2, ty 7 → bx 4, by 2
    const ops = drawOpsForTile(makeAutotileId(58, 15), 0, 0, S, ts);
    expect(ops.map((o) => [o.sheet, o.sx, o.sy])).toEqual([
      [2, 8 * H, 4 * H], [2, 11 * H, 4 * H], [2, 8 * H, 7 * H], [2, 11 * H, 7 * H],
    ]);
  });
  it("A4 wall top uses floor table, wall side uses wall table", () => {
    // kind 80: ty 10 → by 0, floor
    expect(drawOpsForTile(makeAutotileId(80, 0), 0, 0, S, ts)[0]).toMatchObject({ sheet: 3, sx: 2 * H, sy: 4 * H });
    // kind 88: ty 11 → by 3, wall shape 0 → [2,2]
    expect(drawOpsForTile(makeAutotileId(88, 0), 0, 0, S, ts)[0]).toMatchObject({ sheet: 3, sx: 2 * H, sy: (6 + 2) * H });
    // ty 12 → by 5 (floor), ty 13 → by 8 (wall), ty 15 → by 13
    expect(drawOpsForTile(makeAutotileId(96, 47), 0, 0, S, ts)[0]).toMatchObject({ sy: 10 * H });
    expect(drawOpsForTile(makeAutotileId(104, 3), 0, 0, S, ts)[0]).toMatchObject({ sy: 16 * H });
    expect(drawOpsForTile(makeAutotileId(120, 3), 0, 0, S, ts)[0]).toMatchObject({ sy: 26 * H });
  });
  it("table tile draws like a normal A2 autotile", () => {
    const id = makeAutotileId(16, 0);
    expect(drawOpsForTile(id, 0, 0, S, tileset({ [id]: 0x80 }))).toEqual(drawOpsForTile(id, 0, 0, S, ts));
  });
});

function makeMap(width: number, height: number, layers: Partial<Record<number, number[]>>): MapTiles {
  const data = new Array<number>(width * height * 6).fill(0);
  for (const [z, arr] of Object.entries(layers)) arr!.forEach((v, i) => { data[Number(z) * width * height + i] = v; });
  return { mapId: 1, width, height, tilesetId: 1, data };
}

describe("layerOps", () => {
  it("splits star tiles into the upper layer and adds shadows as sheet -1", () => {
    const ts = tileset({ 1: 0x10, 2: 0 });
    const map = makeMap(2, 1, { 0: [1536, 1536], 2: [1, 2], 4: [0b0101, 0] });
    const { lower, upper } = layerOps(map, ts, S);
    expect(upper).toEqual([{ sheet: 5, sx: 48, sy: 0, dx: 0, dy: 0, w: 48, h: 48 }]);
    expect(lower).toEqual([
      { sheet: 4, sx: 0, sy: 0, dx: 0, dy: 0, w: 48, h: 48 },
      { sheet: -1, sx: 0, sy: 0, dx: 0, dy: 0, w: H, h: H },
      { sheet: -1, sx: 0, sy: 0, dx: 0, dy: H, w: H, h: H },
      { sheet: 4, sx: 0, sy: 0, dx: 48, dy: 0, w: 48, h: 48 },
      { sheet: 5, sx: 96, sy: 0, dx: 48, dy: 0, w: 48, h: 48 },
    ]);
  });
  it("survives short data", () => {
    const map: MapTiles = { mapId: 1, width: 3, height: 3, tilesetId: 1, data: [1536] };
    expect(layerOps(map, tileset(), S).lower).toHaveLength(1);
  });
});

describe("loadMapTiles", () => {
  const tilesets = JSON.stringify([null, { id: 1, mode: 1, name: "t", tilesetNames: ["a1", "", "", "", "", "b", "", "", ""], flags: [16, 15] }]);
  const mapJson = (tilesetId: number) => JSON.stringify({ width: 2, height: 1, tilesetId, data: [1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], events: [] });
  const data = () => ({ dataRoot: "www/data" } as GameData);

  it("reads the map and tileset", async () => {
    const folder = new MemoryFolder({ "www/data/Tilesets.json": tilesets, "www/data/Map007.json": mapJson(1) });
    const r = await loadMapTiles(folder, data(), 7);
    expect(r).toEqual({
      map: { mapId: 7, width: 2, height: 1, tilesetId: 1, data: [1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      tileset: { id: 1, mode: 1, names: ["a1", "", "", "", "", "b", "", "", ""], flags: [16, 15] },
    });
  });
  it("reads Tilesets.json once per GameData", async () => {
    const folder = new MemoryFolder({ "www/data/Tilesets.json": tilesets, "www/data/Map001.json": mapJson(1) });
    let reads = 0;
    const orig = folder.readText.bind(folder);
    folder.readText = async (p: string) => { if (p.endsWith("Tilesets.json")) reads++; return orig(p); };
    const d = data();
    await loadMapTiles(folder, d, 1);
    await loadMapTiles(folder, d, 1);
    expect(reads).toBe(1);
  });
  it("returns null on missing files, bad json, unknown tileset, throwing folder", async () => {
    expect(await loadMapTiles(new MemoryFolder({ "www/data/Tilesets.json": tilesets }), data(), 1)).toBeNull();
    expect(await loadMapTiles(new MemoryFolder({ "www/data/Map001.json": mapJson(1) }), data(), 1)).toBeNull();
    expect(await loadMapTiles(new MemoryFolder({ "www/data/Tilesets.json": tilesets, "www/data/Map001.json": "{x" }), data(), 1)).toBeNull();
    expect(await loadMapTiles(new MemoryFolder({ "www/data/Tilesets.json": tilesets, "www/data/Map001.json": mapJson(5) }), data(), 1)).toBeNull();
    const bad = new MemoryFolder({});
    bad.readText = async () => { throw new Error("boom"); };
    expect(await loadMapTiles(bad, data(), 1)).toBeNull();
  });
});
