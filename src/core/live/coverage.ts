import { locationKey } from "../index/locations";
import { formatText } from "../text/escape";
import { switchName } from "../text/names";
import type { EventCommand, GameData, Location } from "../types";
import type { Coverage, LogRecord, PickInfo } from "./types";

const AFTERMATH_MAX = 3;
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object";
const listOf = (v: unknown): EventCommand[] | null => (Array.isArray(v) ? (v as EventCommand[]) : null);

/** `${locationKey(loc)}#${cmd}` — 본 대사(message/scroll) 키. */
export function seenKey(loc: Location, cmd: number): string {
  return `${locationKey(loc)}#${cmd}`;
}
/** `${locationKey(loc)}#${cmd}` — 선택지(choices 명령) 키. */
export const pickKey = seenKey;

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

const firstLine = (text: unknown): string => (typeof text === "string" ? text.split("\n")[0] : "");
const rawText = (c: EventCommand | null | undefined): string | undefined =>
  isObj(c) && Array.isArray(c.parameters) && typeof c.parameters[0] === "string" ? c.parameters[0] : undefined;


const sameOptions = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => String(x) === String(b[i]));

/**
 * 기록이 가리키는 명령이 데이터와 맞는지.
 * choiceOpts: choice 기록이면 같은 갈래·같은 src+cmd의 가장 가까운 앞 choices 기록 옵션(없으면 undefined → 코드만 확인).
 */
function verified(r: LogRecord, data: GameData, choiceOpts?: unknown): boolean {
  if (!("src" in r) || !isObj(r.src) || typeof (r as { cmd?: unknown }).cmd !== "number") return false;
  const list = pageList(data, r.src);
  if (!list) return false;
  const cmd = (r as { cmd: number }).cmd;
  const at = (i: number) => (isObj(list[i]) ? list[i] : null);
  const dataOptions = (): unknown => {
    const p = at(cmd)?.parameters;
    return Array.isArray(p) ? p[0] : undefined;
  };
  switch (r.type) {
    case "message":
      if (at(cmd)?.code !== 101) return false;
      // 401 없는 101(빈 메시지·바로 102): 기록 문구도 비어 있으면 코드만으로 맞다고 본다
      if (at(cmd + 1)?.code !== 401) return r.text === "";
      return rawText(at(cmd + 1)) === firstLine(r.text);
    case "scroll":
      return at(cmd)?.code === 105 && at(cmd + 1)?.code === 405 && rawText(at(cmd + 1)) === firstLine(r.text);
    case "choices":
      return at(cmd)?.code === 102 && sameOptions(r.options, dataOptions());
    case "choice":
      return at(cmd)?.code === 102 && (choiceOpts === undefined || sameOptions(choiceOpts, dataOptions()));
    default:
      return false;
  }
}

/** 같은 갈래의 이후 기록(branchIdx[from+1..])만 훑는다. 같은 갈래의 다음 choice나 결과 3개에서 멈춘다. */
function aftermathOf(records: LogRecord[], branchIdx: number[], from: number, data: GameData): string[] {
  const out: string[] = [];
  let messageDone = false;
  for (let k = from + 1; k < branchIdx.length && out.length < AFTERMATH_MAX; k++) {
    const r = records[branchIdx[k]];
    if (r.type === "choice") break;
    if (r.type === "message" && !messageDone) {
      messageDone = true;
      out.push(`${formatText(String(r.speaker ?? ""), data) || "(내레이션)"}: "${formatText(firstLine(r.text), data)}"`);
    } else if (r.type === "state" && Array.isArray(r.changes)) {
      for (const ch of r.changes) {
        if (out.length >= AFTERMATH_MAX) break;
        if (isObj(ch) && ch.kind === "switch") out.push(`스위치 ${switchName(data, Number(ch.id))} → ${ch.value ? "ON" : "OFF"}`);
      }
    } else if (r.type === "transfer") {
      out.push(`🚪 ${data.mapInfos?.[r.mapId]?.name || `#${r.mapId}`} 이동`);
    }
  }
  return out;
}

/** 모든 회차·갈래에 걸친 진행도. 원문 불일치·위치 없음은 uncertainSeqs로 빼고 제외한다. 예외를 던지지 않는다. */
export function computeCoverage(records: LogRecord[], data: GameData): Coverage {
  const cov: Coverage = { seen: new Set(), picks: new Map(), uncertainSeqs: new Set() };
  const recs = Array.isArray(records) ? records : [];
  // 갈래별 기록 위치 목록(배열 순서)을 한 번 만들어, 선택 뒤 결과는 자기 갈래 기록만 본다.
  const byBranch = new Map<unknown, number[]>();
  const posInBranch: number[] = new Array<number>(recs.length);
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (!isObj(r)) continue;
    let l = byBranch.get(r.branch);
    if (!l) { l = []; byBranch.set(r.branch, l); }
    posInBranch[i] = l.length;
    l.push(i);
  }
  // `${branch}|${pickKey}` → 그 갈래에서 가장 최근 choices 기록의 옵션
  const lastOptions = new Map<string, unknown>();
  recs.forEach((r, i) => {
    try {
      if (!isObj(r)) return;
      if (r.type !== "message" && r.type !== "scroll" && r.type !== "choices" && r.type !== "choice") return;
      let choiceOpts: unknown = undefined;
      if ((r.type === "choices" || r.type === "choice") && isObj(r.src)) {
        const optsKey = `${String(r.branch)}|${seenKey(r.src, r.cmd)}`;
        if (r.type === "choices") lastOptions.set(optsKey, r.options);
        else choiceOpts = lastOptions.get(optsKey);
      }
      if (!verified(r, data, choiceOpts)) {
        if (typeof r.seq === "number") cov.uncertainSeqs.add(r.seq);
        return;
      }
      const key = seenKey(r.src!, r.cmd);
      if (r.type === "message" || r.type === "scroll") cov.seen.add(key);
      else if (r.type === "choice") {
        const info: PickInfo = {
          picked: r.picked, run: r.run, branch: r.branch, seq: r.seq,
          aftermath: aftermathOf(recs, byBranch.get(r.branch) ?? [], posInBranch[i], data),
        };
        const l = cov.picks.get(key);
        if (l) l.push(info); else cov.picks.set(key, [info]);
      }
    } catch {
      /* 이상한 기록은 건너뛴다 */
    }
  });
  return cov;
}
