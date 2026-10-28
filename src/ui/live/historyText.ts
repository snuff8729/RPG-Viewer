import { locationKey } from "@/core/index/locations";
import { formatText } from "@/core/text/escape";
import { switchName, variableName } from "@/core/text/names";
import type { GameData } from "@/core/types";
import type { LogRecord, RecordOf, StateChange } from "@/core/live/types";

/** 경로의 choice 기록 seq → 고른 옵션 문구. 직전의 같은 src+cmd choices 기록에서 찾는다. */
export function choiceTexts(path: LogRecord[], data: GameData, fallback?: (r: RecordOf<"choice">) => string[] | null): Map<number, string> {
  const last = new Map<string, string[]>();
  const out = new Map<number, string>();
  for (const r of path) {
    if (r.type === "choices" && r.src) {
      last.set(`${locationKey(r.src)}#${r.cmd}`, Array.isArray(r.options) ? r.options : []);
    } else if (r.type === "choice") {
      const opts = (r.src ? last.get(`${locationKey(r.src)}#${r.cmd}`) : undefined) ?? fallback?.(r) ?? null;
      const raw = r.picked >= 0 ? opts?.[r.picked] : undefined;
      out.set(r.seq, raw !== undefined ? formatText(raw, data) : pickedFallbackText(r.picked));
    }
  }
  return out;
}

/** 옵션 문구를 모를 때: 취소(-2)는 `취소`, 그 밖은 `{n}번째 선택지`. */
export function pickedFallbackText(picked: number): string {
  return picked === -2 ? "취소" : `${picked + 1}번째 선택지`;
}

export function stateChangeText(c: StateChange, data: GameData): string {
  if (c.kind === "switch") return `스위치 ${switchName(data, Number(c.id))} → ${c.value ? "ON" : "OFF"}`;
  if (c.kind === "variable") return `변수 ${variableName(data, Number(c.id))} = ${String(c.value)}`;
  return `셀프 스위치 ${String(c.id)} → ${c.value ? "ON" : "OFF"}`;
}

export function battleText(r: RecordOf<"battle">, data: GameData): string {
  if (r.phase === "start") return `⚔ 전투 시작: ${data.troops?.[r.troopId]?.name || `#${r.troopId}`}`;
  const res = r.result === "win" ? "승리" : r.result === "escape" ? "도주" : r.result === "lose" ? "패배" : "";
  return res ? `⚔ 전투 종료: ${res}` : "⚔ 전투 종료";
}

export function transferText(r: RecordOf<"transfer">, data: GameData): string {
  return `🚪 ${data.mapInfos?.[r.mapId]?.name || `#${r.mapId}`} (${r.x}, ${r.y})`;
}

export function reasonText(reason: "newGame" | "load" | "unknownSave"): string {
  return reason === "newGame" ? "새 게임" : reason === "load" ? "세이브에서 갈라짐" : "출처 모를 세이브";
}
