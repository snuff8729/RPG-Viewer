import { picturesStep, newPicturesState, sceneOfCached, type PicturesState, type PictureContext, type ScreenPicture, type ScreenScene } from "../addons/screenPictures";
import type { GameData } from "../types";
import { branchLimits, branchPath, inBranchPath, isValidRecord } from "./history";
import { extendsArray, newLineage, tagLineage } from "./lineage";
import { menuStep, newMenuState, withoutMenuRecords, type MenuCommonEvents, type MenuState } from "./menuScenes";
import { LAYERED_RUN, pictureVarIdsOf } from "./pictureStack";
import type { HistoryModel, LogRecord } from "./types";

/**
 * 읽기 화면이 기록이 붙을 때마다 다시 만드는 것(갈래 경로·메뉴 그림 빼기·대사별 그림·그림 위치 변수·겹친 그림·대사별 화면)을
 * 새로 붙은 기록만으로 이어 만든다. 입력 배열에 줄기 표시(core/live/lineage)가 있고 덧붙기만 했을 때만 이어 쓰고,
 * 아니면 처음부터 만든다. 결과는 언제나 일괄 함수(branchPath·withoutMenuRecords·picturesBySeq·pictureVarIds·
 * hasLayeredPictures·scenesBySeq)와 같다. 돌려준 배열·Map은 이후 바뀌지 않는다(바뀌면 새 객체). 예외를 던지지 않는다.
 */

const sameLimits = (a: ReadonlyMap<number, number>, b: ReadonlyMap<number, number>): boolean => {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
};

/** branchPath(records, model, branchId)를 이어 만든다. 결과 배열에는 줄기 표시가 붙는다. */
export class BranchPathCache {
  private src: readonly LogRecord[] | null = null;
  private run = 0;
  private limits: Map<number, number> | null = null;
  private maxSeq = -Infinity;
  private out: LogRecord[] = [];
  private lineage = 0;

  get(records: LogRecord[], model: HistoryModel, branchId: number): LogRecord[] {
    try {
      const lim = branchLimits(model, branchId);
      if (!lim || !Array.isArray(records)) return this.reset(null);
      if (this.src && this.limits && this.run === lim.run && sameLimits(this.limits, lim.limits) && extendsArray(this.src, records)) {
        const add: LogRecord[] = [];
        let maxSeq = this.maxSeq;
        let ordered = true;
        for (let i = this.src.length; i < records.length; i++) {
          const r = records[i];
          if (!isValidRecord(r)) continue;
          if (r.seq < maxSeq) { ordered = false; break; }
          maxSeq = r.seq;
          if (inBranchPath(r, lim.run, lim.limits)) add.push(r);
        }
        if (ordered) {
          this.src = records;
          this.maxSeq = maxSeq;
          if (add.length > 0) this.out = tagLineage(this.out.concat(add), this.lineage);
          return this.out;
        }
      }
      // 처음부터: seq 순서가 맞는 기록이면 다음부터 이어 쓴다
      let maxSeq = -Infinity, ordered = true;
      for (const r of records) {
        if (!isValidRecord(r)) continue;
        if (r.seq < maxSeq) { ordered = false; break; }
        maxSeq = r.seq;
      }
      this.lineage = newLineage();
      this.out = tagLineage(branchPath(records, model, branchId), this.lineage);
      this.src = ordered ? records : null;
      this.run = lim.run;
      this.limits = lim.limits;
      this.maxSeq = maxSeq;
      return this.out;
    } catch {
      return this.reset(branchPathSafe(records, model, branchId));
    }
  }

  private reset(out: LogRecord[] | null): LogRecord[] {
    this.src = null;
    this.limits = null;
    this.out = out ?? [];
    return this.out;
  }
}

function branchPathSafe(records: LogRecord[], model: HistoryModel, branchId: number): LogRecord[] {
  try { return branchPath(records, model, branchId); } catch { return []; }
}

/** withoutMenuRecords(path, keepMenu, menu)를 이어 만든다. 빼는 것이 없으면 path 그대로(같은 배열). */
export class MenuFilterCache {
  private src: readonly LogRecord[] | null = null;
  private keepMenu = false;
  private menu: MenuCommonEvents | null | undefined = undefined;
  private st: MenuState = newMenuState();
  private out: LogRecord[] = [];
  private lineage = 0;

  get(path: LogRecord[], keepMenu: boolean, menu?: MenuCommonEvents | null): LogRecord[] {
    try {
      if (!Array.isArray(path)) return [];
      if (keepMenu) { this.src = null; return path; }
      const resume = this.src !== null && this.keepMenu === keepMenu && this.menu === menu && extendsArray(this.src, path);
      if (!resume) {
        this.st = newMenuState();
        this.out = [];
        this.lineage = newLineage();
      }
      const from = resume && this.src ? this.src.length : 0;
      const add: LogRecord[] = [];
      for (let i = from; i < path.length; i++) menuStep(this.st, path[i], menu, add);
      if (add.length > 0 || !resume) this.out = tagLineage(resume ? this.out.concat(add) : add, this.lineage);
      this.src = path;
      this.keepMenu = keepMenu;
      this.menu = menu;
      return this.st.changed ? this.out : path;
    } catch {
      this.src = null;
      return withoutMenuRecords(path, keepMenu, menu);
    }
  }
}

