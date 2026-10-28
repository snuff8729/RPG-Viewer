import type { EventCommand, GameData, Location } from "../types";
import type { LogRecord } from "./types";

export type MismatchReason = "noSource" | "noPage" | "codeMismatch" | "faceMismatch" | "optionCount" | "textChanged";
export interface Mismatch { reason: MismatchReason; recorded: string; expected: string }

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object";
const listOf = (v: unknown): EventCommand[] | null => (Array.isArray(v) ? (v as EventCommand[]) : null);

/** 위치의 원본 명령 목록. 없으면 null. 예외를 던지지 않는다. */
export function pageList(data: GameData, loc: Location): EventCommand[] | null {
  try {
    if (!isObj(loc)) return null;
    switch (loc.source) {
      case "map": {
        const ev = data.maps?.get(loc.mapId)?.events?.[loc.eventId];
        return isObj(ev) ? listOf(ev.pages?.[loc.page]?.list) : null;
      }
      case "common": return listOf(data.commonEvents?.[loc.commonEventId]?.list);
      case "troop": return listOf(data.troops?.[loc.troopId]?.pages?.[loc.page]?.list);
      default: return null;
    }
  } catch {
    return null;
  }
}

const LABELS: Record<MismatchReason, string> = {
  noSource: "출처를 알 수 없음",
  noPage: "페이지를 찾을 수 없음",
  codeMismatch: "명령 종류가 다름",
  faceMismatch: "얼굴 그래픽이 다름",
  optionCount: "선택지 개수가 다름",
  textChanged: "실행 중 본문이 바뀜",
};
export function reasonLabel(reason: MismatchReason): string {
  return LABELS[reason] ?? String(reason);
}

const firstLine = (text: unknown): string => (typeof text === "string" ? text.split("\n")[0] : "");
const optionsText = (v: unknown): string => (Array.isArray(v) ? v.map(String).join(" / ") : "");
const sameOptions = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => String(x) === String(b[i]));
const sameCount = (a: unknown, b: unknown): boolean => Array.isArray(a) && Array.isArray(b) && a.length === b.length;

/** list[cmd]의 본문: 101/105 → 뒤이은 401/405 줄을 `\n`로, 102 → 선택지 ` / `, 그 외 "". */
function bodyAt(list: EventCommand[], cmd: number): string {
  const at = (i: number) => (isObj(list[i]) ? list[i] : null);
  const code = at(cmd)?.code;
  const lines = (lineCode: number): string => {
    const out: string[] = [];
    for (let i = cmd + 1; at(i)?.code === lineCode; i++) {
      const p = at(i)!.parameters;
      out.push(Array.isArray(p) && p[0] != null ? String(p[0]) : "");
    }
    return out.join("\n");
  };
  if (code === 101) return lines(401);
  if (code === 105) return lines(405);
  if (code === 102) {
    const p = at(cmd)!.parameters;
    return optionsText(Array.isArray(p) ? p[0] : undefined);
  }
  return "";
}

/**
 * 기록과 데이터 명령의 불일치 원인. 일치하면 null.
 * choiceOpts: choice 기록이면 같은 갈래·같은 src+cmd의 가장 가까운 앞 choices 기록 옵션
 * (없으면 undefined → 코드만 확인). textChanged만 구조 일치(연결됨)이고 나머지는 위치 불확실.
 * 예외를 던지지 않는다.
 */
export function explainRecord(r: LogRecord, data: GameData, choiceOpts?: unknown): Mismatch | null {
  try {
    return mismatchOf(r, data, choiceOpts);
  } catch {
    return null;
  }
}

/** explainRecord와 같지만 예외를 잡지 않는다(호출자가 잡아 기록을 건너뛴다). */
export function mismatchOf(r: LogRecord, data: GameData, choiceOpts?: unknown): Mismatch | null {
  if (!isObj(r)) return null;
  let recorded: string;
  switch (r.type) {
    case "message": case "scroll": recorded = typeof r.text === "string" ? r.text : ""; break;
    case "choices": recorded = optionsText(r.options); break;
    case "choice": recorded = optionsText(choiceOpts); break;
    default: return null;
  }
  const cmd = (r as { cmd?: unknown }).cmd;
  if (!isObj(r.src) || typeof cmd !== "number") return { reason: "noSource", recorded, expected: "" };
  const list = pageList(data, r.src);
  if (!list) return { reason: "noPage", recorded, expected: "" };
  const expected = bodyAt(list, cmd);
  const out = (reason: MismatchReason): Mismatch => ({ reason, recorded, expected });
  const at = (i: number) => (isObj(list[i]) ? list[i] : null);
  const params = at(cmd)?.parameters;
  const p = Array.isArray(params) ? params : [];
  switch (r.type) {
    case "message": {
      if (at(cmd)?.code !== 101) return out("codeMismatch");
      if (String(r.face ?? "") !== String(p[0] ?? "") || Number(r.faceIndex ?? 0) !== Number(p[1] ?? 0)) return out("faceMismatch");
      // 401 없는 101(빈 메시지·바로 102)은 기록 본문도 비어 있어야 같은 구조
      const has401 = at(cmd + 1)?.code === 401;
      if (has401 !== (recorded !== "")) return out("codeMismatch");
      return has401 && firstLine(recorded) !== firstLine(expected) ? out("textChanged") : null;
    }
    case "scroll":
      if (at(cmd)?.code !== 105) return out("codeMismatch");
      return firstLine(recorded) !== firstLine(expected) ? out("textChanged") : null;
    case "choices":
      if (at(cmd)?.code !== 102) return out("codeMismatch");
      if (!sameCount(r.options, p[0])) return out("optionCount");
      return sameOptions(r.options, p[0]) ? null : out("textChanged");
    case "choice":
      if (at(cmd)?.code !== 102) return out("codeMismatch");
      return choiceOpts === undefined || sameCount(choiceOpts, p[0]) ? null : out("optionCount");
    default:
      return null;
  }
}
