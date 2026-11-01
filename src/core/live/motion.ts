import {
  finishMotion, FRAME_MS, simulateMotion, trimLead, type MotionOp, type MotionPicture, type PictureMotion,
} from "../addons/pictureMotion";
import type { ScreenPicture, ScreenShot } from "../addons/screenPictures";
import type { GameData } from "../types";
import type { CutinStep } from "./cutins";
import { pageList } from "./mismatch";
import type { StackPicture } from "./pictureStack";

/**
 * 플레이 기록의 그림 움직임(core/addons/pictureMotion): 대사 사이 구간의 그림 명령 기록(컷인 찾기와 같은 구간 steps)을
 * 기록 시각대로 장면으로 만든다. 이동(232)의 걸린 시간은 게임 데이터의 그 명령에서 읽는다. 모두 예외를 던지지 않는다.
 */

/** 기록 사이가 이보다 길면(ms) 이만큼으로 줄인다(게임이 멈춰 있던 때 등) */
export const MOTION_MAX_GAP_MS = 2000;
/**
 * 첫 모습 다음 기록까지가 이보다 길면(ms) 이만큼으로 줄인다: 앞 줄 뒤에 다시 그린 그림이 플레이어가 고르는 동안(전투 명령 입력 등)
 * 그대로 있다가 컷인이 시작되는 때, 움직임 앞에 오래 멈춰 있지 않게.
 */
export const MOTION_LEAD_GAP_MS = 600;

const tOf = (r: { t?: unknown }): number => (typeof r?.t === "number" && Number.isFinite(r.t) ? r.t : 0);

/** 이동 기록의 걸린 시간(ms): 게임 데이터의 그 자리 명령(232)의 프레임 수. 모르면 0(바로). */
function moveDuration(step: CutinStep, data: GameData): number {
  try {
    const r = step.rec;
    if (!r.src || typeof r.cmd !== "number") return 0;
    const c = pageList(data, r.src)?.[r.cmd];
    if (!c || c.code !== 232 || !Array.isArray(c.parameters) || c.parameters[0] !== r.pictureId) return 0;
    const d = c.parameters[10];
    return typeof d === "number" && Number.isFinite(d) && d > 0 ? d * FRAME_MS : 0;
  } catch {
    return 0;
  }
}

/**
 * 구간의 그림 바꾸기들: 기록마다 앞 묶음과 그 뒤 묶음을 비교해(예전 기록의 추정 지우기도 들어간다) 사라진 번호는 지우기,
 * 이동 기록의 번호는 이동(걸린 시간 동안), 그 밖에 바뀐 번호는 표시. 시각은 기록 시각(사이가 길면 줄인다).
 */
export function stepOps(start: ReadonlyMap<number, StackPicture>, steps: CutinStep[], data: GameData): MotionOp[] {
  const ops: MotionOp[] = [];
  try {
    let prev = start, t = 0, lastT: number | null = null;
    for (const s of Array.isArray(steps) ? steps : []) {
      const rt = tOf(s.rec);
      if (lastT !== null && rt > 0) t += Math.max(0, Math.min(MOTION_MAX_GAP_MS, rt - lastT));
      if (rt > 0) lastT = rt;
      const ids = new Set<number>([...prev.keys(), ...s.stack.keys()]);
      for (const id of ids) {
        const a = prev.get(id), b = s.stack.get(id);
        if (a === b) continue;
        if (!b) ops.push({ t, kind: "erase", id });
        else if (a && s.rec.op === "move" && s.rec.pictureId === id && a.name === b.name) {
          const { origin, blendMode, x, y, scaleX, scaleY, opacity } = b;
          ops.push({ t, kind: "move", id, to: { origin, blendMode, x, y, scaleX, scaleY, opacity }, dur: moveDuration(s, data) });
        } else ops.push({ t, kind: "show", id, pic: b });
      }
      prev = s.stack;
    }
  } catch { /* 모은 데까지 */ }
  return ops;
}