/** 경로에서 읽기 화면이 쓰는 것들(이어 만든다) */
export interface PathFacts {
  /** picturesBySeq(path) — 대사 seq → 그림 묶음 */
  pictures: Map<number, ScreenPicture[]>;
  /** pictureVarIds(path, data) */
  varIds: number[];
  /** hasLayeredPictures(path) */
  layered: boolean;
  /** 이름 있는 그림 표시 기록(231)이 있다 */
  hasPictureRecords: boolean;
}

/** 경로 하나의 PathFacts를 이어 만든다. */
export class PathFactsCache {
  private src: readonly LogRecord[] | null = null;
  private data: GameData | null = null;
  private pics: PicturesState = newPicturesState();
  private ids = new Set<number>();
  private run = 0;
  private facts: PathFacts | null = null;

  get(path: LogRecord[], data: GameData): PathFacts {
    try {
      const resume = this.facts !== null && this.data === data && extendsArray(this.src, path);
      if (!resume) {
        this.pics = newPicturesState();
        this.ids = new Set();
        this.run = 0;
        this.facts = null;
      }
      const from = resume && this.src ? this.src.length : 0;
      let layered = this.facts?.layered ?? false;
      let hasPictureRecords = this.facts?.hasPictureRecords ?? false;
      // 새 기록의 대사별 그림만 따로 모았다가, 있으면 앞의 지도 사본에 덧붙인다(지도를 둘 들고 있지 않는다)
      const fresh = new Map<number, ScreenPicture[]>();
      let idsGrew = false;
      for (let i = from; i < path.length; i++) {
        const r = path[i];
        if (!r || typeof r !== "object") continue;
        picturesStep(this.pics, r, fresh);
        const t = r.type;
        if (t === "message" || t === "choices" || t === "scroll" || t === "branchStart") { this.run = 0; continue; }
        if (t === "picture" && r.op === undefined && !!r.name) hasPictureRecords = true;
        if (t === "picture" && r.op === undefined && typeof r.name === "string" && r.name !== "") {
          if (++this.run >= LAYERED_RUN) layered = true;
          const n = this.ids.size;
          pictureVarIdsOf(r, data, this.ids);
          if (this.ids.size !== n) idsGrew = true;
        }
      }
      const prev = this.facts;
      this.src = path;
      this.data = data;
      const picsGrew = fresh.size > 0;
      if (!prev || picsGrew || idsGrew || layered !== prev.layered || hasPictureRecords !== prev.hasPictureRecords) {
        this.facts = {
          pictures: !prev ? fresh : picsGrew ? mergeInto(prev.pictures, fresh) : prev.pictures,
          varIds: !prev || idsGrew ? [...this.ids].sort((a, b) => a - b) : prev.varIds,
          layered, hasPictureRecords,
        };
      }
      return this.facts!;
    } catch {
      this.src = null;
      this.facts = null;
      return { pictures: new Map(), varIds: [], layered: false, hasPictureRecords: false };
    }
  }
}

/** a의 사본에 b를 덧붙인다(같은 seq는 b의 값, 자리는 a의 자리 — 한 지도에 차례로 넣은 것과 같다) */
function mergeInto<K, V>(a: ReadonlyMap<K, V>, b: ReadonlyMap<K, V>): Map<K, V> {
  const out = new Map(a);
  for (const [k, v] of b) out.set(k, v);
  return out;
}

/**
 * scenesBySeq(pictures, ctx)를 같은 그림 묶음(같은 배열)마다 한 번만 계산한다(ctx가 같은 동안 부를 때를 넘어 기억한다).
 * PathFactsCache의 pictures는 이어 만드는 동안 앞의 묶음을 같은 배열로 두므로, 새 대사의 묶음만 새로 계산한다.
 */
export class ScenesCache {
  private ctx: PictureContext | null = null;
  private cache = new Map<ScreenPicture[], { known: unknown; scene: ScreenScene }[]>();
  private lastIn: Map<number, ScreenPicture[]> | null = null;
  private lastOut: Map<number, ScreenScene> | null = null;

  get(pictures: Map<number, ScreenPicture[]>, ctx: PictureContext): Map<number, ScreenScene> {
    if (ctx !== this.ctx) { this.ctx = ctx; this.cache = new Map(); this.lastIn = null; }
    if (pictures === this.lastIn && this.lastOut) return this.lastOut;
    const out = new Map<number, ScreenScene>();
    for (const [seq, pics] of pictures) {
      try { out.set(seq, sceneOfCached(pics, ctx, seq, this.cache)); } catch { /* 깨진 묶음은 건너뛴다 */ }
    }
    this.lastIn = pictures;
    this.lastOut = out;
    return out;
  }
}
