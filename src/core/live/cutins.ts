import {
  ctxAt, knownScreenAt, pictureRect, sceneOf, withScreen, type PictureContext, type ScreenPicture, type ScreenShot,
} from "../addons/screenPictures";
import { locationKey } from "../index/locations";
import type { EventCommand, GameData, Location } from "../types";
import { pageList } from "./mismatch";
import { stackPictures, type StackPicture } from "./pictureStack";
import type { LogRecord, RecordOf } from "./types";

/**
 * 컷인(대사 사이에 잠깐 띄웠다 지운 그림): 전투 기술·대화 중 커먼 이벤트가 그림 표시(231)·이동(232)·지우기(235)를 짧은 기다림과 함께
 * 여러 번 실행해 움직이는 그림을 보이고, 다음 대사 전에 지운다. 대사에 붙는 화면 그림에는 남지 않으니 따로 모은다.
 * - 대사(또는 전투 로그 줄·선택·장면 구분) 사이 한 구간의 그림 명령 기록을 따라가며, 그 구간에 띄운 뒤 구간 끝에 없는(지워진·
 *   다 투명해진) 그림 번호를 컷인으로 본다.
 * - 지우기 기록이 없는 예전 기록(1.15.0 전)은 게임 데이터의 같은 명령 목록에서 그 그림 표시 뒤(다음 대사 전)에 같은 번호의
 *   지우기(235)가 있으면 그 자리에서 지운 것으로 본다(eraseCmdAfter·withOldErases).
 * - 컷인 한 번 = 그림 명령마다의 화면 상태(같은 순간의 명령은 하나로, 컷인 그림과 그 위에 새로 띄운 것만)를 차례로 모은 장면들.
 * 모두 예외를 던지지 않는다.
 */

/** 같은 순간(한 프레임, 60fps면 약 16ms)으로 보는 기록 시각 차이(ms) */
export const CUTIN_FRAME_MS = 8;
/** 띄운 뒤 이보다 오래(ms) 있다가 지운 그림은 컷인이 아니다(지도 위 효과 등) */
export const CUTIN_MAX_MS = 15000;
/** 컷인 한 번의 장면 수 상한 */
export const CUTIN_MAX_FRAMES = 60;
/** 같은 장면으로 보는 위치 차이(px) */
const SAME_PX = 8;

/** 구간 안 그림 명령 기록 하나와 그 뒤의 그림 묶음 */
export interface CutinStep { rec: RecordOf<"picture">; stack: ReadonlyMap<number, StackPicture> }

/** 구간: 시작할 때의 그림 묶음, 그림 명령들, 끝의 그림 묶음(예전 기록의 추정 지우기까지 적용한 것)과 끝 시각 */
export interface CutinSegment {
  start: ReadonlyMap<number, StackPicture>;
  steps: CutinStep[];
  end: ReadonlyMap<number, StackPicture>;
  endT: number;
}

/** 컷인 한 번: 첫·끝 기록 seq, 장면들(모두 같은 kind — 이벤트 그림이 있으면 cg로 화면 그대로), 가장 완전한 장면 번호 */
export interface CutinRun { first: number; last: number; frames: ScreenShot[]; best: number }

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const tOf = (r: LogRecord | null | undefined): number => (r && typeof r.t === "number" && Number.isFinite(r.t) ? r.t : 0);

/** 예전 기록의 그림을 지운 자리: key = 명령 목록(locationKey), cmd = 지우기 명령 번호, callee = 그림을 띄운 커먼 이벤트 목록(부른 쪽이 지웠을 때) */
export interface EraseAt { key: string; cmd: number; callee: string | null }

/**
 * 명령 목록 list의 from부터 end 앞까지 그림 id를 지우는(235, 또는 투명도 0으로 이동 232) 명령 번호. level = 그 자리의 깊이.
 * level보다 깊은(새로 연 조건 안의) 명령은 실행됐는지 모르므로 보지 않고, 실행한 갈래가 끝나면 같은 조건의 다른 갈래는 건너뛴다.
 * 이벤트 중단(115)·라벨 이동(119)을 만나면 흐름을 모르니 null.
 */
