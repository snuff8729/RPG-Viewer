import { lastSeqOf, type ReaderItem } from "./reader";

/**
 * 읽기 화면에서 원하는 곳으로 가기(북마크·목차)에 쓰는 것. 모든 함수는 예외를 던지지 않는다.
 */

/** 항목이 시작하는 기록 seq: key(r{seq}·c{seq}·k{seq}·h…)의 첫 번호, 없으면 lastSeqOf. 모르면 null. */
export function firstSeqOf(item: ReaderItem): number | null {
  try {
    if (item.kind === "hidden") return item.items.length > 0 ? firstSeqOf(item.items[0]) : item.seq;
    const k = item.key;
    let n = 0, i = 1, any = false;
    for (; i < k.length; i++) {
      const c = k.charCodeAt(i);
      if (c < 48 || c > 57) break;
      n = n * 10 + (c - 48);
      any = true;
    }
    if (any && i === k.length) return n;
    return lastSeqOf(item);
  } catch {
    return null;
  }
}

/** seq 기록이 든(또는 그 뒤 첫) 항목 위치. 그런 항목이 없으면 마지막 항목, 항목이 없으면 -1. */
export function indexOfSeq(items: readonly ReaderItem[], seq: number): number {
  try {
    if (!Array.isArray(items) || items.length === 0) return -1;
    for (let i = 0; i < items.length; i++) {
      const s = lastSeqOf(items[i]);
      if (s !== null && s >= seq) return i;
    }
    return items.length - 1;
  } catch {
    return -1;
  }
}

/** seq 순으로 놓인 기록들에 그 seq가 있는가(이분 탐색, 순서가 어긋나 있으면 끝까지 훑는다) */
export function hasSeq(records: readonly { seq: number }[], seq: number): boolean {
  try {
    if (!Array.isArray(records)) return false;
    let lo = 0, hi = records.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const s = records[mid]?.seq;
      if (s === seq) return true;
      if (typeof s !== "number") break;
      if (s < seq) lo = mid + 1; else hi = mid - 1;
    }
    return records.some((r) => r?.seq === seq);
  } catch {
    return false;
  }
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** 항목을 짧게 말하는 글(북마크 기본 이름 등). max자에서 자르고 …을 붙인다. 글이 없으면 "". */
export function itemSummary(item: ReaderItem, max = 20): string {
  try {
    let s = "";
    switch (item.kind) {
      case "message": s = (item.speaker ? `${item.speaker}: ` : "") + item.lines.join(" "); break;
      case "scroll": s = item.lines.join(" "); break;
      case "notice": case "battlelog": case "plugin": s = item.text; break;
      case "choice": s = `고른 것: ${item.label}`; break;
      case "picture": s = item.caption || item.name; break;
      case "battle": s = `전투: ${item.troop}`; break;
      case "chapter": s = item.text.replace(/^—\s*|\s*—$/g, ""); break;
      case "hidden": s = item.items.length > 0 ? itemSummary(item.items[0], Infinity) : ""; break;
      default: s = "";
    }
    s = squash(s);
    const chars = [...s];
    return chars.length > max ? `${chars.slice(0, max).join("")}…` : s;
  } catch {
    return "";
  }
}
