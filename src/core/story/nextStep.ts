// 지금 상태에서 본편 이야기를 앞으로 보내는 다음 행동(어디서 무엇을)과 그곳까지 가는 맵 길. 예외를 던지지 않는다.
import { buildDepGraph, type CtxId, type CtxInfo, type DepGraph, type Req, type Writer } from "../deps/graph";
import { availability, howTo, type Availability } from "../deps/howTo";
import { activePageIndex, conditionsKey } from "../live/interactable";
import type { LiveSnapshot } from "../live/types";
import { flattenCalls } from "../interpret/teCall";
import { formatText } from "../text/escape";
import { switchName } from "../text/names";
import type { EventCommand, EventPage, GameData, Location, MapEvent } from "../types";
import { keyText, storyKeyLabel, storyScan, storyValue, type StoryKey } from "./progress";
import { mapPath, type MapPath } from "./transfer";

/** talk 말 걸기 · check 조사 · touch 밟기 · enter 맵에 들어가기(자동 실행) · auto 자동(병렬) · battle 전투 · common 공통 이벤트(어디서 부르는지 모름) */
export type StepKind = "talk" | "check" | "touch" | "enter" | "auto" | "battle" | "common";
export type Confidence = "high" | "mid" | "low";
export interface Prereq { where: string; action: string; choiceLabel?: string; location: Location; availableNow: boolean }
export interface StoryStep {
  /** 할 곳(공통 이벤트면 부르는 맵 이벤트 페이지를 찾았을 때 그것) */
  location: Location;
  mapId: number | null; mapName: string;
  eventId: number | null; eventName: string;
  /** 이벤트 칸(맵 이벤트일 때) */
  pos?: { x: number; y: number };
  kind: StepKind;
  /** 그 페이지 첫 대사(제어 문자 뺌, 40자) */
  preview?: string;
  /** 쓰기가 선택지 갈래 안이면 골라야 할 항목 */
  choice?: string;
  confidence: Confidence;
  availableNow: boolean;
  /** 무엇이 바뀌는지: "진행도 5 → 6", "스위치 [1章クリア] 켜짐", "이야기가 이어져요" */
  effect: string;
  /** 지금 못 하면 먼저 할 일(howTo, 먼저 할 것부터) */
  prereqs: Prereq[];
  /** 먼저 갈 곳: 먼저 할 일이 맵 이벤트면 그곳, 아니면 할 곳(맵 이벤트일 때). 모르면 null */
  goal: { mapId: number; eventId: number; x: number; y: number } | null;
  /** 지금 맵에서 goal 맵(없으면 할 곳의 맵)까지 가는 길. 모르면 null */
  path: MapPath | null;
}
export interface NextStory { key: StoryKey; label: string; value: number; steps: StoryStep[] }

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object";
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const PREVIEW_MAX = 40;
const MAX_STEPS = 3;
const MAX_PREREQS = 5;

function mapNameOf(data: GameData, id: number): string {
  const info = arr<{ name?: string } | null>(data.mapInfos)[id];
  return (isObj(info) && info.name) || data.maps?.get(id)?.displayName || `맵 ${id}`;
}
function eventOf(data: GameData, mapId: number, eventId: number): MapEvent | null {
  return arr<MapEvent | null>(data.maps?.get(mapId)?.events).find(e => isObj(e) && e.id === eventId) ?? null;
}
const clip = (t: string): string => (t.length > PREVIEW_MAX ? `${t.slice(0, PREVIEW_MAX)}…` : t);

function firstLine(list: EventCommand[], data: GameData): string | undefined {
  for (const c of list) {
    if (!isObj(c) || (c.code !== 401 && c.code !== 405)) continue;
    const t = typeof c.parameters?.[0] === "string" ? formatText(c.parameters[0], data).trim() : "";
    if (t) return clip(t);
  }
  return undefined;
}

