import type { GameData, Location } from "../types";
import { extendsArray } from "./lineage";
import type { LogRecord } from "./types";

/**
 * 읽기 화면의 자동 목차(두 단계). 갈래 경로 기록(readerPath의 결과, seq 순)으로 만든다. 예외를 던지지 않는다.
 *
 * - 큰 단위(part): 플레이 묶음 — 이웃한 기록의 시각 차이가 SESSION_GAP_MS를 넘으면 새 묶음.
 *   날짜·진행 변수(varId)를 고르면 대신 그 변수 값이 바뀌는 곳마다 새 묶음.
 * - 작은 단위(scene): 같은 출처(맵 이벤트·커먼 이벤트·전투 이벤트)의 대사(message·scroll)가 이어진 덩어리.
 *   다른 출처의 대사·장소 이동·갈래 시작·큰 단위 경계에서 끊긴다. 대사 SCENE_MIN_LINES개 이상만 목차에 올린다.
 *   같은 출처의 장면이 앞에 이미 있으면 again(다시 본 장면).
 *
 * ChaptersCache는 기록이 덧붙기만 했으면(줄기 표시, core/live/lineage) 새 기록만 이어 계산한다. 결과는 buildChapters와 같다.
 */

export const SESSION_GAP_MS = 20 * 60_000;
export const SCENE_MIN_LINES = 10;

export interface ChapterPart {
  /** 첫 기록 seq·시각 */
  seq: number;
  t: number;
  /** 마지막 기록 seq·시각(지금 묶음은 기록이 붙으면 늘어난다) */
  lastSeq: number;
  lastT: number;
  /** 변수 기준일 때 그 변수 값(첫 묶음이 첫 바뀜 전이면 null) */
  value: number | null;
}

export interface ChapterScene {
  /** 첫 대사 seq, 마지막 대사 seq */
  seq: number;
  lastSeq: number;
  /** 속한 큰 단위 번호(parts 안의 위치) */
  part: number;
  src: Location;
  /** 출처 열쇠(sceneSourceKey) */
  key: string;
  /** 대사 수 */
  lines: number;
  /** 첫 대사 원문(제어 문자 그대로) */
  firstText: string;
  /** 같은 출처의 장면을 앞에서 이미 봤다 */
  again: boolean;
}

/** 큰 단위의 경계(본문의 묶음 제목 줄). 경계가 늘거나 바뀔 때만 새 배열이다. */
export interface ChapterHead { seq: number; t: number; value: number | null }

export interface Chapters {
  /** 고른 변수(없으면 null = 플레이 시간) */
  varId: number | null;
  parts: ChapterPart[];
  scenes: ChapterScene[];
  heads: ChapterHead[];
}

export const EMPTY_CHAPTERS: Chapters = Object.freeze({ varId: null, parts: [], scenes: [], heads: [] }) as Chapters;

/** 장면 출처 열쇠: 맵 이벤트는 페이지를 가리지 않는다 */
export function sceneSourceKey(src: Location | null | undefined): string | null {
  if (!src || typeof src !== "object") return null;
  switch (src.source) {
    case "map": return `m${src.mapId}:${src.eventId}`;
    case "common": return `c${src.commonEventId}`;
    case "troop": return `t${src.troopId}`;
    default: return null;
  }
}

interface Run { key: string; src: Location; seq: number; lastSeq: number; lines: number; firstText: string; part: number }

interface State {
  varId: number | null;
  prevT: number | null;
  parts: ChapterPart[];
  cur: ChapterPart | null;
  scenes: ChapterScene[];
  run: Run | null;
  /** 목차에 올린(끝난) 장면들의 출처 */
  seenKeys: Set<string>;
  /** 변수 기준: 지금 값(모르면 undefined) */
  value: number | undefined;
  heads: ChapterHead[];
}

const newState = (varId: number | null): State => ({
  varId, prevT: null, parts: [], cur: null, scenes: [], run: null, seenKeys: new Set(), value: undefined, heads: [],
});

const textOf = (r: LogRecord): string => (typeof (r as { text?: unknown }).text === "string" ? (r as { text: string }).text : "");

/** 지금 대사 덩어리를 끝낸다(문턱을 넘으면 장면으로) */
function closeRun(st: State): void {
  const run = st.run;
  st.run = null;
  if (!run || run.lines < SCENE_MIN_LINES) return;
  st.scenes.push(sceneOf(st, run));
  st.seenKeys.add(run.key);
}

const sceneOf = (st: State, run: Run): ChapterScene => ({
  seq: run.seq, lastSeq: run.lastSeq, part: run.part, src: run.src, key: run.key, lines: run.lines, firstText: run.firstText,
  again: st.seenKeys.has(run.key),
});

function startPart(st: State, r: LogRecord, t: number, value: number | null): void {
  closeRun(st);
  if (st.cur) st.parts.push(st.cur);
  st.cur = { seq: r.seq, t, lastSeq: r.seq, lastT: t, value };
  st.heads = [...st.heads, { seq: r.seq, t, value }];
}