function scanErase(list: EventCommand[], from: number, end: number, level: number, id: number): number | null {
  const indentOf = (i: number) => (typeof list[i]?.indent === "number" ? list[i].indent : 0);
  for (let i = from; i < end; i++) {
    const c = list[i];
    if (!c) continue;
    if (c.code === 115 || c.code === 119) return null;
    const ind = indentOf(i);
    if (ind < level) {
      level = ind;
      if (ALT_BRANCH.has(c.code)) {
        while (i + 1 < end && !(indentOf(i + 1) === ind && BRANCH_END.has(list[i + 1]?.code ?? -1))) i++;
        continue;
      }
    }
    if (ind > level || !Array.isArray(c.parameters) || c.parameters[0] !== id) continue;
    if (c.code === 235 || (c.code === 232 && c.parameters[8] === 0)) return i;
  }
  return null;
}

/**
 * 예전 기록(그림 표시 기록에 위치가 없고 지우기 기록이 없다)의 그림 표시를 다음 대사 전에 지운 자리. 게임 데이터에서 찾는다:
 * 1) 같은 명령 목록의 그 명령 뒤부터 다음 경계 기록(같은 목록이면 그 명령, 아니면 목록 끝)까지(scanErase).
 * 2) 없고 그림을 띄운 것이 커먼 이벤트이고 경계 기록이 다른 목록이면, 경계 기록 목록에서 그 앞의 마지막 그 커먼 이벤트 부르기(117)
 *    뒤부터 경계 기록까지(부른 쪽이 컷인을 띄우는 커먼 이벤트를 부른 뒤 지운다).
 * 그 사이의 대사 명령(101)은 실행되지 않은 것이다(실행됐다면 경계 기록이 그것이었다). 없거나 1.15.0+ 기록이면 null.
 */
export function eraseCmdAfter(r: RecordOf<"picture">, boundary: LogRecord | null, data: GameData): EraseAt | null {
  try {
    if (!r || r.type !== "picture" || r.op !== undefined || num(r.x) !== null || !r.src || typeof r.cmd !== "number") return null;
    const id = r.pictureId;
    const list = pageList(data, r.src);
    if (!list) return null;
    const key = locationKey(r.src);
    const b = boundary as { src?: Location | null; cmd?: unknown } | null;
    const bKey = b && b.src && typeof b.cmd === "number" ? locationKey(b.src) : null;
    const bCmd = typeof b?.cmd === "number" ? b.cmd : -1;
    const end = bKey === key && bCmd > r.cmd ? Math.min(bCmd, list.length) : list.length;
    const level = typeof list[r.cmd]?.indent === "number" ? list[r.cmd].indent : 0;
    const at = scanErase(list, r.cmd + 1, end, level, id);
    if (at !== null) return { key, cmd: at, callee: null };
    if (r.src.source !== "common" || !bKey || bKey === key || !b?.src) return null;
    const blist = pageList(data, b.src);
    if (!blist) return null;
    const ceId = r.src.commonEventId;
    for (let k = Math.min(bCmd, blist.length) - 1; k >= 0; k--) {
      const c = blist[k];
      if (c?.code !== 117 || !Array.isArray(c.parameters) || c.parameters[0] !== ceId) continue;
      const lv = typeof c.indent === "number" ? c.indent : 0;
      const found = scanErase(blist, k + 1, Math.min(bCmd, blist.length), lv, id);
      return found === null ? null : { key: bKey, cmd: found, callee: key };
    }
  } catch { /* 모름 */ }
  return null;
}

const without = (m: ReadonlyMap<number, StackPicture>, id: number): ReadonlyMap<number, StackPicture> => {
  const n = new Map(m);
  n.delete(id);
  return n;
};

/**
 * 예전 기록의 구간에 다음 대사 전에 지운 그림(eraseCmdAfter)의 지우기를 넣는다: 번호별 마지막 그림 표시가 구간 끝에도 그대로
 * 남아 있으면, 지우기 명령 자리를 지난 첫 기록(지운 목록의 그 뒤 명령이나 다른 목록의 기록)부터 지운다.
 * 바뀐 것이 없으면 같은 steps·end.
 */
