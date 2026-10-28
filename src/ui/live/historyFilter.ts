import type { HistoryItem, RecordOf } from "@/core/live/types";

export type Kind = "message" | "choice" | "picture" | "transfer" | "battle" | "state" | "save";

export const ALL_KINDS: Kind[] = ["message", "choice", "picture", "transfer", "battle", "state", "save"];

/** 항목의 종류. null이면 토글과 상관없이 항상 표시한다. */
export function itemKind(item: HistoryItem): Kind | null {
  switch (item.kind) {
    case "repeat": return "message";
    case "stateGroup": return "state";
    case "fork": return null;
    case "battle": return "battle";
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

/** hidePlugin: 숨길 플러그인 명령 기록(기술 명령이고 `플러그인 명령 모두 보기`가 꺼짐) */
export function filterItems(items: HistoryItem[], enabled: Set<Kind>, hidePlugin?: (r: RecordOf<"plugin">) => boolean): HistoryItem[] {
  const out: HistoryItem[] = [];
  for (const it of items) {
    if (hidePlugin && it.kind === "record" && it.record.type === "plugin" && hidePlugin(it.record)) continue;
    const k = itemKind(it);
    if (k !== null && !enabled.has(k)) continue;
    // 전투 묶음 안은 숨길 플러그인 명령만 거른다(묶음이 보이면 그 안의 대사·상태 변경은 그대로 보인다)
    if (it.kind === "battle" && hidePlugin) {
      const inner = filterItems(it.items, new Set(ALL_KINDS), hidePlugin);
      out.push(inner.length === it.items.length ? it : { ...it, items: inner });
    } else out.push(it);
  }
  return out;
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
