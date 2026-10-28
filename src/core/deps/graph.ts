import { describeBranchCondition } from "../conditions/describe";
import type { CompareOp, ConditionTest, EventCommand, GameData, Location, PageConditions, TroopPageConditions } from "../types";

// ---- 공개 타입 ----
export type Atom =
  | { kind: "switch"; id: number } | { kind: "variable"; id: number }
  | { kind: "selfSwitch"; mapId: number; eventId: number; ch: string }
  | { kind: "item" | "weapon" | "armor"; id: number } | { kind: "actor"; id: number };
/** 무엇이 성립해야 하는가. */
export type Req = { atom: Atom; test: ConditionTest };
/** "M{map}:{event}:{page}" | "C{id}" | "T{troop}:{page}" */
export type CtxId = string;
export interface WriteOp { atom: Atom; op: "on" | "set" | "add" | "sub" | "other" | "gain" | "shop" | "script"; value?: number }
export interface Writer { ctx: CtxId; cmd: number; write: WriteOp; reqs: Req[]; choice?: { cmd: number; branch: number; label: string } }
/** trigger: 맵 페이지 = 페이지 트리거, 공통 이벤트 = 공통 이벤트 트리거(0 없음·1 자동·2 병렬), 전투 페이지 = -1. */
export interface CtxInfo { id: CtxId; location: Location; reqs: Req[]; trigger: number; callers: CtxId[]; opaque: { plugin: number; script: number } }
export interface DepGraph {
  ctxs: Map<CtxId, CtxInfo>;
  writersOf(a: Atom): Writer[];
  /** 그 원자를 참으로 만드는 데 필요한 최소 단계 수. Infinity = 데이터로 추적할 수 없음. */
  level(a: Atom): number;
  ctxLevel(id: CtxId): number;
}

export function atomKey(a: Atom): string {
  switch (a.kind) {
    case "selfSwitch": return `ss:${a.mapId},${a.eventId},${a.ch}`;
    case "switch": return `s:${a.id}`;
    case "variable": return `v:${a.id}`;
    case "item": return `i:${a.id}`;
    case "weapon": return `w:${a.id}`;
    case "armor": return `a:${a.id}`;
    case "actor": return `p:${a.id}`;
    default: return "?";
  }
}

export const mapCtxId = (mapId: number, eventId: number, page: number): CtxId => `M${mapId}:${eventId}:${page}`;
export const commonCtxId = (commonEventId: number): CtxId => `C${commonEventId}`;
export const troopCtxId = (troopId: number, page: number): CtxId => `T${troopId}:${page}`;

const compare = (a: number, op: CompareOp, b: number): boolean => {
  switch (op) {
    case "=": return a === b;
    case ">=": return a >= b;
    case "<=": return a <= b;
    case ">": return a > b;
    case "<": return a < b;
    case "!=": return a !== b;
    default: return false;
  }
};

/** 새 게임 상태(스위치 OFF, 변수 0, 소지품 없음)에서 이미 참인 조건인가. */
export function initiallyTrue(test: ConditionTest): boolean {
  switch (test.kind) {
    case "switch": case "selfSwitch": return !test.on;
    case "variable": return compare(0, test.op, test.value);
    case "variableVar": return compare(0, test.op, 0);
    case "trigger": return true;
    default: return false;
  }
}

/** level 계산에 쓰는 쓰기: 참으로 만들 수 있고, 스크립트가 아닌 것. */
export function isTraceableWrite(w: WriteOp): boolean {
  return w.op !== "other" && w.op !== "script";
}

