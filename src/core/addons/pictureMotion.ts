import type { EventCommand } from "../types";
import type { ScreenPicture } from "./screenPictures";

/**
 * 그림 움직임(읽기에서 그림이 GIF처럼 움직여 보이게): 대사 사이에 화면 그림이 바뀐 과정을 짧은 장면 목록(PictureMotion)으로 만든다.
 * - 그림 바꾸기(같은 번호의 그림을 _0001 → _0002 …로 기다림과 함께 바꿔 띄우기)는 장면이 차례로 바뀐다.
 * - 그림 이동(232)·색조(234)는 엔진처럼 걸린 시간 동안 고르게(직선으로) 바뀌고, 회전(233)은 계속 돈다.
 * - 같은 장면 묶음이 여러 번 되풀이되면(반복 안의 그림 바꾸기) 몇 번만 남기고, 길면 끝(대사 때 모습) 쪽만 남긴다.
 * 모두 예외를 던지지 않는다.
 */

/** 엔진 한 프레임(ms, 60fps) */
export const FRAME_MS = 1000 / 60;
/** 움직임 길이 상한(ms). 넘으면 끝 쪽만 남긴다. */
export const MOTION_MAX_MS = 10000;
/** 장면 수 상한. 넘으면 끝 쪽만 남긴다. */
export const MOTION_MAX_FRAMES = 240;
/** 움직임에 나오는 그림 파일 수 상한(모두 미리 읽으니 휴대폰 메모리를 생각해서). 넘으면 끝 쪽만 남긴다. */
export const MOTION_MAX_NAMES = 40;
/** 같은 순간으로 보는 시각 차이(ms) */
export const SAME_MOMENT_MS = 8;
/** 되풀이되는 장면 묶음은 적어도 이만큼(ms)·두 번은 남긴다 */
export const LOOP_KEEP_MS = 2000;
/** 되풀이 묶음 하나의 장면 수 상한(찾는 범위) */
const MAX_PERIOD = 40;

export type Tone = [number, number, number, number];

/** 이동 목표(232). 기준점·합성은 바로 바뀌고 나머지는 걸린 시간 동안 고르게 바뀐다. */
export interface MoveTarget { origin?: number; blendMode?: number; x: number; y: number; scaleX: number; scaleY: number; opacity: number }

/** 시각 t(ms)에 일어난 그림 바꾸기 하나 */
export type MotionOp =
  | { t: number; kind: "show"; id: number; pic: ScreenPicture }
  | { t: number; kind: "erase"; id: number }
  /** dur: 걸린 시간(ms, 0이면 바로) */
  | { t: number; kind: "move"; id: number; to: MoveTarget; dur: number }
  | { t: number; kind: "tint"; id: number; tone: Tone; dur: number }
  /** speed: 도/ms */
  | { t: number; kind: "spin"; id: number; speed: number };

/**
 * 장면의 그림 하나: 그 장면 시각의 모습 + 그때 진행 중인 바뀜. move·tint의 t1 = 바뀜이 끝나는 시각(움직임 처음부터 ms).
 * spin = 회전 빠르기(도/ms).
 */
