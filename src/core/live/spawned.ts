// 게임이 실행 중에 만든 이벤트(EventReSpawn의 Game_PrefabEvent 등, 기록 플러그인 1.16.0+ live.json spawn).
// 맵 데이터에는 없으므로 원본 이벤트의 페이지를 복사해 지금 맵에 넣은 GameData를 만든다. 예외를 던지지 않는다.
import type { GameData, MapData, MapEvent } from "../types";
import type { LiveSnapshot, LiveSpawn } from "./types";

/** 원본을 못 찾은 생성 이벤트의 이름(맵 표시만) */
export const UNKNOWN_SPAWN_TITLE = "알 수 없는 생성 이벤트";

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object";
const posOk = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const idOk = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

/** 생성 이벤트를 넣어 만든 GameData → 원래 GameData(데이터 전체를 훑는 캐시는 원래 것을 키로 쓴다) */
const bases = new WeakMap<object, GameData>();

/** 생성 이벤트를 넣어 만든 GameData면 원래 GameData, 아니면 그대로 */
export function baseData<T extends GameData | null | undefined>(data: T): T {
  return (isObj(data) ? (bases.get(data) as T | undefined) : undefined) ?? data;
}

interface SpawnEntry { id: number; x: number | null; y: number | null; spawn: LiveSpawn | null }

/** live.events 중 생성 이벤트: spawn이 있는 것, 또는(구버전 플러그인) 맵 데이터에 없는 것 */
function spawnEntries(map: MapData, live: LiveSnapshot): SpawnEntry[] {
  const out: SpawnEntry[] = [];
  const events = Array.isArray(map.events) ? map.events : [];
  for (const e of Array.isArray(live.events) ? live.events : []) {
    if (!isObj(e) || !idOk(e.eventId)) continue;
    const spawn = isObj(e.spawn) ? (e.spawn as LiveSpawn) : null;
    if (!spawn && isObj(events[e.eventId])) continue;
    if (out.some(o => o.id === e.eventId)) continue;
    out.push({ id: e.eventId, x: posOk(e.x) ? e.x : null, y: posOk(e.y) ? e.y : null, spawn });
  }
  return out;
}

/** 원본 이벤트: tpl이면 TemplateEvent 템플릿 맵, 아니면 같은 맵(맵 데이터 그대로)의 것 */
function sourceOf(data: GameData, map: MapData, s: LiveSpawn | null): { ev: MapEvent; from: number; template: boolean } | null {
  if (!s || !idOk(s.from)) return null;
  const template = s.tpl === true;
  let src: unknown;
  if (template) {
    const tplId = data.templateMapId;
    src = typeof tplId === "number" ? data.maps.get(tplId)?.events?.[s.from] : undefined;
  } else src = Array.isArray(map.events) ? map.events[s.from] : undefined;
  if (!isObj(src) || !Array.isArray(src.pages) || src.spawned) return null;
  return { ev: src as MapEvent, from: s.from, template };
}

function keyOf(mapId: number, list: SpawnEntry[]): string {
  return `${mapId}|` + list.map(e => `${e.id}:${e.spawn?.from ?? ""}:${e.spawn?.tpl === true ? 1 : 0}:${e.spawn?.name ?? ""}`).join(",");
}

/** data → 마지막으로 만든 것(생성 이벤트 구성이 같으면 같은 객체) */
const cache = new WeakMap<GameData, { key: string; out: GameData }>();

/**
 * 지금 맵(live.mapId)에 생성 이벤트를 넣은 GameData. 생성 이벤트가 없으면 data 그대로.
 * - 원본을 알면 원본 이벤트(페이지·이름·메모)를 복사하고 id·처음 위치는 생성된 것으로(spawned.from = 원본 번호).
 *   live의 page는 원본 페이지 번호라 그대로 맞는다.
 * - 원본을 모르면 페이지 없는 이벤트(이름 = 알려 준 이름, spawned.from = null) — 위치를 알 때만.
 * 생성 이벤트 구성(번호·원본)이 같으면 같은 객체를 돌려준다(위치는 처음 만들 때의 것, 지금 위치는 live.events로).
 */
export function withSpawnedEvents(data: GameData, live: LiveSnapshot | null | undefined): GameData {
  try {
    if (!isObj(data) || !(data.maps instanceof Map) || !isObj(live) || typeof live.mapId !== "number") return data;
    const map = data.maps.get(live.mapId);
    if (!isObj(map)) return data;
    const list = spawnEntries(map, live);
    if (list.length === 0) return data;
    const key = keyOf(live.mapId, list);
    const hit = cache.get(data);
    if (hit && hit.key === key) return hit.out;
    const events = (Array.isArray(map.events) ? map.events : []).slice();
    for (const e of list) {
      const src = sourceOf(data, map, e.spawn);
      if (src) {
        events[e.id] = {
          ...src.ev, id: e.id, x: e.x ?? src.ev.x, y: e.y ?? src.ev.y,
          spawned: { from: src.from, template: src.template },
        };
      } else if (e.x !== null && e.y !== null) {
        const name = typeof e.spawn?.name === "string" ? e.spawn.name : "";
        events[e.id] = { id: e.id, name, x: e.x, y: e.y, pages: [], spawned: { from: null, template: false } };
      }
    }
    for (let i = 0; i < events.length; i++) if (events[i] === undefined) events[i] = null;
    const maps = new Map(data.maps);
    maps.set(live.mapId, { ...map, events });
    const out: GameData = { ...data, maps };
    bases.set(out, baseData(data));
    cache.set(data, { key, out });
    return out;
  } catch {
    return data;
  }
}
