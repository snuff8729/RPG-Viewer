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

export interface InitialWindow {
  /** 뒤에서부터 그릴 항목 수 */
  shown: number;
  /** 처음 스크롤 위치: 맨 아래 / 첫 안 읽은 항목 / 창의 맨 위 */
  at: "bottom" | "item" | "top";
  /** 처음 위치에서 바로 읽음 표시를 할지(아니면 사용자가 스크롤하거나 다음을 누를 때부터) */
  armed: boolean;
}

/** 첫 안 읽은 항목 앞에 함께 그려 둘 이미 읽은 항목 수 */
const CONTEXT = 5;

/**
 * 갈래를 처음 볼 때의 창. 읽던 곳이 있으면 첫 안 읽은 항목부터 끝까지 빠짐없이 그린다(상한 없음).
 * 처음 읽는데 전부 한 창에 들어오면 처음부터, 아니면 최근 page개의 맨 위에서 시작하되 읽음 표시는 미룬다.
 */
export function initialWindow(total: number, stats: ReadStats, readSeq: number, page: number): InitialWindow {
  if (stats.firstUnreadIdx === -1) return { shown: Math.min(total, page), at: "bottom", armed: true };
  if (readSeq >= 0) {
    return { shown: Math.min(total, Math.max(page, total - stats.firstUnreadIdx + CONTEXT)), at: "item", armed: true };
  }
  if (total <= page) return { shown: total, at: "top", armed: true };
  return { shown: page, at: "top", armed: false };
}
