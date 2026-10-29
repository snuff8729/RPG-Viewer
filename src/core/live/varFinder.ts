import type { LiveSnapshot } from "./types";
import { systemEntries, type SearchEntry } from "./cheat";

/**
 * 변수 찾기(치트 창 `스위치·변수` → 변수): 이름이 원문이라 알아보기 힘든 변수를 값으로 찾는다.
 * live.json `variables`에는 0이 아닌 숫자만 있다(없으면 0). 글자·배열 값은 실리지 않아 0으로 보인다.
 */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** 변수 하나의 지금 값(없으면 0) */
export function liveVariable(live: LiveSnapshot | null, id: number): number {
  const m = live?.variables;
  const v = isObj(m) ? m[String(id)] : undefined;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** 변수 개수(System.json 이름 목록 길이 - 1) */
const varCount = (names: readonly unknown[] | undefined): number => (Array.isArray(names) && names.length > 1 ? names.length - 1 : 0);

/**
 * 값으로 찾기: 지금 값이 value인 변수(id 순). value가 0이면 빈 목록(0인 변수는 너무 많다 → 좁혀 찾기를 쓴다).
 * 이름 목록 밖의 id는 뺀다. 예외를 던지지 않는다.
 */
export function findVariablesByValue(names: readonly unknown[] | undefined, live: LiveSnapshot | null, value: number, limit = 200): SearchEntry[] {
  try {
    if (!live || value === 0 || !Number.isFinite(value)) return [];
    const entries = systemEntries(names);
    const m = isObj(live.variables) ? live.variables : {};
    const out: SearchEntry[] = [];
    for (const key of Object.keys(m)) {
      const id = Number(key);
      if (!Number.isInteger(id) || id < 1 || id > entries.length) continue;
      if (m[key] === value) out.push(entries[id - 1]);
    }
    return out.sort((a, b) => a.id - b.id).slice(0, Math.max(0, limit));
  } catch {
    return [];
  }
}

// ── 좁혀 찾기 ──

/** 후보 하나: prev = 마지막으로 기억한 값(처음엔 "지금 값 기억하기" 때 값) */
export interface NarrowCandidate { id: number; prev: number }
export interface NarrowState {
  candidates: NarrowCandidate[];
  /** 좁힌 횟수(0 = 방금 기억함) */
  steps: number;
}
export type NarrowFilter =
  | { kind: "changed" | "increased" | "decreased" | "unchanged" }
  | { kind: "equals"; value: number };

/** "지금 값 기억하기": 모든 변수를 후보로, 지금 값을 기억한다. 연결 안 됐거나 변수가 없으면 null. */
export function startNarrow(names: readonly unknown[] | undefined, live: LiveSnapshot | null): NarrowState | null {
  const n = varCount(names);
  if (!live || n === 0) return null;
  const candidates: NarrowCandidate[] = [];
  for (let id = 1; id <= n; id++) candidates.push({ id, prev: liveVariable(live, id) });
  return { candidates, steps: 0 };
}

function keep(f: NarrowFilter, prev: number, now: number): boolean {
  switch (f.kind) {
    case "changed": return now !== prev;
    case "increased": return now > prev;
    case "decreased": return now < prev;
    case "unchanged": return now === prev;
    case "equals": return now === f.value;
  }
}

/** 걸러서 남은 후보의 기억 값을 지금 값으로 바꾼다(다음 번엔 여기서부터 비교). 연결 안 됐으면 그대로. */
export function applyNarrow(state: NarrowState, live: LiveSnapshot | null, filter: NarrowFilter): NarrowState {
  if (!live) return state;
  const candidates: NarrowCandidate[] = [];
  for (const c of state.candidates) {
    const now = liveVariable(live, c.id);
    if (keep(filter, c.prev, now)) candidates.push({ id: c.id, prev: now });
  }
  return { candidates, steps: state.steps + 1 };
}

// ── 최근 바뀐 변수 ──

/** 한 변수의 마지막 변화. times = 최근 바뀐 시각(자주 바뀜 판단용, FREQUENT_WINDOW_MS 안만) */
export interface VarChange { id: number; from: number; to: number; at: number; times: number[] }
export interface ChangeTracker {
  /** 마지막으로 본 값(아직 못 봤으면 null) */
  prev: Record<string, number> | null;
  /** id → 마지막 변화 */
  changes: Map<number, VarChange>;
}

/** 이 시간 안에 FREQUENT_COUNT번 이상 바뀌면 "자주 바뀜"(병렬 이벤트의 타이머 등) */
export const FREQUENT_WINDOW_MS = 15_000;
export const FREQUENT_COUNT = 5;
/** 기억하는 변수 수(넘으면 오래된 것부터 버린다) */
const TRACK_MAX = 300;

export const emptyTracker = (): ChangeTracker => ({ prev: null, changes: new Map() });

function varsOf(live: LiveSnapshot): Record<string, number> {
  const out: Record<string, number> = {};
  const m = live.variables;
  if (!isObj(m)) return out;
  for (const k of Object.keys(m)) {
    const v = m[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/**
 * 새 live.json을 보고 바뀐 변수를 적는다. 처음 본 상태는 기준으로만 쓴다. live가 null(연결 끊김)이면 그대로.
 * 바뀐 게 없으면 같은 tracker를 돌려준다.
 */
export function trackVariables(t: ChangeTracker, live: LiveSnapshot | null, now: number): ChangeTracker {
  if (!live) return t;
  const cur = varsOf(live);
  if (t.prev === null) return { prev: cur, changes: t.changes };
  const keys = new Set([...Object.keys(t.prev), ...Object.keys(cur)]);
  let changes: Map<number, VarChange> | null = null;
  for (const k of keys) {
    const from = t.prev[k] ?? 0, to = cur[k] ?? 0;
    if (from === to) continue;
    const id = Number(k);
    if (!Number.isInteger(id) || id < 1) continue;
    changes ??= new Map(t.changes);
    const old = changes.get(id);
    const times = [...(old?.times ?? []).filter((x) => now - x < FREQUENT_WINDOW_MS), now];
    changes.delete(id); // 맨 뒤(가장 최근)로
    changes.set(id, { id, from, to, at: now, times });
  }
  if (!changes) return { prev: cur, changes: t.changes };
  while (changes.size > TRACK_MAX) changes.delete(changes.keys().next().value as number);
  return { prev: cur, changes };
}

/** 지금(now) 기준 자주 바뀌는 변수인가 */
export const isFrequent = (c: VarChange, now: number): boolean =>
  c.times.filter((x) => now - x < FREQUENT_WINDOW_MS).length >= FREQUENT_COUNT;

/** 보여 줄 최근 변화: 최근 것부터, 자주 바뀌는 것은 따로. */
export function recentChanges(t: ChangeTracker, now: number, limit = 20): { normal: VarChange[]; frequent: VarChange[] } {
  const normal: VarChange[] = [], frequent: VarChange[] = [];
  for (const c of [...t.changes.values()].reverse()) (isFrequent(c, now) ? frequent : normal).push(c);
  return { normal: normal.slice(0, limit), frequent: frequent.slice(0, limit) };
}

/** "방금", "12초 전", "3분 전", "1시간 전" */
export function agoText(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 5) return "방금";
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  return `${Math.floor(s / 3600)}시간 전`;
}