export interface MotionPicture extends ScreenPicture {
  move?: { x: number; y: number; scaleX: number; scaleY: number; opacity: number; t1: number };
  tint?: { tone: Tone; t1: number };
  spin?: number;
}
/** 시각 t(ms)부터 다음 장면까지의 그림들(번호 순) */
export interface MotionFrame { t: number; pictures: MotionPicture[] }
/** 그림 움직임: 장면들(첫 장면 t = 0)과 끝 시각(마지막 바뀜이 끝나는 때 — 그 뒤로는 대사 때 모습 그대로) */
export interface PictureMotion { frames: MotionFrame[]; end: number }

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** 그림 하나를 from 시각의 모습에서 to 시각의 모습으로(진행 중인 바뀜을 따라). 끝난 바뀜은 뺀다. */
function advance(p: MotionPicture, from: number, to: number): MotionPicture {
  if (!(to > from) || (!p.move && !p.tint && !p.spin)) return p;
  const q: MotionPicture = { ...p };
  if (p.move) {
    const k = p.move.t1 > from ? clamp01((to - from) / (p.move.t1 - from)) : 1;
    q.x = lerp(p.x, p.move.x, k); q.y = lerp(p.y, p.move.y, k);
    q.scaleX = lerp(p.scaleX, p.move.scaleX, k); q.scaleY = lerp(p.scaleY, p.move.scaleY, k);
    q.opacity = lerp(p.opacity, p.move.opacity, k);
    if (k >= 1) delete q.move;
  }
  if (p.tint) {
    const k = p.tint.t1 > from ? clamp01((to - from) / (p.tint.t1 - from)) : 1;
    const a = p.tone ?? [0, 0, 0, 0], b = p.tint.tone;
    const tone: Tone = [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k), lerp(a[3], b[3], k)];
    if (tone.some(v => v !== 0)) q.tone = tone; else delete q.tone;
    if (k >= 1) delete q.tint;
  }
  if (p.spin) {
    const angle = ((p.angle ?? 0) + p.spin * (to - from)) % 360;
    if (angle !== 0) q.angle = angle; else delete q.angle;
  }
  return q;
}

/** 진행 중인 바뀜을 뺀 모습 */
function still(p: MotionPicture): ScreenPicture {
  const { move: _m, tint: _t, spin: _s, ...rest } = p;
  return rest;
}

function applyOp(state: Map<number, MotionPicture>, op: MotionOp): void {
  const cur = state.get(op.id);
  switch (op.kind) {
    case "show": state.set(op.id, { ...still(op.pic) }); return;
    case "erase": state.delete(op.id); return;
    case "move": {
      if (!cur) return;
      const p: MotionPicture = { ...cur };
      if (op.to.origin !== undefined) p.origin = op.to.origin;
      if (op.to.blendMode !== undefined) p.blendMode = op.to.blendMode;
      const { x, y, scaleX, scaleY, opacity } = op.to;
      if (op.dur > FRAME_MS / 2) p.move = { x, y, scaleX, scaleY, opacity, t1: op.t + op.dur };
      else { Object.assign(p, { x, y, scaleX, scaleY, opacity }); delete p.move; }
      state.set(op.id, p);
      return;
    }
    case "tint": {
      if (!cur) return;
      const p: MotionPicture = { ...cur };
      if (op.dur > FRAME_MS / 2) p.tint = { tone: op.tone, t1: op.t + op.dur };
      else {
        delete p.tint;
        if (op.tone.some(v => v !== 0)) p.tone = op.tone; else delete p.tone;
      }
      state.set(op.id, p);
      return;
    }
    case "spin": {
      if (!cur) return;
      const p: MotionPicture = { ...cur };
      if (op.speed !== 0) p.spin = op.speed; else delete p.spin;
      state.set(op.id, p);
    }
  }
}

const byId = (a: { id: number }, b: { id: number }) => a.id - b.id;

/**
 * 시작 모습(start)에 바꾸기들(ops, 시각 순)을 차례로 적용한 장면들. 같은 순간(SAME_MOMENT_MS 안)의 바꾸기는 한 장면으로.
 * 마지막 바뀜이 끝나는 때에 그 뒤 모습 장면을 더한다. 시각은 첫 바꾸기를 0으로 다시 센다.
 */
