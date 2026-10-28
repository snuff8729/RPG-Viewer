// 이벤트를 실행하려면 어디에 서서 어느 쪽을 봐야 하는지, 그리고 거기까지 가는 길. DOM 없음, 예외 없음.
import { isCounter, passable, type Dir } from "./passage";
import type { MapTiles, TilesetInfo } from "./tiles";

/** face: 서서 바라볼 방향. null = 이벤트 칸에 올라서기. */
export interface EventStand { x: number; y: number; face: Dir | null }
/** steps: 출발 칸부터 서는 칸까지(양 끝 포함). */
export interface Route { steps: { x: number; y: number }[]; stand: EventStand; text: string }

const DIRS: readonly Dir[] = [2, 4, 6, 8];
const DELTA: Record<Dir, readonly [number, number]> = { 2: [0, 1], 4: [-1, 0], 6: [1, 0], 8: [0, -1] };
const REVERSE: Record<Dir, Dir> = { 2: 8, 4: 6, 6: 4, 8: 2 };
const DIR_OBJ: Record<Dir, string> = { 2: "아래를", 4: "왼쪽을", 6: "오른쪽을", 8: "위를" };

const inside = (map: MapTiles, x: number, y: number) =>
  Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < map.width && y < map.height;
const key = (x: number, y: number) => `${x},${y}`;

/**
 * 캐릭터와 같은 우선순위(1) + 결정 버튼(0): 이벤트를 바라보는 네 이웃 칸(사이에 카운터 0x80 칸이 있으면 두 칸 떨어진 곳도).
 * 그 밖(우선순위 0/2, 접촉 트리거 등): 이벤트 칸 자체.
 */
export function standTiles(
  ev: { x: number; y: number; priorityType: number; trigger: number; through: boolean },
  map: MapTiles,
  tileset: TilesetInfo,
): EventStand[] {
  try {
    if (ev.priorityType !== 1 || ev.trigger !== 0) return [{ x: ev.x, y: ev.y, face: null }];
    const out: EventStand[] = [];
    for (const d of DIRS) {
      const [ddx, ddy] = DELTA[d];
      const x1 = ev.x - ddx, y1 = ev.y - ddy;
      if (!inside(map, x1, y1)) continue;
      out.push({ x: x1, y: y1, face: d });
      if (isCounter(map, tileset, x1, y1)) {
        const x2 = x1 - ddx, y2 = y1 - ddy;
        if (inside(map, x2, y2)) out.push({ x: x2, y: y2, face: d });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function describe(from: { x: number; y: number }, stand: EventStand): string {
  const dx = stand.x - from.x, dy = stand.y - from.y;
  const parts: string[] = [];
  if (dx > 0) parts.push(`오른쪽 ${dx}칸`);
  if (dx < 0) parts.push(`왼쪽 ${-dx}칸`);
  if (dy < 0) parts.push(`위 ${-dy}칸`);
  if (dy > 0) parts.push(`아래 ${dy}칸`);
  if (parts.length === 0) return stand.face === null ? "지금 그 칸에 서 있음" : `지금 자리에서 ${DIR_OBJ[stand.face]} 보고 확인`;
  return `${parts.join(", ")} 가서 ${stand.face === null ? "그 칸에 서기" : `${DIR_OBJ[stand.face]} 보고 확인`}`;
}

/**
 * from에서 가장 가까운 stand 칸까지 4방향 BFS. 한 걸음은 Game_CharacterBase.canPass처럼
 * 나가는 칸의 dir 면과 들어가는 칸의 반대 면이 모두 통과여야 하고, blockers("x,y")와
 * 바라보는 stand 앞 칸(대상 이벤트, 카운터면 그 너머까지)은 밟지 않는다.
 */
export function routeTo(
  map: MapTiles,
  tileset: TilesetInfo,
  from: { x: number; y: number },
  stands: EventStand[],
  blockers: Set<string>,
): Route | null {
  try {
    if (!inside(map, from.x, from.y) || stands.length === 0) return null;
    const goals = new Map<string, EventStand>();
    const solid = new Set(blockers);
    for (const s of stands) {
      if (!inside(map, s.x, s.y)) continue;
      if (!goals.has(key(s.x, s.y))) goals.set(key(s.x, s.y), s);
      if (s.face !== null) {
        const [ddx, ddy] = DELTA[s.face];
        const fx = s.x + ddx, fy = s.y + ddy;
        solid.add(key(fx, fy));
        if (isCounter(map, tileset, fx, fy)) solid.add(key(fx + ddx, fy + ddy));
      }
    }
    for (const k of goals.keys()) if (blockers.has(k)) goals.delete(k);

    const start = key(from.x, from.y);
    const prev = new Map<string, string | null>([[start, null]]);
    const queue: [number, number][] = [[from.x, from.y]];
    let found: EventStand | undefined;
    for (let qi = 0; qi < queue.length; qi++) {
      const [x, y] = queue[qi];
      const g = goals.get(key(x, y));
      if (g) { found = g; break; }
      for (const d of DIRS) {
        const nx = x + DELTA[d][0], ny = y + DELTA[d][1];
        const nk = key(nx, ny);
        if (prev.has(nk) || solid.has(nk) || !inside(map, nx, ny)) continue;
        if (!passable(map, tileset, x, y, d) || !passable(map, tileset, nx, ny, REVERSE[d])) continue;
        prev.set(nk, key(x, y));
        queue.push([nx, ny]);
      }
    }
    if (!found) return null;
    const steps: { x: number; y: number }[] = [];
    for (let k: string | null | undefined = key(found.x, found.y); k; k = prev.get(k)) {
      const [x, y] = k.split(",").map(Number);
      steps.push({ x, y });
    }
    steps.reverse();
    return { steps, stand: found, text: describe(from, found) };
  } catch {
    return null;
  }
}
