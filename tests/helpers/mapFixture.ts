import type { MapTiles, TilesetInfo } from "@/core/map/tiles";

/** 8192칸 플래그 배열(타일 0은 별 0x10)에 덮어쓰기. */
export function testTileset(flags: Record<number, number>): TilesetInfo {
  const f = new Array<number>(8192).fill(0);
  f[0] = 0x10;
  for (const [k, v] of Object.entries(flags)) f[Number(k)] = v;
  return { id: 1, mode: 1, names: ["", "", "", "", "", "", "", "", ""], flags: f };
}

/** rows: 레이어 0의 타일 id 행렬. extra: 레이어별 덮어쓰기. */
export function testMap(rows: number[][], extra: Partial<Record<number, number[][]>> = {}): MapTiles {
  const height = rows.length, width = rows[0].length;
  const data = new Array<number>(width * height * 6).fill(0);
  const put = (z: number, grid: number[][]) =>
    grid.forEach((r, y) => r.forEach((v, x) => { data[(z * height + y) * width + x] = v; }));
  put(0, rows);
  for (const [z, g] of Object.entries(extra)) put(Number(z), g!);
  return { mapId: 1, width, height, tilesetId: 1, data };
}
