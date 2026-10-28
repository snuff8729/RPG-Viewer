import { activePageIndex } from "../live/interactable";
import { evaluate } from "../live/evaluate";
import type { LiveSnapshot } from "../live/types";
import { actorName, armorName, itemName, switchName, variableName, weaponName } from "../text/names";
import type { CompareOp, GameData, Location, MapEvent } from "../types";
import { atomKey, buildDepGraph, isTraceableWriteFor, type Atom, type CtxId, type CtxInfo, type DepGraph, type Req, type Writer } from "./graph";

export interface HowToStep {
  writer: Writer;
  /** 예: "마을 › 촌장 › p1", "공통 이벤트 열쇠 (호출: 마을 › 촌장 › p1 외 2곳)", "전투 슬라임" */
  where: string;
  /** 예: "스위치 [문 열림] 켜기", "변수 [호감도] += 1", "상점에서 [포션] 사기" */
  action: string;
  choiceLabel?: string;
  availableNow: boolean;
  /** 변수 요구를 채우려면 한 번 더하기로는 모자란다 */
  repeatNeeded: boolean;
  location: Location;
}
export type HowToEnd =
  | { kind: "done" }
  /** req: 갈림길에서 채워야 하는 요구. 후보를 고르면 howTo(req, …, { from: 후보.writer })로 이어 본다 */
  | { kind: "fork"; req: Req; candidates: HowToStep[]; more: number }
  | { kind: "opaque"; reason: "plugin" | "script" | "noWriter" }
  | { kind: "depthLimit" }
  | { kind: "cycle" };
export interface HowTo { steps: HowToStep[]; end: HowToEnd }

const MAX_STEPS = 20;
const MAX_CALLER_DEPTH = 5;
const MAX_CANDIDATES = 5;

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object";
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function compare(a: number, op: CompareOp, b: number): boolean {
  switch (op) {
    case "=": return a === b;
    case ">=": return a >= b;
    case "<=": return a <= b;
    case ">": return a > b;
    case "<": return a < b;
    case "!=": return a !== b;
    default: return false;
  }
}

/** 요구가 지금 live에서 성립하는가(셀프 스위치는 원자의 맵·이벤트로 판정). */
function reqMet(req: Req, live: LiveSnapshot): boolean {
  const a = req.atom;
  const ctx = a.kind === "selfSwitch" ? { mapId: a.mapId, eventId: a.eventId } : {};
  return evaluate(req.test, live, ctx) === "met";
}

/** 이 쓰기가 요구를 참으로 만들 수 있는가(스크립트는 알 수 없으니 될 수도 있다고 본다). */
function canSatisfy(w: Writer, req: Req): boolean {
  const { op, value } = w.write;
  const t = req.test;
  if (op === "script") return true;
  switch (t.kind) {
    case "switch": case "selfSwitch":
      return t.on ? op === "on" : op === "other";
    case "variable":
      switch (op) {
        case "set": return value === undefined || compare(value, t.op, t.value);
        case "add": return value === undefined || (value > 0 ? t.op !== "<" && t.op !== "<=" : value < 0 ? t.op !== ">" && t.op !== ">=" : false);
        case "sub": return value === undefined || (value > 0 ? t.op !== ">" && t.op !== ">=" : value < 0 ? t.op !== "<" && t.op !== "<=" : false);
        case "other": return true;
        default: return false;
      }
    case "variableVar": return op === "set" || op === "add" || op === "sub" || op === "other";
    case "item": case "weapon": case "armor": return op === "gain" || op === "shop";
    case "actorInParty": return op === "gain";
    default: return false;
  }
}

// ---- 이름·문구 ----
function mapName(data: GameData, mapId: number): string {
  const info = arr<{ id: number; name: string } | null>(data.mapInfos)[mapId];
  return (isObj(info) && info.name) || data.maps?.get(mapId)?.displayName || `맵 ${mapId}`;
}
function eventOf(data: GameData, mapId: number, eventId: number): MapEvent | null {
  const ev = arr<MapEvent | null>(data.maps?.get(mapId)?.events).find(e => isObj(e) && e.id === eventId);
  return ev ?? null;
}
const named = (name: unknown, id: number) => (typeof name === "string" && name ? name : `#${id}`);

