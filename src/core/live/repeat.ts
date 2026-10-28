import { describeBranchCondition, describePageConditions } from "../conditions/describe";
import { switchName, variableName } from "../text/names";
import type { ConditionTest, EventCommand, GameData, MapEvent, PageConditions } from "../types";
import { evaluate } from "./evaluate";
import { activePageIndex } from "./interactable";
import type { LiveSnapshot } from "./types";

export interface RepeatInfo {
  kind: "nextPage" | "counter" | "random" | "choiceDependent";
  text: string;
  /** 몇 번째 상호작용 뒤(nextPage)·부터(counter) 달라지는지. random·choiceDependent는 0 */
  after: number;
  /** 플러그인 명령·스크립트 등 데이터로 알 수 없는 명령이 있어 추정한 결과 */
  estimated: boolean;
}

const MAX_RUNS = 5;
const MAX_CALL_DEPTH = 5;
const MAX_STEPS = 10_000;
/** 상태를 바꾸는 명령: 스위치·변수·셀프 스위치·소지금·아이템·무기·방어구·파티·공통 이벤트 */
const WRITE_CODES = new Set([121, 122, 123, 125, 126, 127, 128, 129, 117]);
const OPAQUE_CODES = new Set([355, 356, 357]);

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object";
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

/** 시뮬레이션용 상태. live를 깊게 복사해 원본을 건드리지 않는다. */
function cloneLive(live: LiveSnapshot): LiveSnapshot {
  const rec = (v: unknown): Record<string, number> => (isObj(v) ? { ...(v as Record<string, number>) } : {});
  return {
    ...live,
    events: [],
    switches: arr<number>(live.switches).slice(),
    variables: rec(live.variables),
    selfSwitches: arr<string>(live.selfSwitches).slice(),
    items: rec(live.items), weapons: rec(live.weapons), armors: rec(live.armors),
    gold: num(live.gold),
    party: arr<number>(live.party).slice(),
    choice: null,
  };
}

interface Sim {
  data: GameData; mapId: number; eventId: number;
  state: LiveSnapshot;
  /** 무작위 값이 들어간 변수 */
  randomVars: Set<number>;
  random: boolean; choiceDependent: boolean; estimated: boolean;
  /** 판정할 수 없는 조건을 만나 시뮬레이션을 멈췄다 */
  unknown: boolean;
  steps: number;
}

function setSwitch(s: LiveSnapshot, id: number, on: boolean) {
  const has = s.switches.includes(id);
  if (on && !has) s.switches.push(id);
  if (!on && has) s.switches = s.switches.filter(x => x !== id);
}
function setSelf(s: LiveSnapshot, key: string, on: boolean) {
  const has = s.selfSwitches.includes(key);
  if (on && !has) s.selfSwitches.push(key);
  if (!on && has) s.selfSwitches = s.selfSwitches.filter(x => x !== key);
}
function setBag(bag: Record<string, number>, id: number, value: number) {
  if (value === 0) delete bag[String(id)];
  else bag[String(id)] = value;
}
const getVar = (s: LiveSnapshot, id: number) => num(s.variables[String(id)]);

function applyVariables(sim: Sim, p: any[]) {
  const [start, end, op, operandType] = [num(p[0]), num(p[1]), num(p[2]), num(p[3])];
  let value: number;
  let random = false;
  switch (operandType) {
    case 0: value = num(p[4]); break;
    case 1: value = getVar(sim.state, num(p[4])); break;
    case 2: value = Math.min(num(p[4]), num(p[5])); random = true; break;
    case 4:
      if (/Math\.random/.test(String(p[4] ?? ""))) { value = 0; random = true; break; }
      sim.estimated = true; return;
    default: sim.estimated = true; return;   // 게임 데이터 값: 알 수 없다
  }
  for (let id = start; id <= end && id - start < 10_000; id++) {
    const cur = getVar(sim.state, id);
    let next = cur;
    switch (op) {
      case 0: next = value; break;
      case 1: next = cur + value; break;
      case 2: next = cur - value; break;
      case 3: next = cur * value; break;
      case 4: next = value === 0 ? cur : Math.floor(cur / value); break;
      case 5: next = value === 0 ? cur : cur % value; break;
    }
    setBag(sim.state.variables, id, next);
    if (random) sim.randomVars.add(id);
  }
}

function applyGain(sim: Sim, bag: Record<string, number>, p: any[]) {
  const amount = num(p[2]) === 1 ? getVar(sim.state, num(p[3])) : num(p[3]);
  const id = num(p[0]);
  setBag(bag, id, Math.max(0, num(bag[String(id)]) + (num(p[1]) === 0 ? amount : -amount)));
}

