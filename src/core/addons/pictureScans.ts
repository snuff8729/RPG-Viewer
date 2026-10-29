import { extendsArray } from "../live/lineage";
import type { LogRecord } from "../live/types";
import {
  hudKeyOf, newPicturesState, picturesStep, screenSizeMarkOf, snapshotCounts, screenSizeMarks,
  type HudTally, type PicturesState, type ScreenPicture, type ScreenSizeMark,
} from "./screenPictures";

/**
 * 게임 기록 전체에서 그림 구분 문맥(usePictureContext)이 쓰는 것을 새로 붙은 기록만으로 이어 모은다.
 * 입력 배열에 줄기 표시(core/live/lineage)가 있고 덧붙기만 했을 때만 이어 쓰고, 아니면 처음부터. 결과는 일괄 함수와 같다.
 * 돌려준 값은 이후 바뀌지 않는다(바뀌면 새 객체). 예외를 던지지 않는다.
 */

/** screenSizeMarks(records)를 이어 모은다. 새 표시가 없으면 같은 배열. */
export class ScreenSizeMarksScan {
  private src: readonly LogRecord[] | null = null;
  private out: ScreenSizeMark[] = [];

  get(records: LogRecord[]): ScreenSizeMark[] {
    try {
      if (!Array.isArray(records)) return [];
      if (!extendsArray(this.src, records)) {
        this.out = screenSizeMarks(records);
        this.src = records;
        return this.out;
      }
      const add: ScreenSizeMark[] = [];
      for (let i = this.src!.length; i < records.length; i++) {
        const m = screenSizeMarkOf(records[i]);
        if (m) add.push(m);
      }
      this.src = records;
      if (add.length === 0) return this.out;
      const next = this.out.concat(add);
      // 일괄 함수와 같게: 기록 순서대로 모아 seq로 (안정) 정렬
      for (let i = this.out.length; i < next.length; i++) {
        if (i > 0 && next[i].seq < next[i - 1].seq) { next.sort((a, b) => a.seq - b.seq); break; }
      }
      this.out = next;
      return next;
    } catch {
      this.src = null;
      return screenSizeMarks(records);
    }
  }
}

/** 기록의 그림 표시(231) 이름들 — 그림 명령으로 다시 쌓는 화면이 읽을 그림 */
export function commandPictureNames(records: LogRecord[]): Set<string> {
  const names = new Set<string>();
  for (const r of Array.isArray(records) ? records : []) addCommandName(r, names);
  return names;
}
function addCommandName(r: LogRecord, names: Set<string>): void {
  if (r?.type === "picture" && r.op === undefined && typeof r.name === "string" && r.name) names.add(r.name);
}

/** commandPictureNames(records)를 이어 모은다. 새 이름이 없으면 같은 집합. */
export class CommandNamesScan {
  private src: readonly LogRecord[] | null = null;
  private names = new Set<string>();
  private out: Set<string> = new Set();

  get(records: LogRecord[]): Set<string> {
    try {
      if (!extendsArray(this.src, records)) {
        this.names = commandPictureNames(records);
        this.out = new Set(this.names);
        this.src = records;
        return this.out;
      }
      const n = this.names.size;
      for (let i = this.src!.length; i < records.length; i++) addCommandName(records[i], this.names);
      this.src = records;
      if (this.names.size !== n) this.out = new Set(this.names);
      return this.out;
    } catch {
      this.src = null;
      return commandPictureNames(records);
    }
  }
}

/** snapshotCounts에서 화면 장식 판정·그림 이름에 쓰는 것 */
export interface SnapshotFacts {
  /** 대사 묶음 수 합(hudKeys의 total) */
  total: number;
  /** 화면 장식 열쇠별 수(hudKeysOfTally) */
  tally: HudTally;
  /** 묶음에 든 그림 이름들(이름순) */
  names: string[];
}

/**
 * snapshotCounts(records)를 갈래별로 이어 모아 hudKeys에 쓰는 수(tally)와 그림 이름을 만든다.
 * tally의 그림(p)은 일괄 계산과 같게 갈래가 처음 나온 순서가 앞인 것을 둔다. 같은 갈래에 같은 seq가 또 나오면(드묾) 처음부터.
 */
