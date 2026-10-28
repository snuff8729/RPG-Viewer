import type { MissingItem } from "@/core/live/types";

export const PAGE_SIZE = 100;

/** 요구 조건 중 unmet이 하나도 없는 항목만 (enabled=false면 전부) */
export function filterReachable(items: MissingItem[], enabled = true): MissingItem[] {
  return enabled ? items.filter((m) => !m.requirements.some((r) => r.status === "unmet")) : items;
}

export function splitMissing(items: MissingItem[]): { choices: MissingItem[]; pages: MissingItem[] } {
  return {
    choices: items.filter((m) => m.kind === "choice"),
    pages: items.filter((m) => m.kind === "page"),
  };
}

/** pageCount번째 '더 보기'까지 보여줄 앞부분 */
export function pageSlice<T>(items: T[], pageCount: number): T[] {
  return items.slice(0, PAGE_SIZE * pageCount);
}