/** 같은 들여쓰기에서 codes 중 하나인 다음 명령 인덱스. 없으면 list.length */
function findAt(list: unknown[], from: number, indent: number, codes: number[]): number {
  for (let i = from; i < list.length; i++) {
    const c = list[i] as EventCommand;
    if (isObj(c) && c.indent === indent && codes.includes(c.code)) return i;
    if (isObj(c) && typeof c.indent === "number" && c.indent < indent) return i;
  }
  return list.length;
}

/** 공통 이벤트 목록(깊이 제한)에 상태를 바꾸는 명령이 있는지 */
function hasWrites(list: unknown[], data: GameData, depth: number): boolean {
  for (const c of list) {
    if (!isObj(c)) continue;
    if (c.code === 117) {
      if (depth < MAX_CALL_DEPTH && hasWrites(arr(data.commonEvents?.[num(arr(c.parameters)[0])]?.list), data, depth + 1)) return true;
    } else if (WRITE_CODES.has(c.code)) return true;
  }
  return false;
}

/** 명령 목록을 실행한다. 보인 대사는 shown에 넣는다. 판정 불가면 false(중단). */
function run(sim: Sim, list: unknown[], prefix: string, depth: number, shown: Set<string>): boolean {
  const { data } = sim;
  let i = 0;
  while (i < list.length) {
    if (++sim.steps > MAX_STEPS) { sim.unknown = true; return false; }
    const cmd = list[i];
    if (!isObj(cmd)) { i++; continue; }
    const p = arr<any>(cmd.parameters);
    const indent = num(cmd.indent);
    switch (cmd.code) {
      case 101: case 105:
        shown.add(`${prefix}${i}`);
        break;
      case 102: {
        const end = findAt(list, i + 1, indent, [404]);
        if (hasWrites(list.slice(i + 1, end), data, depth)) sim.choiceDependent = true;
        i = end + 1;
        continue;
      }
      case 111: {
        if (p[0] === 12) {
          if (/Math\.random/.test(String(p[1] ?? ""))) sim.random = true;
          sim.unknown = true; return false;
        }
        const test = describeBranchCondition(p, data).test;
        if (test?.kind === "variable" && sim.randomVars.has(test.id)) sim.random = true;
        if (test?.kind === "variableVar" && (sim.randomVars.has(test.id) || sim.randomVars.has(test.otherId))) sim.random = true;
        const status = evaluate(test, sim.state, { mapId: sim.mapId, eventId: sim.eventId });
        if (status === "unknown") { sim.unknown = true; return false; }
        if (status === "met") break;
        const at = findAt(list, i + 1, indent, [411, 412]);
        i = at + 1;
        continue;
      }
      case 411:   // then 쪽을 다 돌고 else에 닿음 → 분기 끝으로
        i = findAt(list, i + 1, indent, [412]) + 1;
        continue;
      case 112:   // 반복: 몇 번 도는지 알 수 없어 건너뛴다
        sim.estimated = true;
        i = findAt(list, i + 1, indent, [413]) + 1;
        continue;
      case 115:   // 이벤트 처리 중단
        return true;
      case 117: {
        if (depth >= MAX_CALL_DEPTH) { sim.estimated = true; break; }
        const id = num(p[0]);
        const ce = data.commonEvents?.[id];
        if (isObj(ce) && !run(sim, arr(ce.list), `C${id}:`, depth + 1, shown)) return false;
        break;
      }
      case 121: {
        for (let id = num(p[0]); id <= num(p[1]) && id - num(p[0]) < 10_000; id++) setSwitch(sim.state, id, num(p[2]) === 0);
        break;
      }
      case 122: applyVariables(sim, p); break;
      case 123:
        setSelf(sim.state, `${sim.mapId},${sim.eventId},${p[0]}`, num(p[1]) === 0);
        break;
      case 125: {
        const amount = num(p[1]) === 1 ? getVar(sim.state, num(p[2])) : num(p[2]);
        sim.state.gold = Math.max(0, sim.state.gold + (num(p[0]) === 0 ? amount : -amount));
        break;
      }
      case 126: applyGain(sim, sim.state.items, p); break;
      case 127: applyGain(sim, sim.state.weapons, p); break;
      case 128: applyGain(sim, sim.state.armors, p); break;
      case 129: {
        const id = num(p[0]);
        if (num(p[1]) === 0) { if (!sim.state.party.includes(id)) sim.state.party.push(id); }
        else sim.state.party = sim.state.party.filter(x => x !== id);
        break;
      }
      default:
        if (OPAQUE_CODES.has(cmd.code)) {
          sim.estimated = true;
          if (cmd.code === 355 && /Math\.random/.test(String(p[0] ?? ""))) sim.random = true;
        }
    }
    i++;
  }
  return true;
}