export class SnapshotScan {
  private src: readonly LogRecord[] | null = null;
  private branches = new Map<unknown, { idx: number; st: PicturesState; maxSeq: number }>();
  /** picturesStep이 쓰는 빈 지도(기록 하나마다 비운다 — 갈래별 지도를 들고 있지 않는다) */
  private scratch = new Map<number, ScreenPicture[]>();
  private tally = new Map<string, { n: number; p: ScreenPicture; b: number }>();
  private total = 0;
  private names = new Set<string>();
  private facts: SnapshotFacts | null = null;

  get(records: LogRecord[]): SnapshotFacts {
    try {
      if (!this.facts || !extendsArray(this.src, records)) return this.rebuild(records);
      const before = this.total, nNames = this.names.size;
      for (let i = this.src!.length; i < records.length; i++) {
        if (!this.feed(records[i])) return this.rebuild(records, true);
      }
      this.src = records;
      if (this.total !== before || this.names.size !== nNames) this.facts = this.snapshot();
      return this.facts;
    } catch {
      this.src = null;
      this.facts = null;
      return factsOf(snapshotCounts(records));
    }
  }

  private rebuild(records: LogRecord[], batch = false): SnapshotFacts {
    this.branches = new Map();
    this.tally = new Map();
    this.total = 0;
    this.names = new Set();
    if (batch) {
      // 같은 seq가 또 나온 기록: 일괄 계산 결과를 그대로 쓰고 이어 쓰지 않는다
      this.src = null;
      this.facts = null;
      return factsOf(snapshotCounts(records));
    }
    for (const r of Array.isArray(records) ? records : []) {
      if (!this.feed(r)) return this.rebuild(records, true);
    }
    this.src = records;
    this.facts = this.snapshot();
    return this.facts;
  }

  /** 기록 하나. 같은 갈래에 같은 seq의 묶음이 또 생기면 false. */
  private feed(r: LogRecord): boolean {
    if (!r || typeof r !== "object") return true;
    let b = this.branches.get(r.branch);
    if (!b) { b = { idx: this.branches.size, st: newPicturesState(), maxSeq: -Infinity }; this.branches.set(r.branch, b); }
    if (touches(r)) {
      // 갈래 안에서 seq가 늘지 않으면(같은 seq가 또 나왔을 수 있다) 일괄 계산으로
      if (!(typeof r.seq === "number" && r.seq > b.maxSeq)) return false;
      b.maxSeq = r.seq;
    }
    this.scratch.clear();
    picturesStep(b.st, r, this.scratch);
    const pics = this.scratch.get(r.seq);
    this.scratch.clear();
    if (!pics) return true;
    this.total++;
    for (const p of pics) {
      const k = hudKeyOf(p);
      const e = this.tally.get(k);
      if (!e) this.tally.set(k, { n: 1, p, b: b.idx });
      else { e.n++; if (b.idx < e.b) { e.p = p; e.b = b.idx; } }
      this.names.add(p.name);
    }
    return true;
  }

  private snapshot(): SnapshotFacts {
    const tally: HudTally = new Map();
    for (const [k, { n, p }] of this.tally) tally.set(k, { n, p });
    return { total: this.total, tally, names: [...this.names].sort() };
  }
}

/** 이 기록이 picturesBySeq 지도에 seq를 넣을 수 있는 종류인가 */
const touches = (r: LogRecord): boolean =>
  r.type === "message" || r.type === "battle" || r.type === "battlelog" || r.type === "screen";

/** 일괄 snapshotCounts → SnapshotFacts */
export function factsOf(counts: Map<ScreenPicture[], number>): SnapshotFacts {
  const tally: HudTally = new Map();
  const names = new Set<string>();
  let total = 0;
  for (const [pics, n] of counts) {
    total += n;
    for (const p of pics) {
      const k = hudKeyOf(p);
      const e = tally.get(k);
      if (e) e.n += n; else tally.set(k, { n, p });
      names.add(p.name);
    }
  }
  return { total, tally, names: [...names].sort() };
}
