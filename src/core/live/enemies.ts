// 적(전투를 거는 맵 이벤트)과 맵의 랜덤 인카운트를 데이터만으로 살핀다. 예외를 던지지 않는다.
import { flattenCalls, type CallCtx } from "../interpret/teCall";
import type { EventCommand, GameData, MapEvent } from "../types";
import { commonEventCallCount, MANY_CALLERS } from "./mapScan";

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object";
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** 공통 이벤트를 따라 들어가는 깊이 */
const CE_DEPTH = 2;
/** 플러그인 명령이 전투를 "시작"하는 것처럼 보이는가(명령 이름이나 인수) */
const BATTLE_START = /^(start|call|begin|force)?_?battle\b|battle_?start|戦闘開始|バトル開始|エンカウント|encounter/i;
/** 설정처럼 보이는 플러그인 명령 이름(setBattleSys 등): 전투를 시작하지 않는다 */
const SETTING_NAME = /^set|config|sys|mode|speed|bgm|bgs|se\b/i;
/** 쫓아오는 이벤트 표시(EventChasePlayer 등): 메모·주석·스크립트 */
const CHASE_WORD = /<\s*chase|chase\s*player|_chaseRange|chaseRange|追跡|追いかけ|追尾/i;

/** 전투 처리(301) 하나. troop: 적 그룹 이름(직접 지정), `변수로 정해짐`, `맵 랜덤 적`. maybe = 플러그인 명령으로 짐작 */
export interface BattleFound { troop: string | null; canEscape: boolean; canLose: boolean; maybe: boolean }

/** 적 그룹 이름(없으면 `적 그룹 n`). */
export function troopName(data: GameData, id: number): string {
  const t = arr<{ name?: unknown } | null>(data?.troops)[id];
  const name = isObj(t) && typeof t.name === "string" ? t.name.trim() : "";
  return name || `적 그룹 ${id}`;
}

/** 전투 처리 명령(301)의 적 그룹: 0 직접 지정, 1 변수로 지정, 2 랜덤 인카운트와 같음. */
export function battleTroop(data: GameData, params: unknown): string {
  const p = arr<unknown>(params);
  const kind = num(p[0]);
  if (kind === 1) return "변수로 정해짐";
  if (kind === 2) return "맵 랜덤 적";
  return troopName(data, num(p[1]));
}

/** 플러그인 명령이 전투를 시작하는 것처럼 보이는가. 설정 명령(setBattleSys 등)은 아니다. */
export function pluginStartsBattle(c: EventCommand): boolean {
  try {
    const p = arr<unknown>(c.parameters);
    let name = "";
    let words: string[] = [];
    if (c.code === 356) {
      words = (typeof p[0] === "string" ? p[0] : "").split(/\s+/).filter(Boolean);
      name = words[0] ?? "";
    } else if (c.code === 357) {
      name = typeof p[1] === "string" ? p[1] : "";
      words = [name, typeof p[2] === "string" ? p[2] : ""];
      if (isObj(p[3])) for (const v of Object.values(p[3])) if (typeof v === "string") words.push(v);
    } else return false;
    if (!name || SETTING_NAME.test(name)) return false;
    return words.some(w => w !== "" && BATTLE_START.test(w));
  } catch {
    return false;
  }
}

/** 목록에서 at 앞쪽으로 가장 가까운, 변수 varId를 바꾸는 변수 조작(122). 그 변수 하나에 상수 대입이면 그 값, 아니면 null. */
function constantBefore(list: readonly EventCommand[], at: number, varId: number): number | null {
  for (let i = Math.min(at, list.length) - 1; i >= 0; i--) {
    const c = list[i];
    if (!isObj(c) || c.code !== 122) continue;
    const p = arr<unknown>(c.parameters);
    const from = num(p[0]), to = num(p[1]);
    if (varId < Math.min(from, to) || varId > Math.max(from, to)) continue;
    if (from === to && num(p[2]) === 0 && num(p[3]) === 0 && typeof p[4] === "number") return p[4];
    return null;
  }
  return null;
}

