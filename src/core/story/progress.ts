// 이야기 진행 기준(본편 진행 변수·클리어 스위치 묶음) 후보를 데이터만으로 고른다. 예외를 던지지 않는다.
import { buildDepGraph, mapCtxId, type CtxId, type DepGraph } from "../deps/graph";
import type { LiveSnapshot } from "../live/types";
import { switchName, variableName } from "../text/names";
import type { EventCommand, GameData, MapEvent } from "../types";

/** 이야기 진행 기준: 변수 하나(값이 커질수록 진행) 또는 차례로 켜지는 스위치 묶음(켜진 수 = 진행). */
export type StoryKey = { kind: "variable"; id: number } | { kind: "switches"; ids: number[] };
export interface StoryCandidate { key: StoryKey; label: string; score: number; reasons: string[] }

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object";
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** 본편 진행으로 보이는 이름 중 가장 확실한 것(장·본편·시나리오) */
const TOP_NAME = /章|チャプター|chapter|本編|メインストーリー|main\s*story|ストーリー|story|シナリオ|scenario|메인\s*스토리|챕터|스토리|시나리오/i;
/** 일반적인 진행 낱말(진행도·진척 등) */
const GENERIC_NAME = /進行|進捗|progress|main|메인|진행/i;
/** 본편 진행으로 보이는 이름(후보에 넣는 기준) */
export const PROGRESS_NAME = new RegExp(`${TOP_NAME.source}|${GENERIC_NAME.source}`, "i");
/** 곁가지(조사·임무·퀘스트·종류 번호)로 보이는 이름 */
const SIDE_NAME = /調査|ミッション|クエスト|quest|mission|サブ|sub|種別|type|フラグ番号|依頼|퀘스트|미션|조사|서브|종류/i;
/** 능력치·누적값으로 보이는 이름(레벨·호감도·경험·점수·횟수·돈 등) */
const STAT_NAME = /レベル|\blv|level|好感|affection|経験|\bexp|ポイント|point|回数|count|カウント|\bhp\b|\bmp\b|金|money|gold|所持|ゴールド|레벨|호감|경험|포인트|횟수|카운트|돈/i;
/** 진행 변수가 아닐 것 같은 이름(임시·좌표·난수·선택 등) */
const NOT_PROGRESS_NAME = /一時|ワーク|work|temp|tmp|座標|乱数|random|選択|좌표|임시|선택|난수/i;
/** 이만큼 넓게 불리는 공통 이벤트의 더하기는 능력치 누적으로 본다 */
const WIDE_CALLERS = 5;
/** 차례로 켜지는 진행 스위치로 보이는 이름 */
const CLEAR_SWITCH_NAME = /クリア|clear|完了|終了|済|攻略|撃破|突破|클리어|완료|진행|進行|章|chapter|story|ストーリー|스토리/i;

/** 변수·스위치가 어디서 조건으로 쓰이는지(게임마다 한 번). */
export interface StoryScan {
  /** 변수 id → 페이지 출현 조건으로 쓰는 이벤트("맵:이벤트")·맵 */
  varEvents: Map<number, Set<string>>;
  varMaps: Map<number, Set<number>>;
  /** 변수 id → 조건으로 나오는 값(페이지 출현 조건 ≥, 조건 분기의 상수 비교) */
  varGates: Map<number, Set<number>>;
  /** 변수 id → 조건 분기(111)에서 쓰는 수 */
  varBranches: Map<number, number>;
  /** 스위치 id → 페이지 출현 조건으로 쓰는 이벤트 수 */
  swEvents: Map<number, number>;
  /** 문맥 → 대사(101) 수 */
  talkCount: Map<CtxId, number>;
}

const scanCache = new WeakMap<GameData, StoryScan>();

function addTo<K, V>(m: Map<K, Set<V>>, k: K, v: V) {
  const s = m.get(k);
  if (s) s.add(v); else m.set(k, new Set([v]));
}

function scanList(scan: StoryScan, list: unknown): number {
  let talks = 0;
  for (const c of arr<EventCommand | null>(list)) {
    if (!isObj(c)) continue;
    if (c.code === 101) talks++;
    else if (c.code === 111) {
      const p = arr<unknown>(c.parameters);
      if (num(p[0]) === 1) {
        const id = num(p[1]);
        scan.varBranches.set(id, (scan.varBranches.get(id) ?? 0) + 1);
        if (num(p[2]) === 0) addTo(scan.varGates, id, num(p[3]));
      }
    }
  }
  return talks;
}

