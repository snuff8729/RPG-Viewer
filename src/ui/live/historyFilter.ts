import type { HistoryItem, RecordOf } from "@/core/live/types";
import { isNoticeHidden, type NoticeHide } from "@/core/addons/notices";

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

/**
 * hidePlugin: 숨길 플러그인 명령 기록(기술 명령이고 `플러그인 명령 모두 보기`가 꺼짐).
 * hideNotices: 알림 문구(1.9.0)를 숨긴다(`알림 문구 보기`가 꺼짐, 전투 안의 것도 — 전투 기록 줄 수에서도 뺀다).
 *   알림 종류 집합이면 그 종류(업적·획득·퀘스트·알림)만 숨긴다.
 */
export function filterItems(
  items: HistoryItem[], enabled: Set<Kind>, hidePlugin?: (r: RecordOf<"plugin">) => boolean, hideNotices: NoticeHide = false,
): HistoryItem[] {
  const out: HistoryItem[] = [];
  const noticeHidden = (x: HistoryItem) => x.kind === "record" && x.record.type === "notice" && isNoticeHidden(x.record, hideNotices);
  for (const it of items) {
    if (hidePlugin && it.kind === "record" && it.record.type === "plugin" && hidePlugin(it.record)) continue;
    if (noticeHidden(it)) continue;
    // 기록 사이 화면 그림(1.10.0)은 읽기에서만 그린다
    if (it.kind === "record" && it.record.type === "screen") continue;
    const k = itemKind(it);
    if (k !== null && !enabled.has(k)) continue;
    // 전투 묶음 안은 숨길 플러그인 명령·알림 문구만 거른다(묶음이 보이면 그 안의 대사·상태 변경은 그대로 보인다)
    if (it.kind === "battle") {
      const inner = filterItems(it.items, new Set(ALL_KINDS), hidePlugin, hideNotices);
      if (inner.length === it.items.length) { out.push(it); continue; }
      const notices = it.items.filter(noticeHidden).length;
      out.push({ ...it, items: inner, logLines: Math.max(0, it.logLines - notices) });
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
