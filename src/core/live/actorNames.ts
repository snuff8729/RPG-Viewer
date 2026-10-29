import type { GameData } from "../types";
import type { LiveSnapshot } from "./types";

const MAX_NAME = 100;

/** live.json actorNames(1.19.1+) → 쓸 수 있는 것만(있는 캐릭터·데이터베이스와 다른 이름), id 순. 예외를 던지지 않는다. */
function cleanNames(data: GameData, names: unknown): [number, string][] {
  if (!names || typeof names !== "object") return [];
  const out: [number, string][] = [];
  for (const [k, v] of Object.entries(names as Record<string, unknown>)) {
    const id = Number(k);
    if (!Number.isInteger(id) || id <= 0 || typeof v !== "string" || !v) continue;
    const actor = data.actors?.[id];
    if (!actor || actor.name === v) continue;
    out.push([id, v.slice(0, MAX_NAME)]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

const cache = new WeakMap<GameData, { key: string; out: GameData }>();

/**
 * 게임 중에 바뀐 캐릭터 이름(live.json actorNames)을 넣은 GameData. 실행 중 화면(읽기·기록·선택지 등)의 \N[n]·말하는 사람이
 * 게임 화면과 같은 이름을 쓰게 한다. 바뀐 이름이 없으면 data 그대로, 같은 이름들이면 같은 객체(memo deps로 써도 된다).
 * actors만 새 배열이고 나머지는 data와 같다. 스크립트 보기 등 원본 데이터 화면에는 쓰지 않는다.
 */
export function withActorNames(data: GameData, names: LiveSnapshot["actorNames"] | null | undefined): GameData {
  const list = cleanNames(data, names);
  if (list.length === 0) return data;
  const key = JSON.stringify(list);
  const hit = cache.get(data);
  if (hit && hit.key === key) return hit.out;
  const actors = data.actors.slice();
  for (const [id, name] of list) {
    const a = actors[id];
    if (a) actors[id] = { ...a, name };
  }
  const out: GameData = { ...data, actors };
  cache.set(data, { key, out });
  return out;
}