export function withOldErases(
  steps: CutinStep[], end: ReadonlyMap<number, StackPicture>, boundary: LogRecord | null, data: GameData,
): { steps: CutinStep[]; end: ReadonlyMap<number, StackPicture> } {
  let out = steps, last = end;
  try {
    const lastShow = new Map<number, number>();
    steps.forEach((s, i) => {
      const r = s.rec;
      if (r.op === undefined && typeof r.name === "string" && r.name !== "") lastShow.set(r.pictureId, i);
      else if (r.op === "erase" || (r.op === undefined && !r.name)) lastShow.delete(r.pictureId);
    });
    for (const [id, i] of lastShow) {
      const s = steps[i];
      const pic = s.stack.get(id);
      if (!pic || last.get(id) !== pic || !s.rec.src) continue;
      const at = eraseCmdAfter(s.rec, boundary, data);
      if (at === null) continue;
      if (out === steps) out = [...steps];
      // 지우기 전의 기록: 지운 목록의 그 앞 명령, 또는 부른 커먼 이벤트 안의 명령
      let from = out.length;
      for (let j = i + 1; j < out.length; j++) {
        const r = out[j].rec;
        const k = r.src ? locationKey(r.src) : "";
        if ((k === at.key && typeof r.cmd === "number" && r.cmd < at.cmd) || (at.callee !== null && k === at.callee)) continue;
        from = j;
        break;
      }
      for (let j = from; j < out.length; j++) {
        if (out[j].stack.get(id) === pic) out[j] = { rec: out[j].rec, stack: without(out[j].stack, id) };
      }
      last = without(last, id);
    }
  } catch { /* 그대로 */ }
  return { steps: out, end: last };
}

/** 조건·선택지·전투 결과의 다른 갈래 시작(그 밖 411, 선택지 402·403, 전투 결과 601·602·603)과 끝(412·404·604) */
const ALT_BRANCH = new Set([411, 402, 403, 601, 602, 603]);
const BRANCH_END = new Set([412, 404, 604]);

interface Frame { first: number; seq: number; shot: ScreenShot; n: number; area: number; sig: string; opacity: number }

const sigOf = (pics: ScreenPicture[]) => pics.map(p => `${p.id}|${p.name}`).join("\n");

function samePlace(a: ScreenPicture[], b: ScreenPicture[]): boolean {
  return a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i].x) <= SAME_PX && Math.abs(p.y - b[i].y) <= SAME_PX);
}

/** 그림들이 화면에서 차지하는 넓이 합(화면 안으로 자른 것, 크기를 모르면 0) */
function areaOf(pics: ScreenPicture[], ctx: PictureContext): number {
  let a = 0;
  for (const p of pics) {
    try {
      const r = pictureRect(p, ctx.sizeOf);
      if (!r) continue;
      const w = Math.min(ctx.screen.width, r.right) - Math.max(0, r.left);
      const h = Math.min(ctx.screen.height, r.bottom) - Math.max(0, r.top);
      if (w > 0 && h > 0) a += w * h;
    } catch { /* 0 */ }
  }
  return a;
}

/** 장면 수가 많으면 고르게 줄인다(첫·끝 장면은 남긴다) */
function sample<T>(list: T[], max: number): T[] {
  if (list.length <= max) return list;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(list[Math.round((i * (list.length - 1)) / (max - 1))]);
  return out;
}

/**
 * 구간의 컷인들. 컷인 그림 = 구간 안에서 띄웠고(그 번호에 구간 시작 때와 다른 그림), 구간 끝에 없거나 다 투명한 번호
 * (띄운 뒤 CUTIN_MAX_MS 안에 지운 것 — 그 위에 덧그린 효과도 함께 지우니 이것에 든다). 장면 = 같은 순간의 명령들 뒤의
 * 그림 묶음에서 컷인 그림 중 보이는 것(sceneOf — 숨김·화면 장식 제외)만. 구간 끝에도 남는 그림(다음 대사의 스탠딩)은 넣지 않는다. 이어서 같은 그림(이름·대략 위치)인 장면은 하나로(더 진한 것),
 * 컷인 그림이 하나도 없는 순간에서 나눈다.
 */
