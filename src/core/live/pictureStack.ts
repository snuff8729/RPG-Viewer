import { sceneOf, type PictureContext, type ScreenPicture, type ScreenScene, type ScreenSize } from "../addons/screenPictures";
import type { GameData } from "../types";
import { pageList } from "./mismatch";
import type { LogRecord, RecordOf } from "./types";

/**
 * 그림 명령 기록으로 화면 그림 다시 쌓기(화면 그림 따라 그리기가 꺼진 게임). 몸·눈·팔처럼 그림 여러 장을 겹쳐 캐릭터를 그리는 게임도
 * 기록된 그림 표시(231)·이동(232, 1.15.0+)·지우기(235, 1.15.0+)를 따라가 화면처럼 합쳐 그린다. 모두 예외를 던지지 않는다.
 * - 1.15.0+ 그림 표시 기록에는 실제로 쓴 위치·크기·투명도(origin·x·y·scaleX·scaleY·opacity·blend)가 들어 있다.
 * - 그 전 기록은 게임 데이터에서 그 자리(src·cmd)의 그림 표시 명령을 찾아 읽는다. 변수로 정한 위치는 지금 게임의 같은 갈래면
 *   지금 변수 값으로, 아니면 위치를 몰라 화면 가운데에 둔다(posUnknown). 이동 기록이 없어 투명도 0으로 띄운 그림은 다 보이게 둔다.
 */

/** 변수로 정한 위치에 쓸 지금 게임 변수(같은 갈래 기록에만 쓴다). values = 0이 아닌 값. */
export interface PictureVars { branch: number; values: Record<string, number> }

/** 다시 쌓은 그림 하나(ScreenPicture + 위치를 몰라 가운데에 둔 표시) */
export type StackPicture = ScreenPicture & { posUnknown?: true };

type Move = Partial<Pick<ScreenPicture, "origin" | "x" | "y" | "scaleX" | "scaleY" | "opacity" | "blendMode">>;
export type PictureOp =
  /** pic null = 이름 없는 그림(글자 그림 등) — 그 번호의 그림을 지운다 */
  | { op: "show"; id: number; pic: StackPicture | null }
  | { op: "erase"; id: number }
  | { op: "move"; id: number; to: Move };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clampOpacity = (v: number) => Math.max(0, Math.min(255, v));
const blendOf = (v: unknown): number => (v === 1 || v === 2 || v === 3 ? v : 0);

/** 기록의 그림 번호(1 이상 정수). 아니면 null. */
function idOf(r: RecordOf<"picture">): number | null {
  const id = r.pictureId;
  return typeof id === "number" && Number.isInteger(id) && id >= 1 ? id : null;
}

/** 그림 표시 명령(231)의 파라미터: [id, name, origin, designation, x, y, scaleX, scaleY, opacity, blend] */
function commandParams(r: RecordOf<"picture">, data: GameData, code: number): unknown[] | null {
  if (!r.src || typeof r.cmd !== "number") return null;
  const list = pageList(data, r.src);
  const c = list?.[r.cmd];
  if (!c || c.code !== code || !Array.isArray(c.parameters)) return null;
  return c.parameters;
}