export function simulateMotion(start: Iterable<ScreenPicture>, ops: MotionOp[], until = 0): PictureMotion {
  const frames: MotionFrame[] = [];
  try {
    const list = (Array.isArray(ops) ? ops : []).filter(o => o && fin(o.t)).slice().sort((a, b) => a.t - b.t);
    if (list.length === 0) return { frames, end: 0 };
    const t0 = list[0].t;
    let state = new Map<number, MotionPicture>();
    for (const p of start) if (p && fin(p.id)) state.set(p.id, { ...p });
    let now = t0;
    for (let i = 0; i < list.length;) {
      const at = list[i].t;
      const next = new Map<number, MotionPicture>();
      for (const [id, p] of state) next.set(id, advance(p, now, at));
      state = next;
      now = at;
      while (i < list.length && list[i].t - at <= SAME_MOMENT_MS) applyOp(state, { ...list[i++], t: at } as MotionOp);
      const pictures = [...state.values()].sort(byId);
      const f = { t: at - t0, pictures };
      if (frames.length > 0 && frames[frames.length - 1].t === f.t) frames[frames.length - 1] = f; else frames.push(f);
    }
    // 진행 중인 바뀜이 끝나는 때(회전은 끝이 없다)
    let end = Math.max(now, fin(until) ? t0 + until : now);
    for (const p of state.values()) {
      if (p.move) end = Math.max(end, p.move.t1);
      if (p.tint) end = Math.max(end, p.tint.t1);
    }
    for (const f of frames) for (const p of f.pictures) rebase(p, -t0);
    if (end > now) {
      const pictures = [...state.values()].map(p => { const q = advance(p, now, end); return rebase({ ...q }, -t0); }).sort(byId);
      frames.push({ t: end - t0, pictures });
    }
    return { frames, end: end - t0 };
  } catch {
    return { frames, end: frames.length > 0 ? frames[frames.length - 1].t : 0 };
  }
}

/** 바뀜이 끝나는 시각을 d만큼 옮긴다(제자리) */
function rebase(p: MotionPicture, d: number): MotionPicture {
  if (p.move) p.move = { ...p.move, t1: p.move.t1 + d };
  if (p.tint) p.tint = { ...p.tint, t1: p.tint.t1 + d };
  return p;
}

const shifted = (f: MotionFrame, d: number): MotionFrame =>
  ({ t: f.t + d, pictures: f.pictures.map(p => rebase({ ...p }, d)) });

/** t(ms) 때의 그림들(번호 순). 처음 전이면 첫 장면, 끝 뒤면 끝 모습. */
export function motionAt(m: PictureMotion, t: number): ScreenPicture[] {
  try {
    const frames = m.frames;
    if (frames.length === 0) return [];
    const i = frameIndexAt(m, t);
    const f = frames[i];
    return f.pictures.map(p => still(advance(p, f.t, Math.max(f.t, Math.min(t, m.end)))));
  } catch {
    return [];
  }
}

