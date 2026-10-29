import { lastSeqOf, type ReaderItem } from "./reader";
import { firstSeqOf } from "./readerNav";
import { countByRule } from "./hideRules";

/**
 * 읽기 화면에 실제로 보일 항목: 읽기 항목(ReaderItemsBuilder)에 큰 단위 제목 줄(목차의 묶음 경계)을 넣고,
 * 빼는 항목(drop)을 빼고, 숨김 규칙에 맞는 줄(match)은 이어진 것끼리 `숨긴 문구 N줄` 한 항목(hidden)으로 묶는다
 * (silent 규칙으로 숨긴 줄은 자리 없이 뺀다).
 * 예외를 던지지 않는다.
 *
 * ReaderDisplayCache는 앞에서 받은 항목 배열과 앞부분이 같은 객체이면(읽기 항목은 이어 만들 때 앞 항목을 그대로 둔다)
 * 처음 달라진 곳(그 앞의 숨긴 줄 묶음 처음)부터만 다시 본다. 설정(cfg 객체)이 바뀌면 처음부터. 결과는 displayItems와 같다.
 */

export interface DisplayHead {
  /** 이 seq부터 시작하는 항목 앞에 넣는다 */
  seq: number;
  item: ReaderItem;
}

export interface DisplayConfig {
  /** seq 순 큰 단위 경계 */
  heads: readonly DisplayHead[];
  /** 빼는 항목(그림 보기를 끈 화면 그림 등) — 숨긴 줄 묶음을 끊지 않는다 */
  drop?: ((item: ReaderItem) => boolean) | null;
  /** 숨길 줄이면 그 규칙 번호(0 이상), 아니면 -1 */
  match?: ((item: ReaderItem) => number) | null;
  /** 그 규칙으로 숨긴 줄은 자리도 남기지 않는다(종류 숨기기 — 묶음을 끊지도 않는다). 없으면 모두 자리를 남긴다. */
  silent?: ((rule: number) => boolean) | null;
}

/** 항목마다: 보임 */
const SHOWN = -1;
/** 항목마다: 뺌 */
const DROPPED = -2;

interface Pass {
  out: ReaderItem[];
  hi: number;
  /** 지금 이어지는 숨긴 줄 묶음(out 안 자리와 줄들) */
  group: { at: number; items: ReaderItem[] } | null;
  ruleOf: number[];
}

function hiddenItem(items: ReaderItem[]): ReaderItem {
  let seq = 0;
  for (const it of items) {
    const s = lastSeqOf(it);
    if (s !== null && s > seq) seq = s;
  }
  return { kind: "hidden", key: `h${items[0].key}`, seq, items };
}

function closeGroup(p: Pass): void {
  if (!p.group) return;
  p.out[p.group.at] = hiddenItem(p.group.items);
  p.group = null;
}

/** 항목 하나를 넣고 그 항목의 표시(숨긴 규칙 번호, -1 보임, -2 뺌)를 돌려준다 */
function stepItem(cfg: DisplayConfig, p: Pass, it: ReaderItem): number {
  const fs = firstSeqOf(it);
  if (fs !== null) {
    let h: DisplayHead | null = null;
    while (p.hi < cfg.heads.length && cfg.heads[p.hi].seq <= fs) h = cfg.heads[p.hi++];
    if (h) { closeGroup(p); p.out.push(h.item); }
  }
  if (cfg.drop?.(it)) return DROPPED;
  const r = cfg.match ? cfg.match(it) : SHOWN;
  if (r >= 0 && cfg.silent?.(r)) return r;
  if (r < 0) {
    closeGroup(p);
    p.out.push(it);
    return SHOWN;
  }
  if (p.group) p.group.items.push(it);
  else {
    p.group = { at: p.out.length, items: [it] };
    p.out.push(it); // 자리만(묶음을 닫을 때 hidden 항목으로 바꾼다)
  }
  return r;
}

const safeStep = (cfg: DisplayConfig, p: Pass, it: ReaderItem): number => {
  try { return stepItem(cfg, p, it); } catch { return SHOWN; }
};

/** 한 번에 만든다 */
export function displayItems(items: readonly ReaderItem[], cfg: DisplayConfig): ReaderItem[] {
  const p: Pass = { out: [], hi: 0, group: null, ruleOf: [] };
  try {
    for (const it of Array.isArray(items) ? items : []) {
      p.ruleOf.push(safeStep(cfg, p, it));
    }
    closeGroup(p);
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
  /** 입력 항목마다 숨긴 규칙 번호(-1 보임, -2 뺌) */
  private ruleOf: number[] = [];

  get(items: readonly ReaderItem[], cfg: DisplayConfig): ReaderItem[] {
    try {
      if (!Array.isArray(items)) return [];
      let d = 0;
      if (this.prevIn && this.cfg === cfg) {
        const prev = this.prevIn;
        const n = Math.min(prev.length, items.length);
        while (d < n && prev[d] === items[d]) d++;
        if (d === prev.length && d === items.length) { this.prevIn = items; return this.out; }
        // 숨긴 줄 묶음 가운데서 달라졌으면 그 묶음 처음부터(뺀 항목은 묶음을 끊지 않는다)
        while (d > 0 && this.ruleOf[d - 1] !== SHOWN) d--;
      }
      const p: Pass = {
        out: d > 0 ? this.out.slice(0, this.outAt[d]) : [], hi: d > 0 ? this.headAt[d] : 0, group: null,
        ruleOf: this.ruleOf,
      };
      this.ruleOf.length = d;
      this.outAt.length = d;
      this.headAt.length = d;
      for (let i = d; i < items.length; i++) {
        this.outAt.push(p.out.length);
        this.headAt.push(p.hi);
        p.ruleOf.push(safeStep(cfg, p, items[i]));
      }
      // 마지막 자리(입력 길이)도 적어 둔다 — 다음에 끝에 덧붙기만 했을 때 이어 쓴다
      this.outAt.push(p.out.length);
      this.headAt.push(p.hi);
      closeGroup(p);
      this.prevIn = items;
      this.cfg = cfg;
      this.out = p.out;
      this.ruleOf = p.ruleOf;
      return p.out;
    } catch {
      this.prevIn = null;
      this.cfg = null;
      this.outAt = [];
      this.headAt = [];
      this.ruleOf = [];
      this.out = displayItems(items, cfg);
      return this.out;
    }
  }

  /** 마지막으로 만든 결과에서 규칙마다 숨긴 줄 수 */
  hiddenCounts(rules: number): number[] {
    return countByRule(this.ruleOf, rules);
  }
}