type Change = { kind: "switch" | "variable" | "selfSwitch"; id: number | string; on?: boolean };

/** 두 상태 사이에 바뀐 스위치·변수·이 이벤트의 셀프 스위치 */
function changes(a: LiveSnapshot, b: LiveSnapshot, mapId: number, eventId: number): Change[] {
  const out: Change[] = [];
  const sw = new Set([...a.switches, ...b.switches]);
  for (const id of sw) if (a.switches.includes(id) !== b.switches.includes(id)) out.push({ kind: "switch", id, on: b.switches.includes(id) });
  const vars = new Set([...Object.keys(a.variables), ...Object.keys(b.variables)]);
  for (const k of vars) if (getVar(a, Number(k)) !== getVar(b, Number(k))) out.push({ kind: "variable", id: Number(k) });
  const prefix = `${mapId},${eventId},`;
  const self = new Set([...a.selfSwitches, ...b.selfSwitches].filter(k => k.startsWith(prefix)));
  for (const k of self) {
    if (a.selfSwitches.includes(k) !== b.selfSwitches.includes(k)) out.push({ kind: "selfSwitch", id: k.slice(prefix.length), on: b.selfSwitches.includes(k) });
  }
  return out;
}

function causeText(ch: Change[], data: GameData): string {
  if (ch.length !== 1) return "";
  const c = ch[0];
  const onOff = c.on ? "켜져" : "꺼져";
  switch (c.kind) {
    case "selfSwitch": return `셀프 스위치 ${c.id}가 ${onOff} `;
    case "switch": return `스위치 [${switchName(data, Number(c.id))}]이(가) ${onOff} `;
    case "variable": return `변수 [${variableName(data, Number(c.id))}]이(가) 바뀌어 `;
  }
}

function counterNote(ch: Change[], data: GameData): string {
  if (ch.length !== 1) return "";
  const c = ch[0];
  switch (c.kind) {
    case "variable": return ` (변수 [${variableName(data, Number(c.id))}]를 셈)`;
    case "switch": return ` (스위치 [${switchName(data, Number(c.id))}])`;
    case "selfSwitch": return ` (셀프 스위치 ${c.id})`;
  }
}

// ---- 시뮬레이션이 읽는 상태 ----
/** 시뮬레이션 결과에 영향을 주는 원자: 조건·연산 값으로 읽거나 쓰는 것(쓰는 것도 바뀐 내용을 알려 주므로 넣는다). */
interface Reads {
  switches: Set<number>; variables: Set<number>;
  items: Set<number>; weapons: Set<number>; armors: Set<number>; actors: Set<number>;
  gold: boolean; selfSwitch: boolean;
}
const ID_SETS = ["switches", "variables", "items", "weapons", "armors", "actors"] as const;
const newReads = (): Reads => ({
  switches: new Set(), variables: new Set(), items: new Set(), weapons: new Set(), armors: new Set(), actors: new Set(),
  gold: false, selfSwitch: false,
});
function mergeReads(into: Reads, from: Reads) {
  for (const k of ID_SETS) for (const id of from[k]) into[k].add(id);
  into.gold ||= from.gold;
  into.selfSwitch ||= from.selfSwitch;
}
function addRange(set: Set<number>, start: number, end: number) {
  for (let id = start; id <= end && id - start < 10_000; id++) set.add(id);
}
function addTest(r: Reads, t: ConditionTest | undefined) {
  if (!t) return;
  switch (t.kind) {
    case "switch": r.switches.add(t.id); break;
    case "variable": r.variables.add(t.id); break;
    case "variableVar": r.variables.add(t.id); r.variables.add(t.otherId); break;
    case "selfSwitch": r.selfSwitch = true; break;
    case "item": r.items.add(t.id); break;
    case "weapon": r.weapons.add(t.id); break;
    case "armor": r.armors.add(t.id); break;
    case "actorInParty": r.actors.add(t.id); break;
    case "gold": r.gold = true; break;
  }
}

/** data → (페이지 객체 → 출현 조건이 읽는 원자) / (페이지 객체 → 명령 목록이 읽고 쓰는 원자) */
const condReadsCache = new WeakMap<object, WeakMap<object, Reads>>();
const listReadsCache = new WeakMap<object, WeakMap<object, Reads>>();
function memo(store: WeakMap<object, WeakMap<object, Reads>>, data: GameData, key: object, make: () => Reads): Reads {
  let m = store.get(data);
  if (!m) { m = new WeakMap(); store.set(data, m); }
  let hit = m.get(key);
  if (!hit) { hit = make(); m.set(key, hit); }
  return hit;
}