function plainWhere(data: GameData, loc: Location): string {
  switch (loc.source) {
    case "map": {
      const ev = eventOf(data, loc.mapId, loc.eventId);
      return `${mapName(data, loc.mapId)} › ${named(ev?.name, loc.eventId)} › p${loc.page + 1}`;
    }
    case "common": return `공통 이벤트 ${named(arr<{ name: string } | null>(data.commonEvents)[loc.commonEventId]?.name, loc.commonEventId)}`;
    case "troop": return `전투 ${named(arr<{ name: string } | null>(data.troops)[loc.troopId]?.name, loc.troopId)}`;
  }
}

function whereOf(g: DepGraph, data: GameData, info: CtxInfo): string {
  const base = plainWhere(data, info.location);
  if (info.location.source !== "common" || info.callers.length === 0) return base;
  const first = g.ctxs.get(info.callers[0]);
  if (!first) return base;
  const rest = info.callers.length - 1;
  return `${base} (호출: ${plainWhere(data, first.location)}${rest > 0 ? ` 외 ${rest}곳` : ""})`;
}

function atomName(data: GameData, a: Atom): string {
  switch (a.kind) {
    case "switch": return `스위치 [${switchName(data, a.id)}]`;
    case "variable": return `변수 [${variableName(data, a.id)}]`;
    case "selfSwitch": return `셀프 스위치 ${a.ch}`;
    case "item": return `아이템 [${itemName(data, a.id)}]`;
    case "weapon": return `무기 [${weaponName(data, a.id)}]`;
    case "armor": return `방어구 [${armorName(data, a.id)}]`;
    case "actor": return `동료 [${actorName(data, a.id)}]`;
  }
}

function actionOf(data: GameData, w: Writer): string {
  const a = w.write.atom;
  const name = atomName(data, a);
  const v = w.write.value;
  switch (w.write.op) {
    case "on": return `${name} 켜기`;
    case "other":
      return a.kind === "switch" || a.kind === "selfSwitch" ? `${name} 끄기` : a.kind === "actor" ? `${name} 파티에서 빼기` : `${name} 바꾸기`;
    case "set": return v === undefined ? `${name} 값 정하기` : `${name} = ${v}`;
    case "add": return v === undefined ? `${name} 늘리기` : `${name} += ${v}`;
    case "sub": return v === undefined ? `${name} 줄이기` : `${name} -= ${v}`;
    case "gain": return a.kind === "actor" ? `${name} 파티에 넣기` : `${name} 얻기`;
    case "shop": return `상점에서 ${name.replace(/^\S+ /, "")} 사기`;
    case "script": return `${name} 바꾸기 (스크립트)`;
  }
}

// ---- 지금 할 수 있는가 ----
interface Ctx { g: DepGraph; data: GameData; live: LiveSnapshot; ctxAvail: Map<CtxId, boolean> }

/** 맵 이벤트의 지금 활성 페이지: 지금 맵이면 live.events가 우선. */
function livePage(c: Ctx, mapId: number, eventId: number): number {
  if (c.live.mapId === mapId) {
    const hit = arr<{ eventId: number; page: number } | null>(c.live.events).find(e => isObj(e) && e.eventId === eventId);
    if (hit && typeof hit.page === "number") return hit.page;
    const ev = eventOf(c.data, mapId, eventId);
    return ev ? activePageIndex(ev, mapId, c.data, c.live) : -1;
  }
  return Number.NaN;   // 다른 맵: 페이지 판정은 하지 않는다
}

