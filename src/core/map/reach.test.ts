import { describe, expect, it } from "vitest";
import { canReachEvent, reachableTiles } from "./reach";
import type { MapTiles, TilesetInfo } from "./tiles";

// 5×3: 가운데 세로줄(x = 2)이 벽(맨 위 층)
const w = 5, h = 3;
const data = new Array(w * h * 6).fill(0);
for (let y = 0; y < h; y++) data[3 * w * h + y * w + 2] = 1;
const map: MapTiles = { mapId: 1, width: w, height: h, tilesetId: 1, data };
const tileset: TilesetInfo = { id: 1, mode: 1, names: [], flags: [0, 0x0f] };

describe("reach", () => {
  it("walks from seeds, stopping at walls", () => {
    const r = reachableTiles(map, tileset, [{ x: 0, y: 0 }, { x: 99, y: 0 }]);
    expect([...r].sort()).toEqual(["0,0", "0,1", "0,2", "1,0", "1,1", "1,2"]);
  });
  it("an event is reachable if any stand tile is", () => {
    const r = reachableTiles(map, tileset, [{ x: 0, y: 0 }]);
    const npc = { priorityType: 1, trigger: 0, through: false };
    expect(canReachEvent({ x: 2, y: 1, ...npc }, map, tileset, r)).toBe(true);   // 벽 위 NPC: 왼쪽에서 말 걸기
    expect(canReachEvent({ x: 4, y: 1, ...npc }, map, tileset, r)).toBe(false);
    expect(canReachEvent({ x: 3, y: 1, priorityType: 0, trigger: 0, through: false }, map, tileset, r)).toBe(false);
    expect(canReachEvent({ x: 1, y: 1, priorityType: 0, trigger: 0, through: false }, map, tileset, r)).toBe(true);
  });
});
