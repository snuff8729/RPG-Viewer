import { lastSeqOf, type ReaderItem } from "@/core/live/reader";

export interface ReadStats {
  /** 읽은 마지막 항목(seq 있는 항목) 위치, 없으면 -1 */
  lastReadIdx: number;
  /** 첫 안 읽은 항목(seq 있는 항목) 위치, 없으면 -1 */
  firstUnreadIdx: number;
  /** 안 읽은 대사(message·scroll) 수. 다시 본 대화(↻)는 세지 않는다. */
  unread: number;
}

export function readStats(items: ReaderItem[], readSeq: number): ReadStats {
  let lastReadIdx = -1, firstUnreadIdx = -1, unread = 0;
  items.forEach((it, i) => {
    const s = lastSeqOf(it);
    if (s === null) return;
    if (s <= readSeq) { lastReadIdx = i; return; }
    if (firstUnreadIdx === -1) firstUnreadIdx = i;
    if (it.kind === "scroll" || (it.kind === "message" && it.repeat === undefined)) unread++;
  });
  return { lastReadIdx, firstUnreadIdx, unread };
}

/** 그리는 항목 구간 [start, end) — 항목 위치 기준. */
export interface ReadRange {
  start: number;
  end: number;
}

/** 첫 안 읽은 항목 앞에 함께 그려 둘 이미 읽은 항목 수 */
export const CONTEXT = 5;

export interface InitialView {
  range: ReadRange;
  /** 처음 스크롤 위치: 맨 아래 / 첫 안 읽은 항목 / 구간의 맨 위 */
  at: "bottom" | "item" | "top";
  /** 처음 위치에서 바로 읽음 표시를 할지(아니면 사용자가 스크롤하거나 다음을 누를 때부터) */
  armed: boolean;
}

export function sameRange(a: ReadRange, b: ReadRange): boolean {
  return a.start === b.start && a.end === b.end;
}

/** 끝에서 page개(따라가기·맨 아래로) */
export function tailRange(total: number, page: number): ReadRange {
  return { start: Math.max(0, total - page), end: total };
}

/**
 * 갈래를 처음 볼 때의 구간.
 * - 다 읽었으면 끝 page개, 맨 아래에서 시작.
 * - 읽던 곳이 있으면 [첫 안 읽은 항목-CONTEXT, 첫 안 읽은 항목+page).
 * - 읽은 위치가 없으면 처음부터 page개.
 * 다 읽은 경우가 아니면 첫 화면은 사용자가 움직이기 전까지 읽음 표시하지 않는다.
 */
export function initialView(total: number, stats: ReadStats, readSeq: number, page: number): InitialView {
  if (stats.firstUnreadIdx === -1) return { range: tailRange(total, page), at: "bottom", armed: true };
  if (readSeq >= 0) {
    const fu = stats.firstUnreadIdx;
    return { range: { start: Math.max(0, fu - CONTEXT), end: Math.min(total, fu + page) }, at: "item", armed: false };
  }
  return { range: { start: 0, end: Math.min(total, page) }, at: "top", armed: false };
}

/** 구간을 total 안으로 줄인다. 비면 끝 page개. */
export function clampRange(r: ReadRange, total: number, page: number): ReadRange {
  const end = Math.min(r.end, total);
  const start = Math.min(r.start, end);
  if (end <= start && total > 0) return tailRange(total, page);
  return start === r.start && end === r.end ? r : { start, end };
}

/**
 * 항목 수가 prev → total로 바뀌었을 때의 구간. 구간이 끝에 붙어 있었으면 새 항목도 그리되,
 * 구간 길이가 2×page를 넘지 않게 한다(넘는 부분은 `다음 대사 더 보기`로). 끝에 붙어 있지 않으면 그대로.
 * 몰아 들어와도 첫 새 항목(prev)은 늘 그려진다(끝에 붙은 구간의 길이 ≤ 2×page이고 따라가기 구간은 ≤ page라서).
 */
export function grownRange(r: ReadRange, prev: number, total: number, page: number): ReadRange {
  if (total <= prev || r.end !== prev) return clampRange(r, total, page);
  const end = Math.min(total, Math.max(r.end, r.start + 2 * page));
  return end === r.end ? r : { start: r.start, end };
}

/** 이전 대사 더 보기 */
export function extendUp(r: ReadRange, page: number): ReadRange {
  return { start: Math.max(0, r.start - page), end: r.end };
}

/** 다음 대사 더 보기 */
export function extendDown(r: ReadRange, total: number, page: number): ReadRange {
  return { start: r.start, end: Math.min(total, r.end + page) };
}

/** idx 항목이 구간 밖이면 그 항목을 중심으로 새 구간 [idx-CONTEXT, idx+page). 안이면 그대로. */
export function rangeShowing(r: ReadRange, idx: number, total: number, page: number): ReadRange {
  if (idx >= r.start && idx < r.end) return r;
  return { start: Math.max(0, idx - CONTEXT), end: Math.min(total, idx + page) };
}

/** 따라가는 중(맨 아래)에는 끝에서 page개만 남긴다. */
export function trimToTail(r: ReadRange, total: number, page: number): ReadRange {
  const start = Math.max(r.start, total - page);
  return start === r.start && r.end === total ? r : { start, end: total };
}