function ctxAvailable(c: Ctx, id: CtxId, depth: number, guard: Set<CtxId>): boolean {
  const cached = c.ctxAvail.get(id);
  if (cached !== undefined) return cached;
  const info = c.g.ctxs.get(id);
  if (!info || guard.has(id) || depth > MAX_CALLER_DEPTH) return false;
  let ok = info.reqs.every(r => reqMet(r, c.live));
  const loc = info.location;
  if (ok && loc.source === "map" && c.live.mapId === loc.mapId) ok = livePage(c, loc.mapId, loc.eventId) === loc.page;
  if (ok && loc.source === "common" && info.trigger === 0) {
    guard.add(id);
    ok = info.callers.some(k => ctxAvailable(c, k, depth + 1, guard));
    guard.delete(id);
  }
  if (guard.size === 0) c.ctxAvail.set(id, ok);   // 순환 가드 밖에서 얻은 값만 기억
  return ok;
}

function writerAvailable(c: Ctx, w: Writer): boolean {
  return ctxAvailable(c, w.ctx, 0, new Set()) && w.reqs.every(r => reqMet(r, c.live));
}

function repeatNeeded(c: Ctx, w: Writer, req: Req): boolean {
  const t = req.test;
  if (t.kind !== "variable" || w.write.op !== "add" || !(num(w.write.value) > 0)) return false;
  const cur = num(isObj(c.live.variables) ? c.live.variables[String(t.id)] : 0);
  const target = t.op === ">" ? t.value + 1 : t.op === ">=" || t.op === "=" ? t.value : Number.NaN;
  return Number.isFinite(target) && target - cur > num(w.write.value);
}

function stepOf(c: Ctx, w: Writer, req: Req): HowToStep | null {
  const info = c.g.ctxs.get(w.ctx);
  if (!info) return null;
  const step: HowToStep = {
    writer: w, where: whereOf(c.g, c.data, info), action: actionOf(c.data, w),
    availableNow: writerAvailable(c, w), repeatNeeded: repeatNeeded(c, w, req), location: info.location,
  };
  if (w.choice) step.choiceLabel = w.choice.label;
  return step;
}

/** 같은 문맥 안의 쓰는 곳 묶음. 대표(rep)는 지금 할 수 있는 것 → 요구에 가장 잘 맞는 동작 → 먼저 나온 것 순으로 고른다. */
interface Group { ctx: CtxId; rep: Writer; avail: boolean; level: number; unmet: number; debug: boolean }

const DEBUG_NAME = /debug|デバッグ|デバック|テスト|test|디버그|테스트/i;
const GENERIC_EVENT_NAME = /^EV\d+$/;

/** 문맥 이름(맵 이벤트 이름 — 이름이 EV001 같으면 첫 대사 —, 공통 이벤트 이름, 적 군단 이름)이 디버그·테스트용으로 보이는가. */
function isDebugCtx(data: GameData, info: CtxInfo): boolean {
  const loc = info.location;
  const names: unknown[] = [];
  switch (loc.source) {
    case "map": {
      const ev = eventOf(data, loc.mapId, loc.eventId);
      names.push(ev?.name);
      if (typeof ev?.name !== "string" || GENERIC_EVENT_NAME.test(ev.name)) {
        const first = arr<{ code: number; parameters: unknown[] } | null>(ev?.pages?.[loc.page]?.list).find(cmd => isObj(cmd) && cmd.code === 401);
        names.push(arr(first?.parameters)[0]);
      }
      break;
    }
    case "common": names.push(arr<{ name: string } | null>(data.commonEvents)[loc.commonEventId]?.name); break;
    case "troop": names.push(arr<{ name: string } | null>(data.troops)[loc.troopId]?.name); break;
  }
  return names.some(n => typeof n === "string" && DEBUG_NAME.test(n));
}

/** 동작 순위(작을수록 좋음): 변수는 값을 바로 정하는 set, 그다음 큰 증감. */
function actionRank(w: Writer): [number, number] {
  const { op, value } = w.write;
  return [op === "set" && value !== undefined ? 0 : 1, -Math.abs(num(value))];
}