/** t(ms) 때의 장면 번호 */
export function frameIndexAt(m: PictureMotion, t: number): number {
  const frames = m.frames;
  let lo = 0, hi = frames.length - 1, found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

/** 장면에 진행 중인 바뀜(이동·색조·회전)이 있는가 — 있으면 장면 사이에도 다시 그린다 */
export function frameMoves(f: MotionFrame | undefined): boolean {
  return !!f && f.pictures.some(p => !!p.move || !!p.tint || !!p.spin);
}

const r1 = (v: number) => Math.round(v);
/** 보이는 모습의 열쇠(보이는 그림의 이름·위치·크기·투명도·색조·각도, 정수로) */
function lookKey(pics: ScreenPicture[]): string {
  return pics.filter(p => p.opacity >= 1)
    .map(p => [p.id, p.name, p.origin, r1(p.x), r1(p.y), r1(p.scaleX), r1(p.scaleY), r1(p.opacity), p.blendMode,
      (p.tone ?? []).map(r1).join(","), r1(p.angle ?? 0)].join("|")).join("\n");
}

/** 장면의 열쇠(모습 + 진행 중인 바뀜을 장면 시각 기준으로) */
function frameKey(f: MotionFrame): string {
  return lookKey(f.pictures) + "#" + f.pictures.map(p => [
    p.move ? [r1(p.move.x), r1(p.move.y), r1(p.move.scaleX), r1(p.move.scaleY), r1(p.move.opacity), r1(p.move.t1 - f.t)].join(",") : "",
    p.tint ? [...p.tint.tone.map(r1), r1(p.tint.t1 - f.t)].join(",") : "",
    p.spin ? p.spin.toFixed(4) : "",
  ].join(";")).join("/");
}

/** 앞 장면과 모습이 같고 진행 중인 바뀜이 없는 장면은 뺀다(앞 장면이 그대로 이어진다) */
function dropSame(frames: MotionFrame[]): MotionFrame[] {
  const out: MotionFrame[] = [];
  for (const f of frames) {
    const prev = out[out.length - 1];
    if (prev && !frameMoves(prev) && !frameMoves(f) && lookKey(prev.pictures) === lookKey(f.pictures)) continue;
    out.push(f);
  }
  return out;
}

/**
 * 같은 장면 묶음(열쇠와 다음 장면까지의 시간이 같은 p개)이 세 번 넘게 이어 되풀이되면 LOOP_KEEP_MS·두 번만큼만 남기고
 * 나머지 되풀이를 뺀다(뒤 장면 시각을 당긴다).
 */
function collapseRepeats(frames: MotionFrame[], end: number): { frames: MotionFrame[]; end: number } {
  const n = frames.length;
  if (n < 6) return { frames, end };
  const dts = frames.map((f, i) => r1((i + 1 < n ? frames[i + 1].t : end) - f.t));
  const keys = frames.map((f, i) => frameKey(f) + "@" + dts[i]);
  const out: MotionFrame[] = [];
  let shift = 0;
  for (let i = 0; i < n;) {
    let done = false;
    for (let p = 1; p <= MAX_PERIOD && i + 3 * p <= n && !done; p++) {
      let len = 0;
      while (i + len + p < n && keys[i + len] === keys[i + len + p]) len++;
      const reps = Math.floor(len / p) + 1;
      if (reps < 3) continue;
      let period = 0;
      for (let k = 0; k < p; k++) period += dts[i + k];
      const keep = Math.min(reps, Math.max(2, period > 0 ? Math.ceil(LOOP_KEEP_MS / period) : 2));
      if (keep >= reps) continue;
      for (let k = 0; k < keep * p; k++) out.push(shifted(frames[i + k], -shift));
      shift += (reps - keep) * period;
      i += reps * p;
      done = true;
    }
    if (!done) { out.push(shifted(frames[i], -shift)); i++; }
  }
  return { frames: out, end: end - shift };
}

/** 너무 길면(MOTION_MAX_MS·MOTION_MAX_FRAMES) 끝 쪽만: 자른 때의 모습을 첫 장면으로 */
function capTail(frames: MotionFrame[], end: number): { frames: MotionFrame[]; end: number } {
  let cut = Math.max(0, end - MOTION_MAX_MS);
  if (frames.length > MOTION_MAX_FRAMES) cut = Math.max(cut, frames[frames.length - MOTION_MAX_FRAMES].t);
  // 그림 파일 수(미리 읽을 그림)도 끝 쪽 MOTION_MAX_NAMES개까지
  const seen = new Set<string>();
  for (let k = frames.length - 1; k > 0; k--) {
    for (const p of frames[k].pictures) seen.add(p.name);
    if (seen.size > MOTION_MAX_NAMES) { cut = Math.max(cut, frames[k + 1]?.t ?? frames[k].t); break; }
  }
  if (cut <= 0) return { frames, end };
  const m = { frames, end };
  const i = frameIndexAt(m, cut);
  const base = frames[i];
  const first: MotionFrame = { t: cut, pictures: base.pictures.map(p => advance(p, base.t, cut)) };
  const rest = frames.slice(i + 1).filter(f => f.t > cut);
  return { frames: [first, ...rest].map(f => shifted(f, -cut)), end: end - cut };
}

/**
 * 장면들을 다듬는다(같은 장면 빼기 → 되풀이 줄이기 → 끝 쪽만 남기기). 보이는 모습이 두 가지 이상이 아니면 null(움직일 것 없음).
 */
export function finishMotion(m: PictureMotion | null | undefined): PictureMotion | null {
  try {
    if (!m || !Array.isArray(m.frames) || m.frames.length === 0) return null;
    let frames = dropSame(m.frames);
    let end = Math.max(m.end, frames[frames.length - 1].t);
    ({ frames, end } = collapseRepeats(frames, end));
    ({ frames, end } = capTail(frames, end));
    if (frames.length === 0) return null;
    const out: PictureMotion = { frames, end };
    // 보이는 모습이 두 가지 이상인가(장면마다, 끝 모습 포함)
    const looks = new Set<string>();
    for (const f of frames) looks.add(lookKey(motionAt(out, f.t)));
    looks.add(lookKey(motionAt(out, end)));
    if (frames.some(f => f.pictures.some(p => p.spin))) looks.add("spin");
    return looks.size >= 2 ? out : null;
  } catch {
    return null;
  }
}

/**
 * 첫 장면(움직이는 것 없음)이 lead(ms)보다 오래 이어지면 lead로 줄인다(뒤 장면들을 당긴다). 바꿀 것이 없으면 그대로.
 */
export function trimLead(m: PictureMotion | null, lead: number): PictureMotion | null {
  try {
    if (!m || m.frames.length < 2 || frameMoves(m.frames[0])) return m;
    const extra = m.frames[1].t - m.frames[0].t - lead;
    if (!(extra > 0)) return m;
    return { frames: [m.frames[0], ...m.frames.slice(1).map(f => shifted(f, -extra))], end: m.end - extra };
  } catch {
    return m;
  }
}

/** 두 움직임이 같은가(읽기 항목 비교용 — 장면 수·끝 시각·마지막 장면 모습) */
export function sameMotion(a: PictureMotion | null | undefined, b: PictureMotion | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  if (a === b) return true;
  if (a.frames.length !== b.frames.length || a.end !== b.end) return false;
  const fa = a.frames[a.frames.length - 1], fb = b.frames[b.frames.length - 1];
  return !fa || !fb ? fa === fb : frameKey(fa) === frameKey(fb);
}

/** 움직임에 나오는 그림 이름들(미리 읽기용) */
export function motionNames(m: PictureMotion | null | undefined): string[] {
  const out = new Set<string>();
  for (const f of m?.frames ?? []) for (const p of f.pictures) if (p.name) out.add(p.name);
  return [...out];
}

// ---------------------------------------------------------------- 이벤트 명령(아직 안 본 것)

/** 이벤트 명령 목록에서 그림 움직임 하나: first = 첫 그림 표시(231) 명령 번호, from·to = 명령 범위 [from, to) */
export interface MotionRun { first: number; from: number; to: number; motion: PictureMotion }

/** 그림 움직임 구간 안에 있어도 되는 명령(그림·기다림·소리·화면 효과·주석·스위치/변수·조건·반복) */
const RUN_CODES = new Set([
  0, 108, 408, 111, 411, 412, 112, 413, 113, 121, 122, 123, 223, 224, 225, 230, 231, 232, 233, 234, 235, 236,
  241, 242, 243, 244, 245, 246, 249, 250, 251,
]);
const PICTURE_CODES = new Set([231, 232, 233, 234, 235]);
/** 반복(112) 하나를 되풀이해 보는 시간(ms)·횟수 상한 */
const STATIC_LOOP_MS = 3000, STATIC_LOOP_MAX = 20;

const indentOf = (list: EventCommand[], i: number) => (fin(list[i]?.indent) ? list[i].indent : 0);

/** i의 블록(111 조건·112 반복)이 끝나는 명령(같은 깊이의 412·413) 번호. 없으면 end. */
function blockEnd(list: EventCommand[], i: number, end: number, closer: number): number {
  const ind = indentOf(list, i);
  for (let j = i + 1; j < end; j++) if (list[j]?.code === closer && indentOf(list, j) === ind) return j;
  return end;
}

function num(v: unknown, d: number): number { return fin(v) ? v : d; }

/** 231 그림 표시 파라미터 → 그림(변수 위치는 모르니 화면 가운데). 이름이 없으면 null. */
function showPic(p: unknown[], screen: { width: number; height: number }): ScreenPicture | null {
  const id = p[0], name = p[1];
  if (!fin(id) || id < 1 || typeof name !== "string" || !name) return null;
  const pic: ScreenPicture = {
    id, name, origin: p[2] === 1 ? 1 : 0, x: num(p[4], 0), y: num(p[5], 0), scaleX: num(p[6], 100), scaleY: num(p[7], 100),
    opacity: Math.max(0, Math.min(255, num(p[8], 255))), blendMode: p[9] === 1 || p[9] === 2 || p[9] === 3 ? p[9] : 0,
  };
  if (p[3] === 1) { pic.origin = 1; pic.x = screen.width / 2; pic.y = screen.height / 2; }
  return pic;
}

/**
 * 명령 범위 [from, to)를 엔진처럼 따라가며 그림 바꾸기를 모은다. 기다림(230)·기다리는 이동(232)·색조(234)만큼 시각이 흐른다.
 * 조건(111)은 실행됐는지 모르니 건너뛰고, 반복(112)은 STATIC_LOOP_MS만큼 되풀이한다(안의 조건 — 반복 끝내기 — 은 건너뛴다).
 * cur = 지금 그림들(그림 표시만 바로 적용, 위치 계산용). 돌려주는 값 = 끝 시각.
 */
function collectOps(
  list: EventCommand[], from: number, to: number, t: number, cur: Map<number, ScreenPicture>, out: MotionOp[],
  screen: { width: number; height: number }, depth = 0,
): number {
  for (let i = from; i < to && out.length < 4000; i++) {
    const c = list[i];
    if (!c) continue;
    const p = Array.isArray(c.parameters) ? c.parameters : [];
    switch (c.code) {
      case 230: t += Math.max(0, num(p[0], 0)) * FRAME_MS; break;
      case 231: {
        const pic = showPic(p, screen);
        if (pic) { cur.set(pic.id, pic); out.push({ t, kind: "show", id: pic.id, pic }); }
        else if (fin(p[0])) { cur.delete(p[0]); out.push({ t, kind: "erase", id: p[0] }); }
        break;
      }
      case 232: {
        const id = p[0], before = fin(id) ? cur.get(id) : undefined;
        if (!fin(id) || !before) break;
        const variable = p[3] === 1;
        const to2: MoveTarget = {
          origin: p[2] === 1 ? 1 : 0, blendMode: p[9] === 1 || p[9] === 2 || p[9] === 3 ? p[9] : 0,
          x: variable ? before.x : num(p[4], before.x), y: variable ? before.y : num(p[5], before.y),
          scaleX: num(p[6], before.scaleX), scaleY: num(p[7], before.scaleY), opacity: Math.max(0, Math.min(255, num(p[8], before.opacity))),
        };
        const dur = Math.max(0, num(p[10], 0)) * FRAME_MS;
        out.push({ t, kind: "move", id, to: to2, dur });
        cur.set(id, { ...before, ...to2 });
        if (p[11] === true) t += dur;
        break;
      }
      case 233: if (fin(p[0])) out.push({ t, kind: "spin", id: p[0], speed: (num(p[1], 0) / 2) / FRAME_MS }); break;
      case 234: {
        const tone = Array.isArray(p[1]) ? p[1] : null;
        if (!fin(p[0]) || !tone) break;
        const dur = Math.max(0, num(p[2], 0)) * FRAME_MS;
        out.push({ t, kind: "tint", id: p[0], tone: [num(tone[0], 0), num(tone[1], 0), num(tone[2], 0), num(tone[3], 0)], dur });
        if (p[3] === true) t += dur;
        break;
      }
      case 235: if (fin(p[0])) { cur.delete(p[0]); out.push({ t, kind: "erase", id: p[0] }); } break;
      case 111: i = blockEnd(list, i, to, 412); break;
      case 112: {
        const end = blockEnd(list, i, to, 413);
        if (depth < 3) {
          const t0 = t;
          // 반복 안의 맨 위 깊이에 반복 끝내기(113)가 있으면 한 번만
          const once = list.slice(i + 1, end).some((x, k) => x?.code === 113 && indentOf(list, i + 1 + k) === indentOf(list, i) + 1);
          for (let n = 0; n < (once ? 1 : STATIC_LOOP_MAX); n++) {
            const before = t;
            t = collectOps(list, i + 1, end, t, cur, out, screen, depth + 1);
            if (t - t0 >= STATIC_LOOP_MS || t === before) break;
          }
        }
        i = end;
        break;
      }
      default: break;
    }
  }
  return t;
}

/**
 * 이벤트 명령 목록의 그림 움직임들(아직 안 본 이벤트를 읽을 때): 그림·기다림·소리·조건·반복만 이어진 구간마다
 * 그림 명령이 둘 이상이고 보이는 모습이 두 가지 이상이면 하나. 시작 모습 = 그 앞 명령들의 그림 표시·이동·지우기를 차례로 바로 적용한 것.
 * 변수로 정한 위치는 화면 가운데.
 */
export function motionRuns(list: EventCommand[] | null | undefined, screen: { width: number; height: number }): MotionRun[] {
  const out: MotionRun[] = [];
  try {
    if (!Array.isArray(list)) return out;
    const before = new Map<number, ScreenPicture>();
    let applied = 0;
    const applyUntil = (to: number) => {
      for (; applied < to; applied++) {
        const c = list[applied];
        const p = Array.isArray(c?.parameters) ? c.parameters : [];
        if (c?.code === 231) { const pic = showPic(p, screen); if (pic) before.set(pic.id, pic); else if (fin(p[0])) before.delete(p[0]); }
        else if (c?.code === 235 && fin(p[0])) before.delete(p[0]);
        else if (c?.code === 232 && fin(p[0])) {
          const b = before.get(p[0]);
          if (b) before.set(p[0], { ...b, x: p[3] === 1 ? b.x : num(p[4], b.x), y: p[3] === 1 ? b.y : num(p[5], b.y), scaleX: num(p[6], b.scaleX), scaleY: num(p[7], b.scaleY), opacity: num(p[8], b.opacity) });
        }
      }
    };
    for (let i = 0; i < list.length;) {
      if (!RUN_CODES.has(list[i]?.code)) { i++; continue; }
      let j = i;
      while (j < list.length && RUN_CODES.has(list[j]?.code)) j++;
      let pics = 0, first = -1;
      for (let k = i; k < j; k++) {
        const code = list[k]?.code;
        if (PICTURE_CODES.has(code)) pics++;
        if (first < 0 && code === 231 && typeof list[k].parameters?.[1] === "string" && list[k].parameters[1]) first = k;
      }
      if (pics >= 2 && first >= 0) {
        applyUntil(i);
        const ops: MotionOp[] = [];
        // 마지막 명령 뒤의 기다림도 그 모습을 보이는 시간이다
        const until = collectOps(list, i, j, 0, new Map(before), ops, screen);
        const sim = simulateMotion(before.values(), [{ t: 0, kind: "erase", id: -1 }, ...ops], until);
        const motion = finishMotion(sim);
        if (motion) out.push({ first, from: i, to: j, motion });
      }
      i = j;
    }
  } catch { /* 찾은 데까지 */ }
  return out;
}