/** 변수·스위치가 조건으로 쓰이는 곳을 한 번 훑는다(템플릿 맵 제외). */
export function storyScan(data: GameData): StoryScan {
  const hit = scanCache.get(data);
  if (hit) return hit;
  const scan: StoryScan = {
    varEvents: new Map(), varMaps: new Map(), varGates: new Map(), varBranches: new Map(), swEvents: new Map(), talkCount: new Map(),
  };
  try {
    if (data.maps instanceof Map) {
      for (const [mapId, m] of data.maps) {
        if (mapId === data.templateMapId || !isObj(m)) continue;
        for (const ev of arr<MapEvent | null>(m.events)) {
          if (!isObj(ev)) continue;
          const swSeen = new Set<number>();
          arr<MapEvent["pages"][number] | null>(ev.pages).forEach((pg, pi) => {
            if (!isObj(pg)) return;
            const cd = isObj(pg.conditions) ? pg.conditions : null;
            if (cd?.variableValid) {
              const id = num(cd.variableId);
              addTo(scan.varEvents, id, `${mapId}:${ev.id}`);
              addTo(scan.varMaps, id, mapId);
              addTo(scan.varGates, id, num(cd.variableValue));
            }
            if (cd?.switch1Valid) swSeen.add(num(cd.switch1Id));
            if (cd?.switch2Valid) swSeen.add(num(cd.switch2Id));
            scan.talkCount.set(mapCtxId(mapId, num(ev.id), pi), scanList(scan, pg.list));
          });
          for (const s of swSeen) scan.swEvents.set(s, (scan.swEvents.get(s) ?? 0) + 1);
        }
      }
    }
    for (const ce of arr<{ id?: unknown; list?: unknown } | null>(data.commonEvents)) {
      if (isObj(ce)) scan.talkCount.set(`C${num(ce.id)}`, scanList(scan, ce.list));
    }
  } catch { /* 지금까지 */ }
  scanCache.set(data, scan);
  return scan;
}

function scoreVariable(data: GameData, g: DepGraph, scan: StoryScan, id: number): StoryCandidate | null {
  const name = variableName(data, id);
  const rawName = data.system?.variables?.[id] ?? "";
  const reasons: string[] = [];
  let score = 0;
  // ---- 이름: 장·본편 > 일반 진행 낱말, 곁가지·능력치 낱말은 깎는다 ----
  const top = !!rawName && TOP_NAME.test(rawName);
  const generic = !top && !!rawName && GENERIC_NAME.test(rawName);
  const strong = top || generic;
  if (top) { score += 45; reasons.push("이름이 본편 진행 변수 같아요"); }
  else if (generic) { score += 25; reasons.push("이름이 진행 변수 같아요"); }
  if (rawName && SIDE_NAME.test(rawName)) score -= 20;
  if (rawName && !top && STAT_NAME.test(rawName)) score -= 40;
  if (rawName && NOT_PROGRESS_NAME.test(rawName)) score -= 25;
  // ---- 조건으로 쓰이는 곳 ----
  const events = scan.varEvents.get(id)?.size ?? 0;
  const maps = scan.varMaps.get(id)?.size ?? 0;
  const branches = scan.varBranches.get(id) ?? 0;
  if (events > 0) {
    score += Math.min(20, maps * 3) + Math.min(10, events);
    reasons.push(`${maps}개 맵 ${events}개 이벤트의 출현 조건`);
  }
  score += Math.min(8, branches * 0.4);
  // ---- 쓰는 곳: 여러 맵에서 상수로 정해 올라가면 진행, 넓게 불리는 더하기·자주 내려가면 누적값 ----
  const writers = g.writersOf({ kind: "variable", id });
  let traced = 0, setUp = 0, raise = 0, down = 0, reset = 0, wide = 0, talky = 0, advance = 0;
  const values = new Set<number>();
  const writerMaps = new Set<number>();
  for (const w of writers) {
    const { op, value } = w.write;
    if (op === "script" || op === "other") continue;
    traced++;
    const info = g.ctxs.get(w.ctx);
    const callers = info?.callers ?? [];
    const loc = info?.location;
    const widely = loc?.source === "troop" || (loc?.source === "common" && (callers.length >= WIDE_CALLERS || info?.trigger === 2));
    if (op === "set" && value !== undefined && value > 0) { setUp++; values.add(value); }
    else if (op === "set" && value !== undefined && value <= 0) { reset++; continue; }
    else if (op === "add" && value !== undefined && value > 0) { raise++; if (widely) { wide++; continue; } }
    else { down++; continue; }
    // 값을 올리는 쓰기만 여기로 온다
    if (loc?.source === "map") writerMaps.add(loc.mapId);
    else if (loc?.source === "common" && !widely) {
      for (const c of callers) { const l = g.ctxs.get(c)?.location; if (l?.source === "map") writerMaps.add(l.mapId); }
    }
    const talks = (scan.talkCount.get(w.ctx) ?? 0) + (loc?.source === "common" && !widely ? Math.max(0, ...callers.map(c => scan.talkCount.get(c) ?? 0)) : 0);
    if (talks >= 3) talky++;
    const target = op === "set" ? (value ?? 0) : null;
    if (w.reqs.some(r => r.test.kind === "variable" && r.test.id === id && (r.test.op === ">=" || r.test.op === "=" || r.test.op === ">")
      && (target === null || r.test.value < target))) advance++;
  }
  if (traced === 0) return null;
  const up = setUp + raise - wide;
  score += (setUp / traced) * 15 + Math.min(12, values.size * 1.2) + Math.min(15, writerMaps.size * 1.5);
  if (up > 0) score += (talky / up) * 10 + (advance / up) * 10;
  score -= ((down + reset * 0.5) / traced) * 25 + (wide / traced) * 30;
  if (values.size >= 3) reasons.push(`값을 ${values.size}단계로 정해요`);
  if (writerMaps.size >= 3) reasons.push(`${writerMaps.size}개 맵에서 올려요`);
  if (up > 0 && talky / up >= 0.5) reasons.push("대사가 많은 곳에서 바뀌어요");
  if (!strong && events < 2) return null;
  if (score < 20) return null;
  return { key: { kind: "variable", id }, label: `변수 ${name}`, score: Math.round(score), reasons };
}