function groupWriters(c: Ctx, writers: Writer[]): Group[] {
  const byCtx = new Map<CtxId, Writer[]>();
  for (const w of writers) {
    const list = byCtx.get(w.ctx);
    if (list) list.push(w);
    else byCtx.set(w.ctx, [w]);
  }
  const out: Group[] = [];
  for (const [ctx, list] of byCtx) {
    const best = list
      .map((w, i) => ({ w, i, a: writerAvailable(c, w), r: actionRank(w) }))
      .sort((x, y) => Number(y.a) - Number(x.a) || x.r[0] - y.r[0] || x.r[1] - y.r[1] || x.i - y.i)[0];
    const info = c.g.ctxs.get(ctx);
    out.push({
      ctx, rep: best.w, avail: best.a, level: c.g.ctxLevel(ctx), unmet: best.w.reqs.filter(r => !reqMet(r, c.live)).length,
      debug: !!info && isDebugCtx(c.data, info),
    });
  }
  return out;
}

const byCtxId = (a: CtxId, b: CtxId) => a.localeCompare(b, undefined, { numeric: true });

/**
 * 갈림길 후보 순서: 디버그·테스트 문맥은 맨 뒤, 지금 가능(레벨과 무관) → 닿을 수 있는 것 →
 * 낮은 문맥 레벨 → 안 된 요구 적은 것 → 문맥 id.
 */
function compareGroups(x: Group, y: Group): number {
  const xu = x.level === Infinity, yu = y.level === Infinity;
  return Number(x.debug) - Number(y.debug) || Number(y.avail) - Number(x.avail) || Number(xu) - Number(yu)
    || (xu || yu ? 0 : x.level - y.level) || x.unmet - y.unmet || byCtxId(x.ctx, y.ctx);
}

/** 쓰는 곳의 아직 안 된 요구들. 다 됐는데 호출식 공통 이벤트가 막혀 있으면 호출자가 하나일 때 그 호출자의 요구. */
function unmetReqsOf(c: Ctx, w: Writer): Req[] {
  const own = w.reqs.filter(r => !reqMet(r, c.live));
  if (own.length) return own;
  let info = c.g.ctxs.get(w.ctx);
  const seen = new Set<CtxId>();
  while (info && info.location.source === "common" && info.trigger === 0 && info.callers.length === 1 && !seen.has(info.id)) {
    seen.add(info.id);
    if (ctxAvailable(c, info.id, 0, new Set())) return [];
    info = c.g.ctxs.get(info.callers[0]);
    if (!info) return [];
    const reqs = info.reqs.filter(r => !reqMet(r, c.live));
    if (reqs.length) return reqs;
  }
  return [];
}

interface Run { c: Ctx; steps: HowToStep[]; planned: Set<string>; from?: Writer }

/** req를 채우는 사슬을 깊이 우선으로 찾는다. 찾은 순서대로 steps에 넣고(나중에 뒤집는다) 끝 상태를 돌려준다. */
function solve(run: Run, req: Req, ancestors: Set<string>): HowToEnd {
  const { c } = run;
  if (reqMet(req, c.live)) return { kind: "done" };
  const key = atomKey(req.atom);
  if (ancestors.has(key)) return { kind: "cycle" };
  if (run.planned.has(key)) return { kind: "done" };
  if (run.steps.length >= MAX_STEPS) return { kind: "depthLimit" };

  let chosen: Writer | undefined;
  if (run.from) {
    chosen = run.from;
    run.from = undefined;
  } else {
    const useful = c.g.writersOf(req.atom).filter(w => canSatisfy(w, req));
    const traceable = useful.filter(w => isTraceableWriteFor(w.write, req.test));
    if (traceable.length === 0) {
      return { kind: "opaque", reason: useful.some(w => w.write.op === "script") ? "script" : "noWriter" };
    }
    // 같은 문맥의 여러 쓰기는 하나로 본다. 닿을 수 있는 문맥이 있으면 닿을 수 없는 문맥(호출자 없는 디버그 이벤트 등)은 판단에서 뺀다.
    // 지금 할 수 있는 문맥은 정적 레벨이 Infinity여도(스크립트·플러그인이 조건을 만든 경우) 닿을 수 있다고 본다.
    const groups = groupWriters(c, traceable);
    const reachable = groups.filter(gr => gr.level !== Infinity || gr.avail);
    const deciding = reachable.length ? reachable : groups;
    const avail = deciding.filter(gr => gr.avail);
    if (deciding.length === 1) chosen = deciding[0].rep;
    else if (avail.length === 1) chosen = avail[0].rep;
    else {
      const candidates: HowToStep[] = [];
      for (const gr of [...groups].sort(compareGroups)) {
        if (candidates.length >= MAX_CANDIDATES) break;
        const s = stepOf(c, gr.rep, req);
        if (s) candidates.push(s);
      }
      return { kind: "fork", req, candidates, more: Math.max(0, groups.length - candidates.length) };
    }
  }

  const step = stepOf(c, chosen, req);
  if (!step) return { kind: "opaque", reason: "noWriter" };
  run.steps.push(step);
  run.planned.add(key);
  const next = new Set(ancestors).add(key);
  for (const r of unmetReqsOf(c, chosen)) {
    const end = solve(run, r, next);
    if (end.kind !== "done") return end;
  }
  return { kind: "done" };
}