function isNpc(pg: EventPage | undefined): boolean {
  if (!isObj(pg) || !isObj(pg.image) || num(pg.image.tileId) > 0) return false;
  const name = typeof pg.image.characterName === "string" ? pg.image.characterName : "";
  return name !== "" && !(/^[!$]+/.exec(name)?.[0] ?? "").includes("!");
}

function kindOfPage(pg: EventPage | undefined): StepKind {
  const t = num(pg?.trigger);
  if (t === 3) return "enter";
  if (t === 4) return "auto";
  if (t === 1 || t === 2) return "touch";
  return isNpc(pg) ? "talk" : "check";
}

interface Place { location: Location; mapId: number | null; eventId: number | null; kind: StepKind; list: EventCommand[]; ctxAvail: boolean }

/** 문맥이 실제로 일어나는 곳: 맵·전투 페이지는 그대로, 호출식 공통 이벤트는 부르는 맵·전투 페이지(지금 되는 것 먼저, 깊이 3) */
function placeOf(g: DepGraph, av: Availability, data: GameData, info: CtxInfo, depth = 0, seen = new Set<CtxId>()): Place | null {
  const loc = info.location;
  if (loc.source === "map") {
    const ev = eventOf(data, loc.mapId, loc.eventId);
    const pg = ev?.pages?.[loc.page];
    const list = isObj(pg) ? flattenCalls(pg.list, ev ? { data, mapId: loc.mapId, event: ev, page: loc.page } : null) : [];
    return { location: loc, mapId: loc.mapId, eventId: loc.eventId, kind: kindOfPage(pg), list, ctxAvail: av.ctx(info.id) };
  }
  if (loc.source === "troop") {
    const tr = arr<{ pages?: { list?: unknown }[] } | null>(data.troops)[loc.troopId];
    return { location: loc, mapId: null, eventId: null, kind: "battle", list: arr(tr?.pages?.[loc.page]?.list), ctxAvail: av.ctx(info.id) };
  }
  const ce = arr<{ list?: unknown } | null>(data.commonEvents)[loc.commonEventId];
  const own: Place = { location: loc, mapId: null, eventId: null, kind: info.trigger === 0 ? "common" : "auto", list: arr(ce?.list), ctxAvail: av.ctx(info.id) };
  if (info.trigger !== 0 || depth >= 3 || seen.has(info.id)) return own;
  seen.add(info.id);
  const callers = info.callers.map(id => g.ctxs.get(id)).filter((c): c is CtxInfo => !!c);
  callers.sort((a, b) => Number(av.ctx(b.id)) - Number(av.ctx(a.id)) || Number(a.location.source !== "map") - Number(b.location.source !== "map"));
  for (const c of callers) {
    const p = placeOf(g, av, data, c, depth + 1, seen);
    if (p && p.mapId !== null) return { ...p, list: p.list.length ? p.list : own.list, ctxAvail: own.ctxAvail || p.ctxAvail };
  }
  return own;
}

/** 진행 쓰기 후보 */
interface Cand {
  w: Writer | null; info: CtxInfo; place: Place; avail: boolean; pHit: boolean; target: number | null;
  score: number; effect: string; unknownValue: boolean;
}

function plainWhere(data: GameData, place: Place): string {
  const loc = place.location;
  if (loc.source === "map") {
    const ev = eventOf(data, loc.mapId, loc.eventId);
    return `${mapNameOf(data, loc.mapId)} › ${ev?.name || `EV${loc.eventId}`}`;
  }
  if (loc.source === "troop") return `전투 ${arr<{ name?: string } | null>(data.troops)[loc.troopId]?.name || `#${loc.troopId}`}`;
  return `공통 이벤트 ${arr<{ name?: string } | null>(data.commonEvents)[loc.commonEventId]?.name || `#${loc.commonEventId}`}`;
}

/**
 * 맵 페이지인데 지금 그 이벤트의 활성 페이지가 다른 페이지인가(셀프 스위치로 이미 끝난 이벤트 등).
 * 셀프 스위치는 모든 맵 것이 live에 있어 다른 맵도 판정할 수 있다. 지금 맵은 howTo가 이미 live.events로 본다.
 */