/** 보고 있는 목록과 위치(바깥 호출부터 안쪽으로) */
interface Frame { list: EventCommand[]; at: number }

/**
 * 변수로 지정한 적 그룹(301 params[0] === 1): 부르는 쪽(가까운 호출부터) 117 앞의 상수 대입,
 * 없으면 전투 처리가 있는 목록 안 301 앞의 상수 대입. 못 찾으면 `변수로 정해짐`.
 */
function variableTroop(data: GameData, varId: number, frames: readonly Frame[]): string {
  for (let i = frames.length - 2; i >= 0; i--) {
    const v = constantBefore(frames[i]!.list, frames[i]!.at, varId);
    if (v !== null) return troopName(data, v);
  }
  const own = frames.at(-1);
  const v = own ? constantBefore(own.list, own.at, varId) : null;
  return v !== null ? troopName(data, v) : "변수로 정해짐";
}

/**
 * 명령 목록이 전투를 거는가: 목록 안의 전투 처리(301), TemplateEvent 호출로 불린 목록, 공통 이벤트(117, 깊이 2까지).
 * 게임 전체에서 MANY_CALLERS 곳 이상 불리는 공통 이벤트는 그 안(깊이 안)에 전투 처리(301)가 있을 때만 본다
 * (전투 처리용 공통 이벤트). 변수로 지정한 적 그룹은 부르는 쪽의 변수 조작으로 찾아본다.
 * 전투 처리를 모두 모은다(같은 적 그룹은 한 번). 전투 처리가 없고 플러그인 명령(356/357)이 전투를 시작하는 것처럼
 * 보이면 maybe 하나.
 */
export function findBattles(list: unknown, ctx: CallCtx | null, data: GameData): BattleFound[] {
  const found: BattleFound[] = [];
  let maybe = false;
  const add = (out: BattleFound[], b: BattleFound) => { if (!out.some(f => f.troop === b.troop)) out.push(b); };
  /** 돌려주는 값: 플러그인 짐작을 봤는가 */
  const go = (l: unknown, cx: CallCtx | null, depth: number, stack: number[], frames: Frame[], out: BattleFound[]): boolean => {
    let sawMaybe = false;
    const flat = flattenCalls(l, cx);
    for (let i = 0; i < flat.length; i++) {
      const c = flat[i];
      if (!isObj(c)) continue;
      const p = arr<unknown>(c.parameters);
      if (c.code === 301) {
        const troop = num(p[0]) === 1 ? variableTroop(data, num(p[1]), [...frames, { list: flat, at: i }]) : battleTroop(data, p);
        add(out, { troop, canEscape: p[2] === true, canLose: p[3] === true, maybe: false });
      } else if (c.code === 356 || c.code === 357) {
        if (pluginStartsBattle(c)) sawMaybe = true;
      } else if (c.code === 117 && depth < CE_DEPTH) {
        const id = num(p[0]);
        if (stack.includes(id)) continue;
        const ce = arr<{ list?: unknown } | null>(data.commonEvents)[id];
        if (!isObj(ce)) continue;
        const here = [...frames, { list: flat, at: i }];
        if (commonEventCallCount(data, id) >= MANY_CALLERS) {
          // 많이 불리는 공통 이벤트: 전투 처리(301)만 받는다(플러그인 짐작은 버린다)
          const inner: BattleFound[] = [];
          go(ce.list, null, depth + 1, [...stack, id], here, inner);
          for (const b of inner) add(out, b);
        } else if (go(ce.list, null, depth + 1, [...stack, id], here, out)) sawMaybe = true;
      }
    }
    return sawMaybe;
  };
  try { maybe = go(list, ctx, 0, [], [], found); } catch { /* 지금까지 */ }
  if (found.length === 0 && maybe) return [{ troop: null, canEscape: false, canLose: false, maybe: true }];
  return found;
}