/**
 * 요구(req)를 지금 상태(live)에서 어떻게 만드는지: 쓰는 곳이 하나뿐이거나 지금 할 수 있는 곳이 하나뿐인 동안 따라간다.
 * steps[0]이 가장 먼저 할 일. opts.from: 갈림길 후보 하나를 골라 그 쓰는 곳부터 이어 본다. 예외를 던지지 않는다.
 */
export function howTo(req: Req, data: GameData, live: LiveSnapshot, opts?: { from?: Writer }): HowTo {
  try {
    if (!isObj(req) || !isObj(req.atom) || !isObj(req.test) || !isObj(data) || !isObj(live)) return { steps: [], end: { kind: "opaque", reason: "noWriter" } };
    const c: Ctx = { g: buildDepGraph(data), data, live, ctxAvail: new Map() };
    const run: Run = { c, steps: [], planned: new Set(), from: opts?.from };
    const end = solve(run, req, new Set());
    return { steps: run.steps.reverse(), end };
  } catch {
    return { steps: [], end: { kind: "opaque", reason: "noWriter" } };
  }
}

/** 지금 상태(live)에서 쓰는 곳·문맥을 판정하는 도구(howTo와 같은 규칙). 문맥 판정은 기억한다. */
export interface Availability {
  /** 쓰는 곳을 지금 할 수 있는가(문맥 + 분기 요구) */
  writer(w: Writer): boolean;
  /** 문맥이 지금 실행될 수 있는가(호출식 공통 이벤트는 부르는 곳 중 하나라도) */
  ctx(id: CtxId): boolean;
  /** 쓰는 곳의 아직 안 된 요구들 */
  unmet(w: Writer): Req[];
  /** 디버그·테스트용으로 보이는 문맥인가 */
  debug(id: CtxId): boolean;
  /** 요구가 지금 성립하는가 */
  met(req: Req): boolean;
}

/** howTo와 같은 규칙으로 지금 할 수 있는지 판정하는 도구를 만든다. 예외를 던지지 않는다. */
export function availability(data: GameData, live: LiveSnapshot): Availability {
  const c: Ctx = { g: buildDepGraph(data), data, live, ctxAvail: new Map() };
  const dbg = new Map<CtxId, boolean>();
  return {
    writer: (w) => { try { return writerAvailable(c, w); } catch { return false; } },
    ctx: (id) => { try { return ctxAvailable(c, id, 0, new Set()); } catch { return false; } },
    unmet: (w) => { try { return unmetReqsOf(c, w); } catch { return []; } },
    debug: (id) => {
      const hit = dbg.get(id);
      if (hit !== undefined) return hit;
      const info = c.g.ctxs.get(id);
      let v = false;
      try { v = !!info && isDebugCtx(data, info); } catch { v = false; }
      dbg.set(id, v);
      return v;
    },
    met: (r) => { try { return reqMet(r, live); } catch { return false; } },
  };
}
