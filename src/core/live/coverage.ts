import { locationKey } from "../index/locations";
import { formatText } from "../text/escape";
import { switchName } from "../text/names";
import type { GameData, Location } from "../types";
import { mismatchOf, pageList } from "./mismatch";
import { buildHistory, representative } from "./history";
import type { Coverage, HistoryModel, LogRecord, PickInfo } from "./types";

const AFTERMATH_MAX = 3;
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object";

/** `${locationKey(loc)}#${cmd}` — 본 대사(message/scroll) 키. */
export function seenKey(loc: Location, cmd: number): string {
  return `${locationKey(loc)}#${cmd}`;
}
/** `${locationKey(loc)}#${cmd}` — 선택지(choices 명령) 키. */
export const pickKey = seenKey;

export { pageList };

const firstLine = (text: unknown): string => (typeof text === "string" ? text.split("\n")[0] : "");

/** 선택 뒤 결과를 기록 한 줄씩 채우는 상태. done이면 더 받지 않는다(같은 갈래의 다음 choice, 또는 결과 3개). */
export interface AftermathState { out: string[]; messageDone: boolean; done: boolean }
export const newAftermath = (): AftermathState => ({ out: [], messageDone: false, done: false });

/** 같은 갈래의 다음 기록 하나를 결과에 반영한다. 일괄·증분 계산이 공유한다(서식 오류는 던질 수 있음). */
export function aftermathStep(st: AftermathState, r: LogRecord, data: GameData): void {
  if (st.done) return;
  if (r.type === "choice") { st.done = true; return; }
  const out = st.out;
  if (r.type === "message" && !st.messageDone) {
    st.messageDone = true;
    out.push(`${formatText(String(r.speaker ?? ""), data) || "(내레이션)"}: "${formatText(firstLine(r.text), data)}"`);
  } else if (r.type === "state" && Array.isArray(r.changes)) {
    for (const ch of r.changes) {
      if (out.length >= AFTERMATH_MAX) break;
      if (isObj(ch) && ch.kind === "switch") out.push(`스위치 ${switchName(data, Number(ch.id))} → ${ch.value ? "ON" : "OFF"}`);
    }
  } else if (r.type === "transfer") {
    out.push(`🚪 ${data.mapInfos?.[r.mapId]?.name || `#${r.mapId}`} 이동`);
  }
  if (out.length >= AFTERMATH_MAX) st.done = true;
}

/** 같은 갈래의 이후 기록(branchIdx[from+1..])만 훑는다. 같은 갈래의 다음 choice나 결과 3개에서 멈춘다. */
function aftermathOf(records: LogRecord[], branchIdx: number[], from: number, data: GameData): string[] {
  const st = newAftermath();
  for (let k = from + 1; k < branchIdx.length && !st.done; k++) aftermathStep(st, records[branchIdx[k]], data);
  return st.out;
}

/**
 * 기록 한 줄을 진행도에 반영한다(배열 순서대로 호출). choice면 cov.picks에 넣은 PickInfo를 돌려준다.
 * lastOptions: `${branch}|${pickKey}` → 그 갈래에서 가장 최근 choices 기록의 옵션(호출 사이에 유지).
 * aftermath: 새 선택의 결과 계산 — 던지면 그 기록은 건너뛴다. 이 함수는 예외를 던지지 않는다.
 */
export function coverRecord(
  cov: Coverage, r: LogRecord, data: GameData, lastOptions: Map<string, unknown>, aftermath: () => string[],
): PickInfo | null {
  try {
    if (!isObj(r)) return null;
    if (r.type !== "message" && r.type !== "scroll" && r.type !== "choices" && r.type !== "choice") return null;
    let choiceOpts: unknown = undefined;
    if ((r.type === "choices" || r.type === "choice") && isObj(r.src)) {
      const optsKey = `${String(r.branch)}|${seenKey(r.src, r.cmd)}`;
      if (r.type === "choices") lastOptions.set(optsKey, r.options);
      else choiceOpts = lastOptions.get(optsKey);
    }
    const mismatch = mismatchOf(r, data, choiceOpts);
    if (mismatch && mismatch.reason !== "textChanged") {
      if (typeof r.seq === "number") cov.uncertainSeqs.add(r.seq);
      return null;
    }
    if (mismatch && typeof r.seq === "number") cov.changedSeqs.add(r.seq);
    const key = seenKey(r.src!, r.cmd);
    if (r.type === "message" || r.type === "scroll") cov.seen.add(key);
    else if (r.type === "choice") {
      const info: PickInfo = { picked: r.picked, run: r.run, branch: r.branch, seq: r.seq, aftermath: aftermath() };
      const l = cov.picks.get(key);
      if (l) l.push(info); else cov.picks.set(key, [info]);
      return info;
    }
  } catch {
    /* 이상한 기록은 건너뛴다 */
  }
  return null;
}

/** 선택 뒤 결과를 모을 갈래 묶음: 대표 갈래(이어진 갈래는 이어 간 갈래와 같은 묶음). branch가 숫자가 아니면 그대로. */
export function aftermathGroup(model: HistoryModel, branch: unknown): unknown {
  return typeof branch === "number" ? representative(model, branch) : branch;
}

/**
 * 모든 회차·갈래에 걸친 진행도. 구조(명령 코드·얼굴·선택지 개수)가 맞으면 연결하고, 본문만 다르면 changedSeqs에도 넣는다.
 * 구조 불일치·위치 없음은 uncertainSeqs로 빼고 제외한다. 예외를 던지지 않는다.
 * 선택 뒤 결과는 같은 대표 갈래 묶음의 이후 기록에서 모은다(저장 → 종료 → 이어하기 뒤 기록도 이어서 본다).
 * model: 그 묶음을 정할 갈래 모델(buildHistory(records)와 같아야 한다). 없으면 records로 만든다.
 */
export function computeCoverage(records: LogRecord[], data: GameData, model?: HistoryModel): Coverage {
  const cov: Coverage = { seen: new Set(), picks: new Map(), uncertainSeqs: new Set(), changedSeqs: new Set() };
  const recs = Array.isArray(records) ? records : [];
  const m = model ?? buildHistory(recs);
  // 묶음별 기록 위치 목록(배열 순서)을 한 번 만들어, 선택 뒤 결과는 자기 묶음 기록만 본다.
  const byGroup = new Map<unknown, number[]>();
  const groupOf: unknown[] = new Array<unknown>(recs.length);
  const posInGroup: number[] = new Array<number>(recs.length);
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (!isObj(r)) continue;
    const g = aftermathGroup(m, r.branch);
    let l = byGroup.get(g);
    if (!l) { l = []; byGroup.set(g, l); }
    groupOf[i] = g;
    posInGroup[i] = l.length;
    l.push(i);
  }
  // `${branch}|${pickKey}` → 그 갈래에서 가장 최근 choices 기록의 옵션
  const lastOptions = new Map<string, unknown>();
  recs.forEach((r, i) => {
    coverRecord(cov, r, data, lastOptions, () => aftermathOf(recs, byGroup.get(groupOf[i]) ?? [], posInGroup[i], data));
  });
  return cov;
}