/** 적 이벤트 정보 */
export interface EnemyInfo {
  /** 적 그룹 이름들(직접 지정 이름, `변수로 정해짐`, `맵 랜덤 적`). maybe면 비어 있음 */
  troops: string[];
  /** 지금 페이지가 전투를 건다 */
  now: boolean;
  /** 부딪히면 전투(접촉 트리거 1·2) */
  touch: boolean;
  /** 쫓아옴(자율 이동 다가옴, 사용자 정의 경로의 플레이어 쪽으로, 메모·주석의 chase 표시) */
  chase: boolean;
  canEscape: boolean;
  canLose: boolean;
  /** 전투 처리는 없고 플러그인 명령이 전투처럼 보인다(짐작) */
  maybe: boolean;
}

type Page = MapEvent["pages"][number];

/** 페이지가 플레이어를 쫓아오는가 */
export function chasesPlayer(ev: MapEvent, pg: Page | null | undefined): boolean {
  try {
    if (!isObj(pg)) return false;
    const mt = num(pg.moveType);
    if (mt === 2) return true;
    const route = isObj(pg.moveRoute) ? arr<EventCommand | null>(pg.moveRoute.list) : [];
    if (mt === 3 && route.some(c => isObj(c) && c.code === 10)) return true;
    if (typeof ev.note === "string" && CHASE_WORD.test(ev.note)) return true;
    if (route.some(c => isObj(c) && c.code === 45 && CHASE_WORD.test(String(arr<unknown>(c.parameters)[0] ?? "")))) return true;
    return arr<EventCommand | null>(pg.list).some(c => isObj(c) && (c.code === 108 || c.code === 408 || c.code === 355 || c.code === 655)
      && CHASE_WORD.test(String(arr<unknown>(c.parameters)[0] ?? "")));
  } catch {
    return false;
  }
}

/**
 * 이벤트가 적인가: 걸어서 실행하는 페이지(결정 키·접촉, 0~2) 중 전투를 거는 것. 지금 페이지가 그러면 now(그 페이지 정보),
 * 아니면 처음 찾은 페이지 정보. 전투 처리(301)가 있는 페이지가 플러그인 짐작보다 먼저. 없으면 null.
 */
export function enemyOf(ev: MapEvent, mapId: number, data: GameData, activePage: number): EnemyInfo | null {
  try {
    const pages = arr<Page | null>(ev.pages);
    let best: { pi: number; battles: BattleFound[] } | null = null;
    const score = (b: BattleFound[], pi: number) => (pi === activePage ? 2 : 0) + (b.some(x => !x.maybe) ? 1 : 0);
    for (let pi = 0; pi < pages.length; pi++) {
      const pg = pages[pi];
      if (!isObj(pg) || num(pg.trigger) > 2) continue;
      const battles = findBattles(pg.list, { data, mapId, event: ev, page: pi }, data);
      if (battles.length === 0) continue;
      if (!best || score(battles, pi) > score(best.battles, best.pi)) best = { pi, battles };
    }
    if (!best) return null;
    const pg = pages[best.pi]!;
    const real = best.battles.filter(b => !b.maybe);
    const trig = num(pg.trigger);
    return {
      troops: real.map(b => b.troop ?? "").filter(Boolean),
      now: best.pi === activePage,
      touch: trig === 1 || trig === 2,
      chase: chasesPlayer(ev, pg),
      canEscape: real.some(b => b.canEscape),
      canLose: real.length > 0 && real.every(b => b.canLose),
      maybe: real.length === 0,
    };
  } catch {
    return null;
  }
}

/** 카드 한 줄: `적 · {적 그룹} · 부딪히면 전투 · 쫓아옴 · 도망 가능` */
export function describeEnemy(e: EnemyInfo): string {
  const parts = [e.maybe ? "적일 수 있음" : "적"];
  if (e.troops.length > 0) parts.push(e.troops.join(", "));
  else if (e.maybe) parts.push("플러그인으로 전투");
  parts.push(e.touch ? "부딪히면 전투" : "말 걸면 전투");
  if (e.chase) parts.push("쫓아옴");
  if (!e.maybe) {
    parts.push(e.canEscape ? "도망 가능" : "도망 못 감");
    if (e.canLose) parts.push("져도 계속");
  }
  return parts.join(" · ");
}