// ---- 구축 ----
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const MAX_RANGE = 5000;
const SCRIPT_SWITCH = /\$gameSwitches\.setValue\(\s*(\d+)/g;
const SCRIPT_VARIABLE = /\$gameVariables\.setValue\(\s*(\d+)/g;

type Self = { mapId: number; eventId: number } | null;

function testToReq(test: ConditionTest | undefined, self: Self): Req | null {
  if (!test) return null;
  switch (test.kind) {
    case "switch": return { atom: { kind: "switch", id: test.id }, test };
    case "variable": case "variableVar": return { atom: { kind: "variable", id: test.id }, test };
    case "selfSwitch":
      return self ? { atom: { kind: "selfSwitch", mapId: self.mapId, eventId: self.eventId, ch: test.letter }, test } : null;
    case "item": case "weapon": case "armor": return { atom: { kind: test.kind, id: test.id }, test };
    case "actorInParty": return { atom: { kind: "actor", id: test.id }, test };
    default: return null;
  }
}

function pageReqs(c: PageConditions | null | undefined, self: Self): Req[] {
  if (!c || typeof c !== "object") return [];
  const out: Req[] = [];
  const push = (t: ConditionTest) => { const r = testToReq(t, self); if (r) out.push(r); };
  if (c.switch1Valid) push({ kind: "switch", id: num(c.switch1Id), on: true });
  if (c.switch2Valid) push({ kind: "switch", id: num(c.switch2Id), on: true });
  if (c.variableValid) push({ kind: "variable", id: num(c.variableId), op: ">=", value: num(c.variableValue) });
  if (c.selfSwitchValid) push({ kind: "selfSwitch", letter: String(c.selfSwitchCh), on: true });
  if (c.itemValid) push({ kind: "item", id: num(c.itemId) });
  if (c.actorValid) push({ kind: "actorInParty", id: num(c.actorId) });
  return out;
}

function troopReqs(c: TroopPageConditions | null | undefined): Req[] {
  if (!c || typeof c !== "object" || !c.switchValid) return [];
  const id = num(c.switchId);
  return [{ atom: { kind: "switch", id }, test: { kind: "switch", id, on: true } }];
}

interface Frame { indent: number; kind: "if" | "choice"; req: Req | null; inElse: boolean; cmd: number; branch: number; label: string }

interface Builder {
  data: GameData;
  ctxs: Map<CtxId, CtxInfo>;
  writers: Map<string, Writer[]>;
  calls: [from: CtxId, commonEventId: number][];
}

function addWriter(b: Builder, w: Writer) {
  const k = atomKey(w.write.atom);
  const list = b.writers.get(k);
  if (list) list.push(w); else b.writers.set(k, [w]);
}

const ITEM_KINDS = ["item", "weapon", "armor"] as const;

function scanList(b: Builder, info: CtxInfo, list: unknown, self: Self) {
  if (!Array.isArray(list)) return;
  const stack: Frame[] = [];
  let prevCode = -1;
  for (let i = 0; i < list.length; i++) {
    const cmd = list[i] as EventCommand | null;
    if (!cmd || typeof cmd !== "object") { prevCode = -1; continue; }
    const code = cmd.code;
    const indent = num(cmd.indent);
    const p: any[] = Array.isArray(cmd.parameters) ? cmd.parameters : [];
    // 같은 들여쓰기의 분기 표시(411/412/402/403/404)는 그 틀을 이어 쓰고, 그 밖의 명령은 더 깊은 틀을 닫는다.
    if (code === 411 || code === 412 || code === 402 || code === 403 || code === 404) {
      while (stack.length && stack[stack.length - 1].indent > indent) stack.pop();
      const top = stack[stack.length - 1];
      if (top && top.indent === indent) {
        if (code === 411 && top.kind === "if") top.inElse = true;
        else if (code === 402 && top.kind === "choice") { top.branch = num(p[0]); top.label = String(p[1] ?? ""); }
        else if (code === 403 && top.kind === "choice") { top.branch = -1; top.label = "취소"; }
        else if ((code === 412 && top.kind === "if") || (code === 404 && top.kind === "choice")) stack.pop();
      }
      prevCode = code;
      continue;
    }
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();

    const ctxReqs = (): { reqs: Req[]; choice?: Writer["choice"] } => {
      const reqs = info.reqs.slice();
      let choice: Writer["choice"];
      for (const f of stack) {
        if (f.kind === "if") { if (!f.inElse && f.req) reqs.push(f.req); }
        else if (f.branch !== -2) choice = { cmd: f.cmd, branch: f.branch, label: f.label };
      }
      return choice ? { reqs, choice } : { reqs };
    };
    const write = (w: WriteOp) => addWriter(b, { ctx: info.id, cmd: i, write: w, ...ctxReqs() });

    switch (code) {
      case 111: {
        if (p[0] === 12) info.opaque.script++;
        const req = testToReq(describeBranchCondition(p, b.data).test, self);
        stack.push({ indent, kind: "if", req, inElse: false, cmd: i, branch: -2, label: "" });
        break;
      }
      case 102:
        stack.push({ indent, kind: "choice", req: null, inElse: false, cmd: i, branch: -2, label: "" });
        break;
      case 117: {
        const id = num(p[0]);
        if (id > 0) b.calls.push([info.id, id]);
        break;
      }
      case 121: {
        const s = num(p[0]), e = num(p[1]);
        if (s > 0 && e >= s && e - s < MAX_RANGE) {
          for (let id = s; id <= e; id++) write({ atom: { kind: "switch", id }, op: num(p[2]) === 0 ? "on" : "other" });
        }
        break;
      }
      case 122: {
        const s = num(p[0]), e = num(p[1]);
        if (s > 0 && e >= s && e - s < MAX_RANGE) {
          const opn = num(p[2]), type = num(p[3]);
          if (type === 4) info.opaque.script++;
          const op: WriteOp["op"] = type === 4 ? "script" : opn === 0 ? "set" : opn === 1 ? "add" : opn === 2 ? "sub" : "other";
          for (let id = s; id <= e; id++) {
            const w: WriteOp = { atom: { kind: "variable", id }, op };
            if (type === 0 && op !== "script") w.value = num(p[4]);
            write(w);
          }
        }
        break;
      }
      case 123:
        if (self) write({ atom: { kind: "selfSwitch", ...self, ch: String(p[0]) }, op: num(p[1]) === 0 ? "on" : "other" });
        break;
      case 126: case 127: case 128: {
        const kind = ITEM_KINDS[code - 126];
        const w: WriteOp = { atom: { kind, id: num(p[0]) }, op: num(p[1]) === 0 ? "gain" : "other" };
        if (w.op === "gain" && num(p[2]) === 0) w.value = num(p[3]);
        write(w);
        break;
      }
      case 129:
        write({ atom: { kind: "actor", id: num(p[0]) }, op: num(p[1]) === 0 ? "gain" : "other" });
        break;
      case 302: case 605: {
        const kind = ITEM_KINDS[num(p[0])];
        if (kind) write({ atom: { kind, id: num(p[1]) }, op: "shop" });
        break;
      }
      case 355: case 655: {
        if (code === 355 || prevCode !== 355 && prevCode !== 655) info.opaque.script++;
        const text = typeof p[0] === "string" ? p[0] : "";
        if (text.includes("$game")) {
          for (const m of text.matchAll(SCRIPT_SWITCH)) write({ atom: { kind: "switch", id: Number(m[1]) }, op: "script" });
          for (const m of text.matchAll(SCRIPT_VARIABLE)) write({ atom: { kind: "variable", id: Number(m[1]) }, op: "script" });
        }
        break;
      }
      case 356: case 357:
        info.opaque.plugin++;
        break;
    }
    prevCode = code;
  }
}

const newInfo = (id: CtxId, location: Location, reqs: Req[], trigger: number): CtxInfo =>
  ({ id, location, reqs, trigger, callers: [], opaque: { plugin: 0, script: 0 } });

function collect(data: GameData): Builder {
  const b: Builder = { data, ctxs: new Map(), writers: new Map(), calls: [] };
  const lists: [CtxInfo, unknown, Self][] = [];
  const add = (info: CtxInfo, list: unknown, self: Self) => { b.ctxs.set(info.id, info); lists.push([info, list, self]); };

  if (data.maps instanceof Map) {
    for (const [mapId, m] of data.maps) {
      if (mapId === data.templateMapId || !m || !Array.isArray(m.events)) continue;
      for (const ev of m.events) {
        if (!ev || typeof ev !== "object" || !Array.isArray(ev.pages)) continue;
        const eventId = num(ev.id);
        const self = { mapId, eventId };
        ev.pages.forEach((pg, pi) => {
          if (!pg || typeof pg !== "object") return;
          const id = mapCtxId(mapId, eventId, pi);
          add(newInfo(id, { source: "map", mapId, eventId, page: pi }, pageReqs(pg.conditions, self), num(pg.trigger)), pg.list, self);
        });
      }
    }
  }
  if (Array.isArray(data.commonEvents)) {
    for (const ce of data.commonEvents) {
      if (!ce || typeof ce !== "object") continue;
      const id = num(ce.id), trigger = num(ce.trigger);
      const reqs: Req[] = [];
      if (trigger === 1 || trigger === 2) {
        const s = num(ce.switchId);
        reqs.push({ atom: { kind: "switch", id: s }, test: { kind: "switch", id: s, on: true } });
      }
      add(newInfo(commonCtxId(id), { source: "common", commonEventId: id }, reqs, trigger), ce.list, null);
    }
  }
  if (Array.isArray(data.troops)) {
    for (const t of data.troops) {
      if (!t || typeof t !== "object" || !Array.isArray(t.pages)) continue;
      const troopId = num(t.id);
      t.pages.forEach((pg, pi) => {
        if (!pg || typeof pg !== "object") return;
        add(newInfo(troopCtxId(troopId, pi), { source: "troop", troopId, page: pi }, troopReqs(pg.conditions), -1), pg.list, null);
      });
    }
  }
  for (const [info, list, self] of lists) {
    try { scanList(b, info, list, self); } catch { /* 이 목록만 건너뜀 */ }
  }
  for (const [from, ceId] of b.calls) {
    const target = b.ctxs.get(commonCtxId(ceId));
    if (target && !target.callers.includes(from)) target.callers.push(from);
  }
  return b;
}

/**
 * 고정점 계산:
 * - 문맥 레벨 = max(요구 원자 레벨) — 처음부터 참인 요구는 0. 트리거 0 공통 이벤트는 여기에 min(호출자 레벨)을 더 건다.
 * - 원자 레벨 = 1 + min over 쓰는 곳 (max(문맥 레벨, 분기 요구 레벨)).
 * 값은 Infinity에서 시작해 줄어들기만 하므로 순환이 있어도 끝난다.
 */
function computeLevels(b: Builder): { atomLevel: Map<string, number>; ctxLevel: Map<CtxId, number> } {
  const atomIdx = new Map<string, number>();
  const idxOf = (a: Atom): number => {
    const k = atomKey(a);
    let i = atomIdx.get(k);
    if (i === undefined) { i = atomIdx.size; atomIdx.set(k, i); }
    return i;
  };
  const reqIdx = (reqs: Req[]): number[] => {
    const out: number[] = [];
    for (const r of reqs) if (!initiallyTrue(r.test)) out.push(idxOf(r.atom));
    return out;
  };

  const ctxIds = [...b.ctxs.keys()];
  const ctxPos = new Map<CtxId, number>(ctxIds.map((id, i) => [id, i]));
  const ctxReq: number[][] = [];
  const ctxCallers: (number[] | null)[] = [];
  for (const id of ctxIds) {
    const info = b.ctxs.get(id)!;
    ctxReq.push(reqIdx(info.reqs));
    ctxCallers.push(info.location.source === "common" && info.trigger === 0
      ? info.callers.map(c => ctxPos.get(c)!).filter(x => x !== undefined) : null);
  }

  // 쓰는 곳: [원자, 문맥, 분기 요구(문맥 요구 제외)]
  const wAtom: number[] = [], wCtx: number[] = [], wReq: number[][] = [];
  for (const list of b.writers.values()) {
    for (const w of list) {
      if (!isTraceableWrite(w.write)) continue;
      const ci = ctxPos.get(w.ctx);
      if (ci === undefined) continue;
      const own = b.ctxs.get(w.ctx)!.reqs.length;
      wAtom.push(idxOf(w.write.atom));
      wCtx.push(ci);
      wReq.push(reqIdx(w.reqs.slice(own)));
    }
  }

  const aLv = new Float64Array(atomIdx.size).fill(Infinity);
  const cLv = new Float64Array(ctxIds.length).fill(Infinity);
  const maxOf = (base: number, idx: number[]): number => {
    let v = base;
    for (const i of idx) { const l = aLv[i]; if (l > v) { v = l; if (v === Infinity) break; } }
    return v;
  };
  const MAX_PASSES = 10_000;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;
    for (let c = 0; c < ctxIds.length; c++) {
      let v = maxOf(0, ctxReq[c]);
      const callers = ctxCallers[c];
      if (callers) {
        let best = Infinity;
        for (const k of callers) if (cLv[k] < best) best = cLv[k];
        if (best > v) v = best;
      }
      if (v < cLv[c]) { cLv[c] = v; changed = true; }
    }
    for (let w = 0; w < wAtom.length; w++) {
      const v = maxOf(cLv[wCtx[w]], wReq[w]) + 1;
      if (v < aLv[wAtom[w]]) { aLv[wAtom[w]] = v; changed = true; }
    }
    if (!changed) break;
  }

  const atomLevel = new Map<string, number>();
  for (const [k, i] of atomIdx) atomLevel.set(k, aLv[i]);
  const ctxLevel = new Map<CtxId, number>();
  ctxIds.forEach((id, i) => ctxLevel.set(id, cLv[i]));
  return { atomLevel, ctxLevel };
}

function makeGraph(ctxs: Map<CtxId, CtxInfo>, writers: Map<string, Writer[]>, atomLevel: Map<string, number>, ctxLevel: Map<CtxId, number>): DepGraph {
  return {
    ctxs,
    writersOf: (a) => { try { return writers.get(atomKey(a)) ?? []; } catch { return []; } },
    level: (a) => { try { return atomLevel.get(atomKey(a)) ?? Infinity; } catch { return Infinity; } },
    ctxLevel: (id) => ctxLevel.get(id) ?? Infinity,
  };
}

const EMPTY: DepGraph = makeGraph(new Map(), new Map(), new Map(), new Map());
const cache = new WeakMap<GameData, DepGraph>();

/** 의존 그래프. GameData마다 한 번 만들어 WeakMap에 둔다. 예외를 던지지 않는다. */
export function buildDepGraph(data: GameData): DepGraph {
  if (!data || typeof data !== "object") return EMPTY;
  const hit = cache.get(data);
  if (hit) return hit;
  let g: DepGraph;
  try {
    const b = collect(data);
    const { atomLevel, ctxLevel } = computeLevels(b);
    g = makeGraph(b.ctxs, b.writers, atomLevel, ctxLevel);
  } catch {
    g = EMPTY;
  }
  cache.set(data, g);
  return g;
}