function switchGroup(data: GameData, g: DepGraph, scan: StoryScan): StoryCandidate | null {
  const names = arr<unknown>(data.system?.switches);
  const ids: number[] = [];
  let used = 0;
  for (let id = 1; id < names.length && ids.length < 60; id++) {
    const n = names[id];
    if (typeof n !== "string" || !CLEAR_SWITCH_NAME.test(n)) continue;
    const ev = scan.swEvents.get(id) ?? 0;
    if (ev === 0) continue;
    if (!g.writersOf({ kind: "switch", id }).some(w => w.write.op === "on")) continue;
    ids.push(id);
    used += ev;
  }
  if (ids.length < 2) return null;
  const score = Math.round(10 + Math.min(25, ids.length * 3) + Math.min(10, used * 0.5));
  const first = switchName(data, ids[0]);
  return {
    key: { kind: "switches", ids },
    label: `스위치 묶음 ${first} 외 ${ids.length - 1}개`,
    score,
    reasons: [`이름이 진행 스위치 같은 ${ids.length}개`],
  };
}

const candCache = new WeakMap<GameData, StoryCandidate[]>();

/** 이야기 진행 기준 후보(점수 높은 순, 최대 limit개). 데이터마다 기억한다. 예외를 던지지 않는다. */
export function storyCandidates(data: GameData, limit = 8): StoryCandidate[] {
  try {
    if (!isObj(data)) return [];
    let all = candCache.get(data);
    if (!all) {
      const g = buildDepGraph(data);
      const scan = storyScan(data);
      const out: StoryCandidate[] = [];
      const n = arr<unknown>(data.system?.variables).length;
      const ids = new Set<number>([...scan.varEvents.keys(), ...scan.varBranches.keys()]);
      for (let id = 1; id < n; id++) {
        const raw = data.system.variables[id];
        if (typeof raw === "string" && PROGRESS_NAME.test(raw)) ids.add(id);
      }
      for (const id of ids) {
        if (id <= 0) continue;
        const c = scoreVariable(data, g, scan, id);
        if (c) out.push(c);
      }
      const sw = switchGroup(data, g, scan);
      if (sw) out.push(sw);
      out.sort((a, b) => b.score - a.score || keyText(a.key).localeCompare(keyText(b.key), undefined, { numeric: true }));
      all = out;
      candCache.set(data, all);
    }
    return all.slice(0, limit);
  } catch {
    return [];
  }
}

/** 저장·비교용 글: "v:12", "s:3,4,5" */
export function keyText(k: StoryKey): string {
  return k.kind === "variable" ? `v:${k.id}` : `s:${k.ids.join(",")}`;
}

/** keyText의 반대. 못 읽으면 null */
export function parseKeyText(t: unknown): StoryKey | null {
  if (typeof t !== "string") return null;
  const m = /^v:(\d+)$/.exec(t);
  if (m) { const id = Number(m[1]); return id > 0 && id <= 100000 ? { kind: "variable", id } : null; }
  const s = /^s:(\d+(?:,\d+){0,199})$/.exec(t);
  if (s) {
    const ids = s[1].split(",").map(Number).filter(n => n > 0 && n <= 100000);
    return ids.length > 0 ? { kind: "switches", ids } : null;
  }
  return null;
}

/** 지금 진행 값: 변수 값, 스위치 묶음이면 켜진 수 */
export function storyValue(key: StoryKey, live: LiveSnapshot | null | undefined): number {
  try {
    if (!isObj(live)) return 0;
    if (key.kind === "variable") return num(isObj(live.variables) ? live.variables[String(key.id)] : 0);
    const on = new Set(arr<number>(live.switches));
    return key.ids.filter(id => on.has(id)).length;
  } catch {
    return 0;
  }
}

/** 화면에 쓰는 이름: "변수 [진행도]", "스위치 [1章クリア] 외 3개" */
export function storyKeyLabel(data: GameData, key: StoryKey): string {
  if (key.kind === "variable") return variableName(data, key.id);
  if (key.ids.length === 0) return "스위치 묶음";
  const first = switchName(data, key.ids[0]);
  return key.ids.length === 1 ? first : `${first} 외 ${key.ids.length - 1}개`;
}

/** 저장된 기준(있으면) 또는 가장 높은 후보. 없으면 null */
export function chooseStoryKey(data: GameData, saved: StoryKey | null | undefined): StoryKey | null {
  if (saved) return saved;
  return storyCandidates(data, 1)[0]?.key ?? null;
}