/** 길찾기에서 피할 칸("x,y"): 적의 칸, 쫓아오는 적은 네 이웃 칸까지. exceptId(가려는 대상)는 뺀다. */
export function enemyTiles(
  enemies: readonly { eventId: number; x: number; y: number; chase: boolean }[], exceptId: number | null, withNeighbours = true,
): Set<string> {
  const out = new Set<string>();
  for (const e of enemies) {
    if (e.eventId === exceptId) continue;
    out.add(`${e.x},${e.y}`);
    if (withNeighbours && e.chase) for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) out.add(`${e.x + dx},${e.y + dy}`);
  }
  return out;
}

// ---- 랜덤 인카운트 ----

export interface EncounterEntry {
  troopId: number; name: string; weight: number;
  /** 고를 확률(%, 소수 첫째 자리까지): 그 칸에서 나올 수 있는 것들 가운데. 구역 지정이 있으면 첫 구역 기준 */
  chance: number;
  /** 나오는 구역 번호(없으면 어디서나) */
  regions: number[];
}
export interface MapEncounters {
  /** 평균 걸음 수 */
  step: number;
  entries: EncounterEntry[];
  /** 쓰이는 구역 번호(오름차순) */
  regions: number[];
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * 맵 데이터의 랜덤 인카운트(encounterList, encounterStep). 적 그룹이 0이거나 무게가 0 이하인 항목은 뺀다.
 * 확률: 구역 지정이 없는 항목은 구역 없는 칸(구역 없는 항목들 무게 합) 기준, 구역 항목은 첫 구역 칸(구역 없는 항목 +
 * 그 구역 항목 무게 합) 기준. 없으면 null.
 */
export function mapEncounters(data: GameData, mapId: number): MapEncounters | null {
  try {
    const map = data?.maps?.get(mapId) as unknown;
    if (!isObj(map)) return null;
    const raw = arr<unknown>(map.encounterList);
    const list = raw.filter(isObj).map(e => ({
      troopId: num(e.troopId), weight: num(e.weight),
      regions: [...new Set(arr<unknown>(e.regionSet).filter((r): r is number => typeof r === "number" && Number.isInteger(r) && r > 0))].sort((a, b) => a - b),
    })).filter(e => e.troopId > 0 && e.weight > 0);
    if (list.length === 0) return null;
    // 어떤 칸에서 나올 수 있는 항목들: 구역 없는 항목 + 그 구역 항목(Game_Player.meetsEncounterConditions)
    const poolWeight = (region: number | null) =>
      list.filter(e => e.regions.length === 0 || (region !== null && e.regions.includes(region))).reduce((s, e) => s + e.weight, 0);
    const entries: EncounterEntry[] = list.map(e => {
      const total = poolWeight(e.regions.length === 0 ? null : e.regions[0]);
      return { troopId: e.troopId, name: troopName(data, e.troopId), weight: e.weight, chance: total > 0 ? round1((e.weight / total) * 100) : 0, regions: e.regions };
    });
    const regions = [...new Set(list.flatMap(e => e.regions))].sort((a, b) => a - b);
    return { step: num(map.encounterStep), entries, regions };
  } catch {
    return null;
  }
}

/** 구역 번호 칸들: 타일 데이터 층 5(z = 5)의 값이 regions에 있는 칸. data = width*height*6 */
export function regionCells(
  map: { width: number; height: number; data: readonly number[] }, regions: readonly number[],
): { x: number; y: number; region: number }[] {
  const out: { x: number; y: number; region: number }[] = [];
  try {
    const want = new Set(regions);
    if (want.size === 0) return out;
    const { width: w, height: h, data } = map;
    const base = 5 * w * h;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const r = data[base + y * w + x];
        if (typeof r === "number" && want.has(r)) out.push({ x, y, region: r });
      }
    }
  } catch { /* 지금까지 */ }
  return out;
}
