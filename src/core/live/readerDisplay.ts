import type { ReaderItem } from "./reader";
import { firstSeqOf } from "./readerNav";

/**
 * 읽기 화면에 실제로 보일 항목: 읽기 항목(ReaderItemsBuilder)에 큰 단위 제목 줄(목차의 묶음 경계)을 넣고,
 * 빼는 항목(drop)을 뺀다. 예외를 던지지 않는다.
 *
 * ReaderDisplayCache는 앞에서 받은 항목 배열과 앞부분이 같은 객체이면(읽기 항목은 이어 만들 때 앞 항목을 그대로 둔다)
 * 처음 달라진 곳부터만 다시 본다. 설정(cfg 객체)이 바뀌면 처음부터. 결과는 displayItems와 같다.
 */

export interface DisplayHead {
  /** 이 seq부터 시작하는 항목 앞에 넣는다 */
  seq: number;
  item: ReaderItem;
}

export interface DisplayConfig {
  /** seq 순 큰 단위 경계 */
  heads: readonly DisplayHead[];
  /** 빼는 항목(그림 보기를 끈 화면 그림 등) */
  drop?: ((item: ReaderItem) => boolean) | null;
}

interface Pass {
  out: ReaderItem[];
  hi: number;
}

function stepItem(cfg: DisplayConfig, p: Pass, it: ReaderItem): void {
  const fs = firstSeqOf(it);
  if (fs !== null) {
    let h: DisplayHead | null = null;
    while (p.hi < cfg.heads.length && cfg.heads[p.hi].seq <= fs) h = cfg.heads[p.hi++];
    if (h) p.out.push(h.item);
  }
  if (cfg.drop?.(it)) return;
  p.out.push(it);
}

/** 한 번에 만든다 */
export function displayItems(items: readonly ReaderItem[], cfg: DisplayConfig): ReaderItem[] {
  const p: Pass = { out: [], hi: 0 };
  try {
    for (const it of Array.isArray(items) ? items : []) {
      try { stepItem(cfg, p, it); } catch { /* 깨진 항목은 건너뛴다 */ }
    }
  } catch { /* 만든 것까지 */ }
  return p.out;
}

/** displayItems를 이어 계산한다 */
export class ReaderDisplayCache {
  private prevIn: readonly ReaderItem[] | null = null;
  private cfg: DisplayConfig | null = null;
  private out: ReaderItem[] = [];
  /** 입력 i를 보기 전의 결과 길이·다음 경계 번호 */
  private outAt: number[] = [];
  private headAt: number[] = [];

  get(items: readonly ReaderItem[], cfg: DisplayConfig): ReaderItem[] {
    try {
      if (!Array.isArray(items)) return [];
      let d = 0;
      if (this.prevIn && this.cfg === cfg) {
        const prev = this.prevIn;
        const n = Math.min(prev.length, items.length);
        while (d < n && prev[d] === items[d]) d++;
        if (d === prev.length && d === items.length) { this.prevIn = items; return this.out; }
      }
      const p: Pass = { out: d > 0 ? this.out.slice(0, this.outAt[d]) : [], hi: d > 0 ? this.headAt[d] : 0 };
      this.outAt.length = d;
      this.headAt.length = d;
      for (let i = d; i < items.length; i++) {
        this.outAt.push(p.out.length);
        this.headAt.push(p.hi);
        try { stepItem(cfg, p, items[i]); } catch { /* 깨진 항목은 건너뛴다 */ }
      }
      // 마지막 자리(입력 길이)도 적어 둔다 — 다음에 끝에 덧붙기만 했을 때 이어 쓴다
      this.outAt.push(p.out.length);
      this.headAt.push(p.hi);
      this.prevIn = items;
      this.cfg = cfg;
      this.out = p.out;
      return p.out;
    } catch {
      this.prevIn = null;
      this.cfg = null;
      this.outAt = [];
      this.headAt = [];
      this.out = displayItems(items, cfg);
      return this.out;
    }
  }
}
