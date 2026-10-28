import { describeBranchCondition } from "../conditions/describe";
import { switchName, variableName } from "../text/names";
import type { EventCommand, GameData, MapEvent } from "../types";
import { evaluate } from "./evaluate";
import { activePageIndex, conditionsKey } from "./interactable";
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

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every(x => b.has(x));

function analyse(ev: MapEvent, mapId: number, data: GameData, live: LiveSnapshot): RepeatInfo[] {
  const start = cloneLive(live);
  const first = activePageIndex(ev, mapId, data, start);
  if (first < 0) return [];
  const sim: Sim = {
    data, mapId, eventId: ev.id, state: cloneLive(start), randomVars: new Set(),
    random: false, choiceDependent: false, estimated: false, unknown: false, steps: 0,
  };
  const found: Omit<RepeatInfo, "estimated">[] = [];
  let firstShown: Set<string> | null = null;
  let prevKey = conditionsKey(sim.state);
  for (let k = 1; k <= MAX_RUNS; k++) {
    const pg = activePageIndex(ev, mapId, data, sim.state);
    if (pg !== first) break;
    const before = cloneLive(sim.state);
    const shown = new Set<string>();
    sim.steps = 0;
    const ok = run(sim, arr(ev.pages[pg]?.list), "", 0, shown);
    if (firstShown === null) firstShown = shown;
    else if (ok && !sameSet(firstShown, shown)) {
      found.push({ kind: "counter", text: `${k}번째부터 다른 대사가 나와요${counterNote(changes(start, before, mapId, ev.id), data)}`, after: k });
      break;
    }
    if (!ok) break;
    const next = activePageIndex(ev, mapId, data, sim.state);
    if (next !== first) {
      if (next >= 0) {
        const lead = k === 1 ? `말을 걸면 ${causeText(changes(start, sim.state, mapId, ev.id), data)}` : `${k}번 하면 `;
        found.push({ kind: "nextPage", text: `${lead}다음엔 ${next + 1}페이지가 나와요`, after: k });
      }
      break;
    }
    const key = conditionsKey(sim.state);
    if (key === prevKey) break;   // 상태가 그대로면 다음에도 똑같다
    prevKey = key;
  }
  if (sim.random) found.push({ kind: "random", text: "무작위로 다른 대사가 나와요", after: 0 });
  if (sim.choiceDependent) found.push({ kind: "choiceDependent", text: "고르는 선택지에 따라 다음 내용이 달라져요", after: 0 });
  return found.map(f => ({ ...f, estimated: sim.estimated }));
}

/** data → (페이지 객체 → (이벤트·조건 키 → 결과)) */
const cache = new WeakMap<object, WeakMap<object, Map<string, RepeatInfo[]>>>();

/**
 * 이벤트의 지금 활성 페이지를 여러 번(최대 5번) 상호작용한다고 보고 live 복사본에서 시뮬레이션해,
 * 다음 상호작용에서 내용이 달라지는지 알려준다. [] = 매번 같음. live는 바꾸지 않는다. 예외를 던지지 않는다.
 */
export function repeatInfo(ev: MapEvent, mapId: number, data: GameData, live: LiveSnapshot): RepeatInfo[] {
  try {
    if (!isObj(ev) || !isObj(live) || !isObj(data) || typeof ev.id !== "number" || !Array.isArray(ev.pages)) return [];
    const pg = activePageIndex(ev, mapId, data, live);
    const pageObj = ev.pages[pg];
    if (!isObj(pageObj)) return [];
    let byPage = cache.get(data);
    if (!byPage) { byPage = new WeakMap(); cache.set(data, byPage); }
    let byKey = byPage.get(pageObj);
    if (!byKey) { byKey = new Map(); byPage.set(pageObj, byKey); }
    const key = `${mapId},${ev.id}|${conditionsKey({ ...live, events: [] })}|${num(live.gold)}`;
    let hit = byKey.get(key);
    if (!hit) { hit = analyse(ev, mapId, data, live); byKey.set(key, hit); }
    return hit.map(r => ({ ...r }));
  } catch {
    return [];
  }
}