function pageCondReads(pg: unknown, data: GameData): Reads {
  if (!isObj(pg)) return newReads();
  return memo(condReadsCache, data, pg, () => {
    const r = newReads();
    if (isObj(pg.conditions)) for (const cd of describePageConditions(pg.conditions as PageConditions, num(pg.trigger), data)) addTest(r, cd?.test);
    return r;
  });
}

function scanReads(r: Reads, list: unknown[], data: GameData, depth: number, seen: Set<number>) {
  for (const cmd of list) {
    if (!isObj(cmd)) continue;
    const p = arr<any>(cmd.parameters);
    switch (cmd.code) {
      case 111: if (p[0] !== 12) addTest(r, describeBranchCondition(p, data).test); break;
      case 117: {
        const id = num(p[0]);
        if (depth < MAX_CALL_DEPTH && !seen.has(id)) {
          seen.add(id);
          scanReads(r, arr(data.commonEvents?.[id]?.list), data, depth + 1, seen);
        }
        break;
      }
      case 121: addRange(r.switches, num(p[0]), num(p[1])); break;
      case 122:
        addRange(r.variables, num(p[0]), num(p[1]));
        if (num(p[3]) === 1) r.variables.add(num(p[4]));
        break;
      case 123: r.selfSwitch = true; break;
      case 125:
        r.gold = true;
        if (num(p[1]) === 1) r.variables.add(num(p[2]));
        break;
      case 126: case 127: case 128:
        (cmd.code === 126 ? r.items : cmd.code === 127 ? r.weapons : r.armors).add(num(p[0]));
        if (num(p[2]) === 1) r.variables.add(num(p[3]));
        break;
      case 129: r.actors.add(num(p[0])); break;
    }
  }
}

function pageListReads(pg: unknown, data: GameData): Reads {
  if (!isObj(pg)) return newReads();
  return memo(listReadsCache, data, pg, () => {
    const r = newReads();
    scanReads(r, arr(pg.list), data, 0, new Set());
    return r;
  });
}

/** 이 이벤트의 시뮬레이션이 읽는 원자: 모든 페이지의 출현 조건 + 시작 페이지 명령(호출한 공통 이벤트 포함, 깊이 5). */
function eventReads(ev: MapEvent, page: number, data: GameData): Reads {
  const r = newReads();
  for (const pg of arr<unknown>(ev.pages)) mergeReads(r, pageCondReads(pg, data));
  mergeReads(r, pageListReads(ev.pages[page], data));
  return r;
}

/** reads에 든 원자의 값만으로 만든 상태 키. */
function stateKey(s: LiveSnapshot, r: Reads, mapId: number, eventId: number): string {
  const sorted = (ids: Set<number>) => [...ids].sort((a, b) => a - b);
  const vals = (bag: unknown, ids: Set<number>) => {
    const b = isObj(bag) ? bag : {};
    return sorted(ids).map(id => `${id}=${num(b[String(id)])}`).join(",");
  };
  const flags = (list: unknown, ids: Set<number>) => {
    const have = new Set(arr<number>(list));
    return sorted(ids).filter(id => have.has(id)).join(",");
  };
  const prefix = `${mapId},${eventId},`;
  return [
    flags(s.switches, r.switches), vals(s.variables, r.variables),
    vals(s.items, r.items), vals(s.weapons, r.weapons), vals(s.armors, r.armors),
    flags(s.party, r.actors),
    r.gold ? String(num(s.gold)) : "",
    r.selfSwitch ? arr<unknown>(s.selfSwitches).map(String).filter(k => k.startsWith(prefix)).sort().join(",") : "",
  ].join("|");
}