function shadowed(data: GameData, live: LiveSnapshot, info: CtxInfo): boolean {
  const loc = info.location;
  if (loc.source !== "map" || loc.mapId === live.mapId) return false;
  const ev = eventOf(data, loc.mapId, loc.eventId);
  return !!ev && activePageIndex(ev, loc.mapId, data, live) !== loc.page;
}

const reqOnVar = (r: Req, id: number) => r.atom.kind === "variable" && r.atom.id === id;

/** 요구가 바로 지금 값 v에 맞춰 걸려 있는가(그 단계 전용 쓰기) */
function tightAt(r: Req, v: number): boolean {
  const t = r.test;
  if (t.kind !== "variable") return false;
  switch (t.op) {
    case ">=": case "=": case "<=": return t.value === v;
    case ">": return t.value === v - 1;
    case "<": return t.value === v + 1;
    default: return false;
  }
}

/** 변수 P를 v보다 크게 만드는 쓰는 곳들 */
function variableCands(
  data: GameData, g: DepGraph, av: Availability, live: LiveSnapshot, id: number, v: number, gate: number | null,
): Cand[] {
  const out: Cand[] = [];
  const name = storyKeyLabel(data, { kind: "variable", id });
  for (const w of g.writersOf({ kind: "variable", id })) {
    const { op, value } = w.write;
    let target: number | null = null;
    let unknownValue = false;
    if (op === "set" && value !== undefined) { if (value > v) target = value; }
    else if (op === "add") {
      if (value === undefined) { target = v + 1; unknownValue = true; }
      else if (value > 0) target = v + value;
    }
    if (target === null) continue;
    // 진행 변수에 걸린 요구가 지금 값으로 안 맞으면 다른 단계의 쓰기
    const pReqs = w.reqs.filter(r => reqOnVar(r, id));
    if (!pReqs.every(r => av.met(r))) continue;
    if (av.debug(w.ctx)) continue;
    const info = g.ctxs.get(w.ctx);
    if (!info) continue;
    const place = placeOf(g, av, data, info);
    if (!place) continue;
    const sh = shadowed(data, live, info);
    const avail = av.writer(w) && !sh;
    const pHit = pReqs.some(r => tightAt(r, v));
    let score = avail ? 100 : sh ? -40 : 0;
    if (pHit) score += 30;
    else if (pReqs.some(r => !(r.test.kind === "variable" && r.test.value <= 0))) score += 10;
    if (target === v + 1 || (gate !== null && target === gate)) score += 15;
    else if (gate === null || target <= gate) score += 8;
    else score -= 10;
    if (unknownValue) score -= 10;
    if (place.list.some(c => isObj(c) && c.code === 101)) score += 5;
    if (!avail) {
      const lv = g.ctxLevel(w.ctx);
      score -= lv === Infinity ? 50 : Math.min(20, lv * 3);
    }
    const effect = unknownValue ? `${name} 늘어남` : `${name} ${v} → ${target}`;
    out.push({ w, info, place, avail, pHit, target, score, effect, unknownValue });
  }
  return out;
}