/** 장면의 그림을 보일 그림(still)에 맞춘다: 같은 이름이면 보일 그림의 크기·자르기 등을 그대로, 다른 이름이면 그것만 뺀다 */
function onto(base: ScreenPicture, p: MotionPicture): MotionPicture {
  const q: MotionPicture = { ...base, name: p.name, origin: p.origin, x: p.x, y: p.y, scaleX: p.scaleX, scaleY: p.scaleY, opacity: p.opacity, blendMode: p.blendMode };
  if (p.tone) q.tone = p.tone; else delete q.tone;
  if (p.angle) q.angle = p.angle; else delete q.angle;
  if (p.move) q.move = p.move;
  if (p.tint) q.tint = p.tint;
  if (p.spin) q.spin = p.spin;
  if (p.name !== base.name) { delete q.w; delete q.h; delete q.crop; delete q.anchor; }
  return q;
}

/**
 * 대사의 그림 움직임: 대사 앞 구간(start·steps)에서 바뀐 그림 번호만 움직이고, 나머지는 대사의 그림(shot) 그대로.
 * 대사 때 보이지 않는 그림(컷인·숨김·화면 장식)은 넣지 않으니 보이는 것은 대사의 그림과 같다. 마지막 모습은 대사의 그림.
 * 움직일 것이 없으면 null.
 */
export function messageMotion(
  start: ReadonlyMap<number, StackPicture>, steps: CutinStep[], shot: ScreenShot | null | undefined, data: GameData,
): PictureMotion | null {
  try {
    if (!shot || !Array.isArray(steps) || steps.length === 0) return null;
    const ops = stepOps(start, steps, data);
    const touched = new Set(ops.map(o => o.id));
    if (!shot.pictures.some(p => touched.has(p.id))) return null;
    const sim = simulateMotion(start.values(), ops);
    const frames = sim.frames.map(f => {
      const byId = new Map(f.pictures.map(p => [p.id, p] as const));
      const pictures: MotionPicture[] = [];
      for (const p of shot.pictures) {
        if (!touched.has(p.id)) { pictures.push(p); continue; }
        const q = byId.get(p.id);
        if (q) pictures.push(onto(p, q));
      }
      return { t: f.t, pictures };
    });
    if (frames.length === 0) return null;
    // 끝 모습은 대사의 그림 그대로
    const last = frames[frames.length - 1];
    if (last.t >= sim.end) frames[frames.length - 1] = { t: last.t, pictures: shot.pictures.slice() };
    else frames.push({ t: sim.end, pictures: shot.pictures.slice() });
    return trimLead(finishMotion({ frames, end: sim.end }), MOTION_LEAD_GAP_MS);
  } catch {
    return null;
  }
}

/**
 * 컷인의 그림 움직임: 컷인 장면들(frames)에 나오는 그림 번호만, 컷인의 첫·끝 기록(first·last seq) 사이 기록 시각대로.
 * 움직일 것이 없으면 null.
 */
export function cutinMotion(
  start: ReadonlyMap<number, StackPicture>, steps: CutinStep[], first: number, last: number, frames: ScreenShot[], data: GameData,
): PictureMotion | null {
  try {
    const i0 = steps.findIndex(s => s.rec.seq === first);
    let i1 = -1;
    steps.forEach((s, i) => { if (s.rec.seq === last) i1 = i; });
    if (i0 < 0 || i1 < i0) return null;
    const ids = new Set(frames.flatMap(f => f.pictures.map(p => p.id)));
    const before = i0 > 0 ? steps[i0 - 1].stack : start;
    const sim = simulateMotion(before.values(), stepOps(before, steps.slice(i0, i1 + 1), data));
    const out = sim.frames.map(f => ({ t: f.t, pictures: f.pictures.filter(p => ids.has(p.id)) }));
    return trimLead(finishMotion({ frames: out, end: sim.end }), MOTION_LEAD_GAP_MS);
  } catch {
    return null;
  }
}
