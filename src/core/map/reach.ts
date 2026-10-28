// 걸어서 갈 수 있는 칸. DOM 없음, 예외 없음.
import { passable, type Dir } from "./passage";
import { standTiles } from "./route";
import type { MapTiles, TilesetInfo } from "./tiles";

const DIRS: readonly Dir[] = [2, 4, 6, 8];
const DELTA: Record<Dir, readonly [number, number]> = { 2: [0, 1], 4: [-1, 0], 6: [1, 0], 8: [0, -1] };
const REVERSE: Record<Dir, Dir> = { 2: 8, 4: 6, 6: 4, 8: 2 };
const inside = (map: MapTiles, x: number, y: number) =>
  Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < map.width && y < map.height;

/** seeds에서 4방향으로 걸어서 닿는 칸("x,y"). 맵 밖 seed는 무시한다. */
export function reachableTiles(map: MapTiles, tileset: TilesetInfo, seeds: readonly { x: number; y: number }[]): Set<string> {
  const seen = new Set<string>();
  try {
    const queue: [number, number][] = [];
    for (const s of seeds) {
      if (!s || !inside(map, s.x, s.y) || seen.has(`${s.x},${s.y}`)) continue;
      seen.add(`${s.x},${s.y}`);
      queue.push([s.x, s.y]);
    }
    for (let qi = 0; qi < queue.length; qi++) {
      const [x, y] = queue[qi];
      for (const d of DIRS) {
        const nx = x + DELTA[d][0], ny = y + DELTA[d][1];
        const k = `${nx},${ny}`;
        if (seen.has(k) || !inside(map, nx, ny)) continue;
        if (!passable(map, tileset, x, y, d) || !passable(map, tileset, nx, ny, REVERSE[d])) continue;
        seen.add(k);
        queue.push([nx, ny]);
      }
    }
  } catch { /* 지금까지 */ }
  return seen;
}

/**
 * 이벤트를 실행할 칸(standTiles) 중 하나라도 reach 안에 있는가.
 */
export function canReachEvent(
  ev: { x: number; y: number; priorityType: number; trigger: number; through: boolean },
  map: MapTiles, tileset: TilesetInfo, reach: Set<string>,
): boolean {
  try {
    return standTiles(ev, map, tileset).some((s) => reach.has(`${s.x},${s.y}`));
  } catch {
    return true;
  }
}