const sameSet =(a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every(x => b.has(x));

function analyse(ev: MapEvent, mapId: number, data: GameData, live: LiveSnapshot, first: number, reads: Reads): RepeatInfo[] {
  const start = cloneLive(live);
  if (first < 0) return [];
  /** 시뮬레이션 상태로 계산한 기준 페이지. live.events가 알려 준 실제 활성 페이지(first)와 다를 수 있다. */
  const base = activePageIndex(ev, mapId, data, start);
  const sim: Sim = {
    data, mapId, eventId: ev.id, state: cloneLive(start), randomVars: new Set(),
    random: false, choiceDependent: false, estimated: false, unknown: false, steps: 0,
  };
  const found: Omit<RepeatInfo, "estimated">[] = [];
  let firstShown: Set<string> | null = null;
  const keyOf = (st: LiveSnapshot) => stateKey(st, reads, mapId, ev.id);
  let prevKey = keyOf(sim.state);
  for (let k = 1; k <= MAX_RUNS; k++) {
    if (k > 1 && activePageIndex(ev, mapId, data, sim.state) !== base) break;
    const before = cloneLive(sim.state);
    const shown = new Set<string>();
    sim.steps = 0;
    const ok = run(sim, arr(ev.pages[first]?.list), "", 0, shown);
    if (firstShown === null) firstShown = shown;
    else if (ok && !sameSet(firstShown, shown)) {
      found.push({ kind: "counter", text: `${k}번째부터 다른 대사가 나와요${counterNote(changes(start, before, mapId, ev.id), data)}`, after: k });
      break;
    }
    if (!ok) break;
    const next = activePageIndex(ev, mapId, data, sim.state);
    if (next !== base) {
      if (next >= 0 && next !== first) {
        const lead = k === 1 ? `말을 걸면 ${causeText(changes(start, sim.state, mapId, ev.id), data)}` : `${k}번 하면 `;
        found.push({ kind: "nextPage", text: `${lead}다음엔 ${next + 1}페이지가 나와요`, after: k });
      }
      break;
    }
    const key = keyOf(sim.state);
    if (key === prevKey) break;   // 상태가 그대로면 다음에도 똑같다
    prevKey = key;
  }
  if (sim.random) found.push({ kind: "random", text: "무작위로 다른 대사가 나와요", after: 0 });
  if (sim.choiceDependent) found.push({ kind: "choiceDependent", text: "고르는 선택지에 따라 다음 내용이 달라져요", after: 0 });
  return found.map(f => ({ ...f, estimated: sim.estimated }));
}

export const REPEAT_CACHE_LIMIT = 2000;
const CACHE_LIMIT = REPEAT_CACHE_LIMIT;
/** data → (맵·이벤트·페이지 + 시뮬레이션이 읽는 상태 키 → 결과). 가장 오래 안 쓴 것부터 버린다(LRU). */
const cache = new WeakMap<object, Map<string, RepeatInfo[]>>();
/** 페이지 객체마다 붙이는 번호: 같은 data 안에서 다른 페이지 객체가 같은 키를 쓰지 않게 한다. */
const pageIds = new WeakMap<object, number>();
let nextPageId = 1;
function pageId(pg: object): number {
  let id = pageIds.get(pg);
  if (id === undefined) { id = nextPageId++; pageIds.set(pg, id); }
  return id;
}
/** 테스트용: data의 캐시 항목 수 */
export function repeatCacheSize(data: GameData): number {
  return isObj(data) ? cache.get(data)?.size ?? 0 : 0;
}

/**
 * 이벤트의 지금 활성 페이지를 여러 번(최대 5번) 상호작용한다고 보고 live 복사본에서 시뮬레이션해,
 * 다음 상호작용에서 내용이 달라지는지 알려준다. [] = 매번 같음. live는 바꾸지 않는다. 예외를 던지지 않는다.
 * startPage: 실제 활성 페이지(live.events)를 알 때 넘긴다. 없으면 activePageIndex로 계산한다.
 */
export function repeatInfo(ev: MapEvent, mapId: number, data: GameData, live: LiveSnapshot, startPage?: number): RepeatInfo[] {
  try {
    if (!isObj(ev) || !isObj(live) || !isObj(data) || typeof ev.id !== "number" || !Array.isArray(ev.pages)) return [];
    const pg = typeof startPage === "number" && startPage >= 0 ? startPage : activePageIndex(ev, mapId, data, live);
    const pageObj = ev.pages[pg];
    if (!isObj(pageObj)) return [];
    const reads = eventReads(ev, pg, data);
    let byKey = cache.get(data);
    if (!byKey) { byKey = new Map(); cache.set(data, byKey); }
    // 모든 페이지 객체 번호: 활성 페이지 판정에 다른 페이지도 쓰인다
    const pagesKey = ev.pages.map(p => (isObj(p) ? pageId(p) : 0)).join(",");
    const key = `${pagesKey}|${mapId},${ev.id},${pg}|${stateKey(live, reads, mapId, ev.id)}`;
    let hit = byKey.get(key);
    if (hit) {
      byKey.delete(key);   // 최근에 쓴 것으로 옮긴다
    } else {
      hit = analyse(ev, mapId, data, live, pg, reads);
      if (byKey.size >= CACHE_LIMIT) {
        const oldest = byKey.keys().next().value;
        if (oldest !== undefined) byKey.delete(oldest);
      }
    }
    byKey.set(key, hit);
    return hit.map(r => ({ ...r }));
  } catch {
    return [];
  }
}