/** 스위치 묶음에서 아직 안 켜진 첫 스위치를 켜는 쓰는 곳들 */
function switchCands(data: GameData, g: DepGraph, av: Availability, ids: number[], live: LiveSnapshot): Cand[] {
  const on = new Set(arr<number>(live.switches));
  const next = ids.find(id => !on.has(id));
  if (next === undefined) return [];
  const set = new Set(ids);
  const out: Cand[] = [];
  for (const w of g.writersOf({ kind: "switch", id: next })) {
    if (w.write.op !== "on" || av.debug(w.ctx)) continue;
    const info = g.ctxs.get(w.ctx);
    if (!info) continue;
    const place = placeOf(g, av, data, info);
    if (!place) continue;
    const sh = shadowed(data, live, info);
    const avail = av.writer(w) && !sh;
    const pHit = w.reqs.some(r => r.atom.kind === "switch" && set.has(r.atom.id) && av.met(r));
    let score = (avail ? 100 : sh ? -40 : 0) + (pHit ? 30 : 0) + 15;
    if (place.list.some(c => isObj(c) && c.code === 101)) score += 5;
    if (!avail) { const lv = g.ctxLevel(w.ctx); score -= lv === Infinity ? 50 : Math.min(20, lv * 3); }
    out.push({ w, info, place, avail, pHit, target: null, score, effect: `스위치 [${switchName(data, next)}] 켜짐`, unknownValue: false });
  }
  return out;
}

/** 진행 값이 정확히 v가 되며 열리는 자동 실행·병렬 맵 페이지(맵에 들어가면 시작) */
function autoCands(data: GameData, g: DepGraph, av: Availability, id: number, v: number, live: LiveSnapshot, have: Set<CtxId>): Cand[] {
  const out: Cand[] = [];
  if (v <= 0 || !(data.maps instanceof Map)) return out;
  for (const [mapId, m] of data.maps) {
    if (mapId === data.templateMapId || !isObj(m)) continue;
    for (const ev of arr<MapEvent | null>(m.events)) {
      if (!isObj(ev)) continue;
      arr<EventPage | null>(ev.pages).forEach((pg, pi) => {
        if (!isObj(pg) || (num(pg.trigger) !== 3 && num(pg.trigger) !== 4)) return;
        const cd = pg.conditions;
        if (!isObj(cd) || !cd.variableValid || num(cd.variableId) !== id || num(cd.variableValue) !== v) return;
        const cid = `M${mapId}:${ev.id}:${pi}`;
        if (have.has(cid) || av.debug(cid)) return;
        const info = g.ctxs.get(cid);
        if (!info || !av.ctx(cid) || shadowed(data, live, info)) return;
        // 지금 맵에서 이미 다른 페이지가 활성이면(셀프 스위치로 끝남 등) 뺀다
        if (live.mapId === mapId) {
          const hit = arr<{ eventId: number; page: number } | null>(live.events).find(e => isObj(e) && e.eventId === ev.id);
          if (hit && hit.page !== pi) return;
        }
        const place = placeOf(g, av, data, info);
        if (!place || !place.list.some(c => isObj(c) && (c.code === 101 || c.code === 201 || c.code === 102))) return;
        out.push({ w: null, info, place, avail: true, pHit: true, target: null, score: 90, effect: "이야기가 이어져요", unknownValue: false });
      });
    }
  }
  return out;
}

function prereqsOf(data: GameData, live: LiveSnapshot, av: Availability, w: Writer): Prereq[] {
  const out: Prereq[] = [];
  for (const r of av.unmet(w)) {
    const h = howTo(r, data, live);
    const steps = h.steps.length ? h.steps : h.end.kind === "fork" ? h.end.candidates.slice(0, 1) : [];
    for (const s of steps) {
      if (out.length >= MAX_PREREQS) return out;
      const p: Prereq = { where: s.where, action: s.action, location: s.location, availableNow: s.availableNow };
      if (s.choiceLabel) p.choiceLabel = s.choiceLabel;
      out.push(p);
    }
    if (out.length) break;   // 첫 번째 막힌 요구부터
  }
  return out;
}

function confidenceOf(c: Cand, prereqs: Prereq[]): Confidence {
  if (c.avail && !c.unknownValue && (c.pHit || (c.target !== null && c.score >= 115))) return "high";
  if (c.avail) return "mid";
  if (prereqs.length > 0 && prereqs[0].availableNow) return "mid";
  return "low";
}