export function cutinRuns(seg: CutinSegment, ctx: PictureContext): CutinRun[] {
  try {
    const { start, steps, end } = seg;
    if (!Array.isArray(steps) || steps.length === 0) return [];
    const firstT = new Map<number, number>(), names = new Map<number, Set<string>>(), eraseT = new Map<number, number>();
    for (const s of steps) {
      const r = s.rec, id = r.pictureId;
      if (r.op === "erase") { eraseT.set(id, tOf(r)); continue; }
      if (r.op !== undefined || typeof r.name !== "string" || r.name === "") continue;
      if (!firstT.has(id)) firstT.set(id, tOf(r));
      const set = names.get(id) ?? new Set<string>();
      set.add(r.name);
      names.set(id, set);
    }
    const transient = new Set<number>();
    for (const [id, ns] of names) {
      const left = end.get(id);
      if (left && left.opacity > 0) continue;
      // 원래 있던 그림을 다시 띄웠다 지운 것(스탠딩 퇴장)은 컷인이 아니다
      const before = start.get(id);
      if (before && ns.size === 1 && ns.has(before.name)) continue;
      const t0 = firstT.get(id) ?? 0, t1 = eraseT.get(id) ?? seg.endT;
      if (t0 > 0 && t1 > 0 && t1 - t0 > CUTIN_MAX_MS) continue;
      transient.add(id);
    }
    if (transient.size === 0) return [];

    const runs: Frame[][] = [];
    let cur: Frame[] = [];
    const cut = () => { if (cur.length > 0) runs.push(cur); cur = []; };
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i], t = tOf(s.rec), next = steps[i + 1];
      // 같은 순간의 명령들은 마지막 것 뒤의 모습 하나로
      if (next && t > 0 && tOf(next.rec) > 0 && tOf(next.rec) - t <= CUTIN_FRAME_MS) continue;
      const all = stackPictures(s.stack);
      const pics = all.filter(p => transient.has(p.id) && start.get(p.id) !== p && p.opacity > 0);
      if (pics.length === 0) { cut(); continue; }
      // 1.18.2: 그때 게임의 실제 화면 크기로 나눈다
      const sctx = ctxAt(ctx, s.rec.seq);
      const scene = sceneOf(pics, sctx);
      const drawn = [...scene.cg, ...scene.stand].sort((a, b) => a.id - b.id);
      if (drawn.length === 0) { cut(); continue; }
      const shot: ScreenShot = withScreen<ScreenShot>(
        scene.cg.length > 0 ? { kind: "cg", pictures: drawn, cg: [...scene.cg] } : { kind: "stand", pictures: drawn },
        knownScreenAt(ctx, s.rec.seq),
      );
      const f: Frame = {
        first: s.rec.seq, seq: s.rec.seq, shot, n: drawn.length, area: areaOf(drawn, sctx), sig: sigOf(drawn),
        opacity: drawn.reduce((a, p) => a + p.opacity, 0),
      };
      const last = cur[cur.length - 1];
      if (last && last.sig === f.sig && samePlace(last.shot.pictures, drawn)) {
        // 같은 그림이 조금 움직이거나 나타나는 중: 더 진한(같으면 나중) 모습 하나로
        const keep = f.opacity >= last.opacity ? f : last;
        cur[cur.length - 1] = { ...keep, first: last.first, seq: f.seq };
        continue;
      }
      cur.push(f);
    }
    cut();

    const out: CutinRun[] = [];
    for (const run of runs) {
      const frames = sample(run, CUTIN_MAX_FRAMES);
      const cg = frames.some(f => f.shot.kind === "cg");
      const shots: ScreenShot[] = frames.map(f => withScreen<ScreenShot>(cg
        ? { kind: "cg", pictures: f.shot.pictures, cg: f.shot.cg ?? [] }
        : { kind: "stand", pictures: f.shot.pictures }, f.shot.screen));
      let best = 0;
      frames.forEach((f, i) => {
        const b = frames[best];
        if (f.n > b.n || (f.n === b.n && f.area > b.area)) best = i;
      });
      out.push({ first: run[0].first, last: run[run.length - 1].seq, frames: shots, best });
    }
    return out;
  } catch {
    return [];
  }
}
