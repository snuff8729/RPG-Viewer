// Game_Map.checkPassage / isPassable 포팅. DOM 없음, 예외 없음.
import { tileAt, type MapTiles, type TilesetInfo } from "./tiles";

export type Dir = 2 | 4 | 6 | 8;

const inside = (map: MapTiles, x: number, y: number) =>
  Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < map.width && y < map.height;

/** 레이어 3→0 순서로 본다: 별(0x10)은 건너뛰고, 방향 비트가 0이면 통과, 1이면 막힘. 다 건너뛰면 막힘. */
function checkPassage(map: MapTiles, tileset: TilesetInfo, x: number, y: number, bit: number): boolean {
  const flags = tileset.flags ?? [];
  for (let z = 3; z >= 0; z--) {
    const flag = flags[tileAt(map, x, y, z)] ?? 0;
    if (flag & 0x10) continue;
    if ((flag & bit) === 0) return true;
    if ((flag & bit) === bit) return false;
  }
  return false;
}

/** 칸 (x, y)에서 dir 방향으로 나가거나(혹은 그 방향 면으로 들어오는) 통과 여부. 비트 0x01 아래, 0x02 왼, 0x04 오른, 0x08 위. */
export function passable(map: MapTiles, tileset: TilesetInfo, x: number, y: number, dir: Dir): boolean {
  if (!inside(map, x, y)) return false;
  return checkPassage(map, tileset, x, y, (1 << (dir / 2 - 1)) & 0x0f);
}

/** 네 방향 모두 막힌 칸(벽 음영용). */
export function blocked(map: MapTiles, tileset: TilesetInfo, x: number, y: number): boolean {
  return ([2, 4, 6, 8] as const).every((d) => !passable(map, tileset, x, y, d));
}

/** Game_Map.isCounter: 아무 레이어든 카운터 플래그(0x80). */
export function isCounter(map: MapTiles, tileset: TilesetInfo, x: number, y: number): boolean {
  if (!inside(map, x, y)) return false;
  const flags = tileset.flags ?? [];
  for (let z = 3; z >= 0; z--) if ((flags[tileAt(map, x, y, z)] ?? 0) & 0x80) return true;
  return false;
}
