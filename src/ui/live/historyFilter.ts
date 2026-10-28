import type { HistoryItem } from "@/core/live/types";

export type Kind = "message" | "choice" | "picture" | "transfer" | "battle" | "state" | "save";

export const ALL_KINDS: Kind[] = ["message", "choice", "picture", "transfer", "battle", "state", "save"];

/** 항목의 종류. null이면 토글과 상관없이 항상 표시한다. */
export function itemKind(item: HistoryItem): Kind | null {
  switch (item.kind) {
    case "repeat": return "message";
    case "stateGroup": return "state";
    case "fork": return null;
    case "record":
      switch (item.record.type) {
        case "message": case "scroll": return "message";
        case "choices": case "choice": return "choice";
        case "picture": return "picture";
        case "transfer": return "transfer";
        case "battle": return "battle";
        case "state": return "state";
        case "save": case "load": return "save";
        default: return null; // branchStart, error, plugin(항상 보임)
      }
  }
}

export function filterItems(items: HistoryItem[], enabled: Set<Kind>): HistoryItem[] {
  return items.filter(it => {
    const k = itemKind(it);
    return k === null || enabled.has(k);
  });
}

const KEY = "rpgv.historyKinds";

export function loadKinds(): Set<Kind> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) return new Set(ALL_KINDS.filter(k => arr.includes(k)));
    }
  } catch { /* 저장소 사용 불가 */ }
  return new Set(ALL_KINDS);
}

export function saveKinds(kinds: Set<Kind>): void {
  try { localStorage.setItem(KEY, JSON.stringify([...kinds])); } catch { /* 저장소 사용 불가 */ }
}
