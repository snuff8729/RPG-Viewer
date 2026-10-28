import { formatText } from "../text/escape";
import type { GameData, Location } from "../types";
import { branchLabel, isContinuation } from "./history";
import type { HistoryItem, HistoryModel, LogRecord, RecordOf } from "./types";

export type ReaderItem =
  | { kind: "chapter"; key: string; text: string }
  | { kind: "message"; key: string; seq: number; speaker: string; face: string; faceIndex: number; lines: string[]; src: Location | null; cmd: number | null; repeat?: number }
  | { kind: "scroll"; key: string; seq: number; lines: string[] }
  | { kind: "picture"; key: string; seq: number; name: string }
  | { kind: "choice"; key: string; seq: number; label: string }
  | { kind: "battle"; key: string; seq: number };

const safe = (s: unknown): string => typeof s === "string" ? s : "";
const lines = (text: unknown, data: GameData): string[] => formatText(safe(text), data).split("\n");

function speakerOf(r: RecordOf<"message">, data: GameData): string {
  const named = safe(r.speaker) ? formatText(r.speaker, data) : "";
  if (named) return named;
  if (!r.face) return "";
  const actor = (data?.actors ?? []).find(a => a && a.faceName === r.face && a.faceIndex === r.faceIndex);
  return actor?.name ?? "";
}

function messageItem(r: RecordOf<"message">, data: GameData, repeat?: number): ReaderItem {
  const item: ReaderItem = {
    kind: "message", key: `r${r.seq}`, seq: r.seq, speaker: speakerOf(r, data), face: safe(r.face),
    faceIndex: typeof r.faceIndex === "number" ? r.faceIndex : 0, lines: lines(r.text, data),
    src: r.src ?? null, cmd: typeof r.cmd === "number" ? r.cmd : null,
  };
  if (repeat !== undefined) item.repeat = repeat;
  return item;
}

function fromRecord(r: LogRecord, data: GameData, choiceText: Map<number, string>, model: HistoryModel): ReaderItem | null {
  switch (r.type) {
    case "message": return messageItem(r, data);
    case "scroll": return { kind: "scroll", key: `r${r.seq}`, seq: r.seq, lines: lines(r.text, data) };
    case "picture": return { kind: "picture", key: `r${r.seq}`, seq: r.seq, name: safe(r.name) };
    case "choice": {
      // historyText.pickedFallbackText와 같은 규칙: 취소(-2)는 `취소`, 그 밖은 `{n}번째 선택지`
      const label = choiceText?.get(r.seq) ?? (r.picked === -2 ? "취소" : `${r.picked + 1}번째 선택지`);
      return { kind: "choice", key: `r${r.seq}`, seq: r.seq, label };
    }
    case "transfer":
      return { kind: "chapter", key: `c${r.seq}`, text: `— ${data?.mapInfos?.[r.mapId]?.name || `#${r.mapId}`} —` };
    case "branchStart":
      // 이어진 갈래(저장 → 종료 → 이어하기)의 시작은 새 갈래 시작이 아니다
      if (isContinuation(model, r.branch)) return null;
      return { kind: "chapter", key: `c${r.seq}`, text: `— ${branchLabel(model, r.branch)} 시작 —` };
    case "battle": return r.phase === "start" ? { kind: "battle", key: `r${r.seq}`, seq: r.seq } : null;
    default: return null;
  }
}

/**
 * foldTimeline 결과를 읽기 항목으로 바꾼다(대사·그림·고른 선택·장면 구분만). 예외를 던지지 않는다.
 * model은 갈래 시작 문구(`— {n}회차 갈래 {m} 시작 —`)에 쓴다.
 */
export function readerItems(items: HistoryItem[], data: GameData, choiceText: Map<number, string>, model: HistoryModel): ReaderItem[] {
  const out: ReaderItem[] = [];
  for (const it of Array.isArray(items) ? items : []) {
    try {
      if (!it) continue;
      if (it.kind === "record") {
        const r = fromRecord(it.record, data, choiceText, model);
        if (r) out.push(r);
      } else if (it.kind === "repeat") {
        out.push(messageItem(it.record, data, it.count));
      }
    } catch { /* 깨진 항목은 건너뛴다 */ }
  }
  return out;
}

/** 항목이 속한 마지막 기록 seq. chapter는 null. */
export function lastSeqOf(item: ReaderItem): number | null {
  return item.kind === "chapter" ? null : item.seq;
}