/** 변수 기준: 이 기록이 고른 변수를 새 값으로 바꾸면 그 값 */
function varChange(st: State, r: LogRecord): number | undefined {
  if (st.varId === null || r.type !== "state" || !Array.isArray(r.changes)) return undefined;
  let next: number | undefined;
  for (const c of r.changes) {
    if (c && c.kind === "variable" && Number(c.id) === st.varId && typeof c.value === "number") next = c.value;
  }
  return next;
}

function step(st: State, r: LogRecord): void {
  if (!r || typeof r !== "object" || typeof r.seq !== "number") return;
  const t = typeof r.t === "number" && Number.isFinite(r.t) ? r.t : (st.prevT ?? 0);
  if (st.varId === null) {
    if (!st.cur || (st.prevT !== null && t - st.prevT > SESSION_GAP_MS)) startPart(st, r, t, null);
  } else {
    const v = varChange(st, r);
    if (!st.cur) {
      // 첫 기록이 그 변수를 바꾸면 그 값으로 시작한다
      st.value = v;
      startPart(st, r, t, v ?? null);
    } else if (v !== undefined && v !== st.value) {
      st.value = v;
      startPart(st, r, t, v);
    }
  }
  st.prevT = t;
  const cur = st.cur!;
  cur.lastSeq = r.seq;
  cur.lastT = Math.max(cur.lastT, t);
  const type = r.type;
  if (type === "message" || type === "scroll") {
    const key = sceneSourceKey(r.src);
    if (key === null) { closeRun(st); return; }
    if (st.run && st.run.key === key) {
      st.run.lines++;
      st.run.lastSeq = r.seq;
      return;
    }
    closeRun(st);
    st.run = { key, src: r.src!, seq: r.seq, lastSeq: r.seq, lines: 1, firstText: textOf(r), part: st.parts.length };
  } else if (type === "transfer" || type === "branchStart") {
    closeRun(st);
  }
}

/** 상태 → 결과(지금 묶음·지금 덩어리를 포함한 새 객체). 앞 결과의 배열·객체는 바꾸지 않는다. */
function snapshot(st: State): Chapters {
  const parts = st.cur ? [...st.parts, { ...st.cur }] : [...st.parts];
  const scenes = st.run && st.run.lines >= SCENE_MIN_LINES ? [...st.scenes, sceneOf(st, st.run)] : [...st.scenes];
  return { varId: st.varId, parts, scenes, heads: st.heads };
}

/** 경로 기록 전체로 목차를 만든다 */
export function buildChapters(path: readonly LogRecord[], varId: number | null = null): Chapters {
  try {
    const st = newState(validVar(varId));
    for (const r of Array.isArray(path) ? path : []) step(st, r);
    return snapshot(st);
  } catch {
    return EMPTY_CHAPTERS;
  }
}

const validVar = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null);

/** buildChapters를 이어 계산한다: 같은 변수 기준이고 경로가 덧붙기만 했으면 새 기록만 본다. */
export class ChaptersCache {
  private src: readonly LogRecord[] | null = null;
  private st: State | null = null;
  private out: Chapters = EMPTY_CHAPTERS;

  get(path: readonly LogRecord[], varId: number | null = null): Chapters {
    try {
      const v = validVar(varId);
      if (!Array.isArray(path)) return EMPTY_CHAPTERS;
      if (path === this.src && this.st?.varId === v) return this.out;
      const resume = this.st !== null && this.st.varId === v && extendsArray(this.src, path);
      const st = resume && this.st ? this.st : newState(v);
      const from = resume && this.src ? this.src.length : 0;
      for (let i = from; i < path.length; i++) step(st, path[i]);
      this.st = st;
      this.src = path;
      this.out = snapshot(st);
      return this.out;
    } catch {
      this.st = null;
      this.src = null;
      this.out = buildChapters(path, varId);
      return this.out;
    }
  }
}

/** 큰 단위 위치(seq가 든 묶음 번호, 없으면 -1) */
export function partIndexAt(parts: readonly { seq: number }[], seq: number): number {
  let lo = 0, hi = parts.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (parts[mid].seq <= seq) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

// ---------------------------------------------------------------- 제목

const DAY_PART = (h: number): string => (h < 6 ? "새벽" : h < 10 ? "아침" : h < 17 ? "낮" : h < 21 ? "저녁" : "밤");

/** 시작 시각: `10월 28일 밤 10:05`. 시각을 모르면 "". */
export function whenLabel(t: number): string {
  try {
    if (!Number.isFinite(t) || t <= 0) return "";
    const d = new Date(t);
    const h = d.getHours();
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${d.getMonth() + 1}월 ${d.getDate()}일 ${DAY_PART(h)} ${h12}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return "";
  }
}

/** 길이: `2시간 10분`·`45분`·`1분 미만` */
export function durationLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms < 60_000) return "1분 미만";
  const m = Math.round(ms / 60_000);
  const h = Math.floor(m / 60), r = m % 60;
  return h === 0 ? `${r}분` : r === 0 ? `${h}시간` : `${h}시간 ${r}분`;
}