function stepOf(data: GameData, live: LiveSnapshot, av: Availability, c: Cand): StoryStep {
  const { place } = c;
  const prereqs = !c.avail && c.w ? prereqsOf(data, live, av, c.w) : [];
  const ev = place.mapId !== null && place.eventId !== null ? eventOf(data, place.mapId, place.eventId) : null;
  const step: StoryStep = {
    location: place.location,
    mapId: place.mapId,
    mapName: place.mapId !== null ? mapNameOf(data, place.mapId) : "",
    eventId: place.eventId,
    eventName: ev ? (ev.name || `EV${ev.id}`) : plainWhere(data, place),
    kind: place.kind,
    confidence: confidenceOf(c, prereqs),
    availableNow: c.avail,
    effect: c.effect,
    prereqs,
    goal: null,
    path: null,
  };
  if (ev) step.pos = { x: num(ev.x), y: num(ev.y) };
  const preview = firstLine(place.list, data);
  if (preview) step.preview = preview;
  if (c.w?.choice) step.choice = c.w.choice.label;
  // 먼저 갈 곳: 먼저 할 일이 맵에 있으면 그곳, 아니면 할 곳
  const first = prereqs[0]?.location;
  if (first?.source === "map") {
    const pe = eventOf(data, first.mapId, first.eventId);
    if (pe) step.goal = { mapId: first.mapId, eventId: first.eventId, x: num(pe.x), y: num(pe.y) };
  } else if (place.mapId !== null && place.eventId !== null && step.pos) {
    step.goal = { mapId: place.mapId, eventId: place.eventId, ...step.pos };
  }
  const goTo = first?.source === "map" ? first.mapId : place.mapId;
  if (goTo !== null) step.path = mapPath(data, live, num(live.mapId), goTo);
  return step;
}

const resultCache = new WeakMap<GameData, { k: string; r: NextStory | null }>();

/**
 * 진행 기준 key와 지금 상태(live)로 다음 이야기 단계(좋은 것부터 최대 3개). 할 일을 못 찾으면 steps가 빈 결과,
 * 입력이 이상하면 null. 데이터마다 마지막 결과(기준·조건 상태가 같으면)를 기억한다. 예외를 던지지 않는다.
 */
export function nextStory(data: GameData, live: LiveSnapshot, key: StoryKey | null): NextStory | null {
  try {
    if (!isObj(data) || !isObj(live) || !key) return null;
    const k = `${keyText(key)}|${conditionsKey(live)}`;
    const hit = resultCache.get(data);
    if (hit && hit.k === k) return hit.r;
    const r = compute(data, live, key);
    resultCache.set(data, { k, r });
    return r;
  } catch {
    return null;
  }
}

function compute(data: GameData, live: LiveSnapshot, key: StoryKey): NextStory {
  const g = buildDepGraph(data);
  const av = availability(data, live);
  const value = storyValue(key, live);
  let cands: Cand[];
  if (key.kind === "variable") {
    const gates = [...(storyScan(data).varGates.get(key.id) ?? [])].filter(x => x > value);
    const gate = gates.length ? Math.min(...gates) : null;
    cands = variableCands(data, g, av, live, key.id, value, gate);
    cands.push(...autoCands(data, g, av, key.id, value, live, new Set(cands.map(c => c.info.id))));
  } else {
    cands = switchCands(data, g, av, key.ids, live);
  }
  // 같은 할 곳은 하나로(점수 높은 것)
  const best = new Map<string, Cand>();
  for (const c of cands) {
    const loc = c.place.location;
    const k = loc.source === "map" ? `m${loc.mapId}:${loc.eventId}` : loc.source === "troop" ? `t${loc.troopId}` : `c${loc.commonEventId}`;
    const prev = best.get(k);
    if (!prev || c.score > prev.score) best.set(k, c);
  }
  const ranked = [...best.values()].sort((a, b) => b.score - a.score || a.info.id.localeCompare(b.info.id, undefined, { numeric: true }));
  const steps = ranked.slice(0, MAX_STEPS).map(c => stepOf(data, live, av, c));
  return { key, label: storyKeyLabel(data, key), value, steps };
}