/** 변수 값(없으면 0). 쓸 수 없으면 null. */
function varValue(vars: PictureVars | null, r: LogRecord, id: unknown): number | null {
  if (!vars || r.branch !== vars.branch || typeof id !== "number") return null;
  const v = vars.values?.[String(id)];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** 기록 하나 → 그림 바꾸기. 그림 기록이 아니거나 모르면 null. */
export function pictureOp(r: LogRecord, data: GameData, screen: ScreenSize, vars: PictureVars | null = null): PictureOp | null {
  try {
    if (!r || r.type !== "picture") return null;
    const id = idOf(r);
    if (id === null) return null;
    if (r.op === "erase") return { op: "erase", id };
    if (r.op === "move") {
      const to: Move = {};
      if (r.origin === 0 || r.origin === 1) to.origin = r.origin;
      const x = num(r.x), y = num(r.y), sx = num(r.scaleX), sy = num(r.scaleY), op = num(r.opacity);
      if (x !== null) to.x = x;
      if (y !== null) to.y = y;
      if (sx !== null) to.scaleX = sx;
      if (sy !== null) to.scaleY = sy;
      if (op !== null) to.opacity = clampOpacity(op);
      if (r.blend !== undefined) to.blendMode = blendOf(r.blend);
      return { op: "move", id, to };
    }
    if (r.op !== undefined) return null;
    const name = typeof r.name === "string" ? r.name : "";
    if (!name) return { op: "show", id, pic: null };
    // 1.15.0+: 기록에 실제로 쓴 값이 있다
    const x = num(r.x), y = num(r.y);
    if (x !== null && y !== null) {
      return {
        op: "show", id, pic: {
          id, name, origin: r.origin === 1 ? 1 : 0, x, y, scaleX: num(r.scaleX) ?? 100, scaleY: num(r.scaleY) ?? 100,
          opacity: clampOpacity(num(r.opacity) ?? 255), blendMode: blendOf(r.blend),
        },
      };
    }
    // 그 전: 게임 데이터의 명령에서 읽는다
    const p = commandParams(r, data, 231);
    const pic: StackPicture = { id, name, origin: 0, x: 0, y: 0, scaleX: 100, scaleY: 100, opacity: 255, blendMode: 0 };
    if (p && (p[0] === id || p[0] === undefined)) {
      pic.origin = p[2] === 1 ? 1 : 0;
      let px: number | null, py: number | null;
      if (p[3] === 1) { px = varValue(vars, r, p[4]); py = varValue(vars, r, p[5]); }
      else { px = num(p[4]); py = num(p[5]); }
      if (px !== null && py !== null) { pic.x = px; pic.y = py; }
      else { pic.origin = 1; pic.x = screen.width / 2; pic.y = screen.height / 2; pic.posUnknown = true; }
      pic.scaleX = num(p[6]) ?? 100;
      pic.scaleY = num(p[7]) ?? 100;
      // 투명도 0으로 띄우고 이동(232)으로 나타나게 하는 그림: 이동 기록이 없으니 다 보이게 둔다
      const o = num(p[8]);
      pic.opacity = o === null || o <= 0 ? 255 : clampOpacity(o);
      pic.blendMode = blendOf(p[9]);
    } else {
      // 명령을 못 찾음: 위치를 몰라 가운데에
      pic.origin = 1; pic.x = screen.width / 2; pic.y = screen.height / 2; pic.posUnknown = true;
    }
    return { op: "show", id, pic };
  } catch {
    return null;
  }
}

/** 그림 묶음(번호 → 그림)에 바꾸기를 적용한 새 묶음. 바뀐 게 없으면 같은 묶음. */
export function applyPictureOp(stack: ReadonlyMap<number, StackPicture>, op: PictureOp | null): ReadonlyMap<number, StackPicture> {
  if (!op) return stack;
  try {
    if (op.op === "show") {
      const next = new Map(stack);
      if (op.pic) next.set(op.id, op.pic); else next.delete(op.id);
      return next;
    }
    if (op.op === "erase") {
      if (!stack.has(op.id)) return stack;
      const next = new Map(stack);
      next.delete(op.id);
      return next;
    }
    const cur = stack.get(op.id);
    if (!cur) return stack;
    const moved: StackPicture = { ...cur, ...op.to };
    // 이동으로 위치를 알게 되면 더 이상 모르는 위치가 아니다
    if (op.to.x !== undefined && op.to.y !== undefined) delete moved.posUnknown;
    return new Map(stack).set(op.id, moved);
  } catch {
    return stack;
  }
}

/** 묶음의 그림들(번호 순) */
export function stackPictures(stack: ReadonlyMap<number, StackPicture>): StackPicture[] {
  return [...stack.values()].sort((a, b) => a.id - b.id);
}

/**
 * 다시 쌓은 그림 묶음 → 보이는 화면(sceneOf). 직접 고른 구분이 없는 작은 그림(눈·입처럼 2%보다 작아 화면 장식으로 볼 그림)도
 * 다른 그릴 그림과 겹치면 캐릭터의 한 부분으로 보고 함께 그린다.
 */
export function composedScene(pics: StackPicture[], ctx: PictureContext): ScreenScene {
  return sceneOf(pics, ctx);
}

/** 한 대사 사이에 그림 표시 기록이 이만큼 이상이면 그림을 겹쳐 그리는 게임으로 본다 */
export const LAYERED_RUN = 3;

/**
 * 그림을 겹쳐 캐릭터를 그리는 게임인가: 대사(message·choices·scroll) 사이에 이름 있는 그림 표시 기록이 LAYERED_RUN개 이상인 곳이 있다.
 */
export function hasLayeredPictures(path: LogRecord[]): boolean {
  let n = 0;
  try {
    for (const r of Array.isArray(path) ? path : []) {
      if (!r) continue;
      if (r.type === "message" || r.type === "choices" || r.type === "scroll" || r.type === "branchStart") { n = 0; continue; }
      if (r.type === "picture" && r.op === undefined && typeof r.name === "string" && r.name !== "") {
        if (++n >= LAYERED_RUN) return true;
      }
    }
  } catch { /* 모름 */ }
  return false;
}