/** 변수 이름(없으면 `변수 {id}`) */
export function variableName(data: GameData | null | undefined, id: number): string {
  const n = data?.system?.variables?.[id];
  return typeof n === "string" && n.trim() ? n.trim() : `변수 ${id}`;
}

/** 큰 단위 제목: 변수 기준이면 `「이름」 값`(첫 바뀜 전이면 `「이름」 처음`), 아니면 시작 시각 */
export function partTitle(head: { t: number; value: number | null }, varId: number | null, data: GameData | null | undefined): string {
  if (varId !== null) return `「${variableName(data, varId)}」 ${head.value === null ? "처음" : head.value}`;
  return whenLabel(head.t) || "플레이";
}

/** 출처 이름: `맵 이름 · 이벤트 이름`, 커먼 이벤트·전투 이벤트는 그 이름 */
export function sceneTitle(src: Location, data: GameData | null | undefined): string {
  try {
    if (src.source === "map") {
      const map = data?.mapInfos?.[src.mapId]?.name || `맵 ${src.mapId}`;
      const ev = data?.maps?.get(src.mapId)?.events?.[src.eventId]?.name || `이벤트 ${src.eventId}`;
      return `${map} · ${ev}`;
    }
    if (src.source === "common") return data?.commonEvents?.[src.commonEventId]?.name || `커먼 이벤트 ${src.commonEventId}`;
    if (src.source === "troop") return `전투 · ${data?.troops?.[src.troopId]?.name || `적 무리 ${src.troopId}`}`;
  } catch { /* 아래 */ }
  return "이벤트";
}

// ---------------------------------------------------------------- 날짜·진행 변수 후보

export interface ChapterVarCandidate {
  id: number;
  name: string;
  /** 값이 바뀐 횟수, 내려간 횟수 */
  changes: number;
  decreases: number;
  /** 값 흐름(바뀐 값 차례, 처음 값 포함) */
  values: number[];
  /** 이름이 날짜·진행처럼 보인다 */
  named: boolean;
}

const VAR_NAME_HINT = /일|日|날짜|day|date|진행|章|chapter|週|week|月|month/i;
export const VAR_MIN_CHANGES = 3;
export const VAR_MAX_CHANGES = 300;
export const VAR_MAX_DECREASES = 2;

/**
 * 날짜·진행 변수 후보: 경로에서 거의 오르기만 하고(내려간 횟수 ≤ 2) 바뀐 횟수가 적은(3–300) 변수.
 * 잦은 변수(throttled)는 뺀다. 이름이 날짜·진행 같으면 위로, 그다음 바뀐 횟수가 많은 순. 최대 limit개.
 */
export function chapterVarCandidates(path: readonly LogRecord[], data: GameData | null | undefined, limit = 12): ChapterVarCandidate[] {
  try {
    const st = new Map<number, { last: number; changes: number; decreases: number; values: number[]; noisy: boolean }>();
    for (const r of Array.isArray(path) ? path : []) {
      if (!r || r.type !== "state" || !Array.isArray(r.changes)) continue;
      for (const c of r.changes) {
        if (!c || c.kind !== "variable" || typeof c.value !== "number") continue;
        const id = Number(c.id);
        if (!Number.isSafeInteger(id) || id <= 0) continue;
        let s = st.get(id);
        if (!s) {
          st.set(id, s = { last: c.value, changes: 0, decreases: 0, values: [c.value], noisy: false });
          if (c.throttled) s.noisy = true;
          continue;
        }
        if (c.throttled) s.noisy = true;
        if (s.noisy || c.value === s.last) continue;
        s.changes++;
        if (c.value < s.last) s.decreases++;
        s.last = c.value;
        if (s.values.length <= VAR_MAX_CHANGES + 1) s.values.push(c.value);
        // 너무 많이 바뀐 변수는 더 보지 않는다
        if (s.changes > VAR_MAX_CHANGES) s.noisy = true;
      }
    }
    const out: ChapterVarCandidate[] = [];
    for (const [id, s] of st) {
      if (s.noisy || s.changes < VAR_MIN_CHANGES || s.changes > VAR_MAX_CHANGES || s.decreases > VAR_MAX_DECREASES) continue;
      const name = variableName(data, id);
      out.push({ id, name, changes: s.changes, decreases: s.decreases, values: s.values, named: VAR_NAME_HINT.test(data?.system?.variables?.[id] ?? "") });
    }
    out.sort((a, b) => Number(b.named) - Number(a.named) || b.changes - a.changes || a.id - b.id);
    return out.slice(0, Math.max(0, limit));
  } catch {
    return [];
  }
}

/** 값 흐름 글: `1→2→3→…→13→14` (길면 앞 3개·뒤 2개) */
export function valueFlow(values: readonly number[]): string {
  if (values.length <= 6) return values.join("→");
  return [...values.slice(0, 3), "…", ...values.slice(-2)].join("→");
}
