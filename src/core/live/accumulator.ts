import type { GameData } from "../types";
import { aftermathStep, computeCoverage, coverRecord, newAftermath, seenKey, type AftermathState } from "./coverage";
import {
  applyHistoryRecord, buildHistory, buildHistoryState, historyModelOf, isValidRecord, newHistoryState, NOISY_MAX_CHANGES, NOISY_WINDOW_MS,
  variableChanges, type HistoryState,
} from "./history";
import type { Coverage, HistoryModel, LogRecord, PickInfo, RecordOf } from "./types";

/**
 * 새로 붙은 기록만으로 갈래 모델·진행도·잦은 변수를 갱신한다.
 * 결과는 언제나 buildHistory / computeCoverage / noisyVariables(records)와 같다.
 */
export interface LiveAccumulator {
  /** seq 순서로 들어온다고 가정하지만, 아니어도 결과는 일괄 함수와 같다. 빈 배열은 무시(version 그대로). */
  append(records: LogRecord[]): void;
  reset(): void;
  /** 지금까지의 전체 기록(append 순). 내부 배열이므로 고치지 말 것. */
  readonly records: LogRecord[];
  /** 비어 있지 않은 append와 reset마다 +1(빈 append는 그대로). */
  readonly version: number;
  /** version이 같으면 같은 객체, 바뀌면 새 객체(이후 append로 바뀌지 않는 사본). */
  model(): HistoryModel;
  /**
   * model()과 같되, 마지막 호출 뒤 들어온 기록이 진행도(seen·picks·결과·uncertain·changed)를
   * 바꾸지 않았으면 version이 바뀌어도 같은 객체를 돌려준다.
   */
  coverage(): Coverage;
  noisy(): Set<number>;
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object";

interface OpenPick { info: PickInfo; key: string; st: AftermathState }

export function createAccumulator(data: GameData): LiveAccumulator {
  let records: LogRecord[] = [];
  let version = 0;

  // 갈래 모델: seq가 거꾸로 들어오면 dirty로 두고 model() 때 전체에서 다시 만든다(드문 경로).
  let hist: HistoryState = newHistoryState();
  let maxSeq = -Infinity;
  let histDirty = false;

  // 진행도: computeCoverage와 같은 배열 순서 처리. 결과가 덜 찬 선택은 갈래별로 열어 둔다.
  let cov: Coverage = emptyCoverage();
  let lastOptions = new Map<string, unknown>();
  let open = new Map<unknown, OpenPick[]>();
  // 마지막 coverage() 사본 이후 진행도가 바뀌었는가
  let covDirty = true;
  let covCopy: Coverage | null = null;
  // 갈래 모델이 어긋나(seq 역순) 진행도를 처음부터 다시 쌓아야 하는가
  let covReplay = false;

  // 잦은 변수: 아직 아닌 변수의 변경 시각(정렬). 잦은 변수가 되면 목록을 버린다(한 번 잦으면 계속 잦음).
  let times = new Map<number, number[]>();
  let noisySet = new Set<number>();

  let cache: { version: number; model?: HistoryModel; noisy?: Set<number> } = { version };

  function feedCoverage(r: LogRecord) {
    if (!isObj(r)) return;
    // 선택 뒤 결과는 대표 갈래 묶음별로 모은다(computeCoverage의 aftermathGroup과 같다)
    const branch: unknown = typeof r.branch === "number" ? hist.alias.get(r.branch) ?? r.branch : r.branch;
    const list = open.get(branch);
    if (list) {
      const keep: OpenPick[] = [];
      for (const p of list) {
        const n = p.st.out.length;
        try {
          aftermathStep(p.st, r, data);
          if (p.st.out.length !== n) covDirty = true;
          if (!p.st.done) keep.push(p);
        } catch {
          dropPick(p);   // 일괄 계산에서도 결과 계산이 던지면 그 선택은 빠진다
          covDirty = true;
        }
      }
      if (keep.length > 0) open.set(branch, keep); else open.delete(branch);
    }
    const st = newAftermath();
    const sizes = cov.seen.size + cov.uncertainSeqs.size + cov.changedSeqs.size;
    const info = coverRecord(cov, r, data, lastOptions, () => st.out);
    if (info || cov.seen.size + cov.uncertainSeqs.size + cov.changedSeqs.size !== sizes) covDirty = true;
    if (info) {
      try {
        const p: OpenPick = { info, key: seenKey((r as RecordOf<"choice">).src!, (r as RecordOf<"choice">).cmd), st };
        const l = open.get(branch);
        if (l) l.push(p); else open.set(branch, [p]);
      } catch { /* coverRecord가 이미 같은 키를 만들었으므로 여기선 던지지 않는다 */ }
    }
  }

  function dropPick(p: OpenPick) {
    const l = cov.picks.get(p.key);
    if (!l) return;
    const i = l.indexOf(p.info);
    if (i >= 0) l.splice(i, 1);
    if (l.length === 0) cov.picks.delete(p.key);
  }

  function feedNoisy(r: LogRecord) {
    for (const { id, t, throttled } of variableChanges(r)) {
      if (noisySet.has(id)) continue;
      if (throttled) { noisySet.add(id); times.delete(id); continue; }
      let list = times.get(id);
      if (!list) { list = []; times.set(id, list); }
      const pos = insertSorted(list, t);
      // 새 시각을 포함하는 연속 11개 중 하나라도 60초 안이면 잦은 변수
      for (let s = Math.max(0, pos - NOISY_MAX_CHANGES); s <= pos && s + NOISY_MAX_CHANGES < list.length; s++) {
        if (list[s + NOISY_MAX_CHANGES] - list[s] < NOISY_WINDOW_MS) {
          noisySet.add(id);
          times.delete(id);
          break;
        }
      }
    }
  }

  function feed(r: LogRecord) {
    const valid = isValidRecord(r);
    if (valid) {
      if (r.seq < maxSeq) histDirty = true;
      else maxSeq = r.seq;
      if (!histDirty) {
        try { applyHistoryRecord(hist, r); } catch { histDirty = true; }
      }
    }
    // 결과 묶음(대표 갈래)은 갈래 모델에 달려 있다. 모델이 어긋나면 진행도는 coverage() 때 처음부터 다시 만든다.
    if (histDirty) covReplay = true;
    if (!covReplay) feedCoverage(r);
    if (valid) feedNoisy(r);
  }

  function ensureHistory() {
    if (!histDirty) return;
    hist = buildHistoryState(records);
    histDirty = false;
  }

  /** 전체 기록으로 진행도를 다시 쌓는다(seq가 거꾸로 들어온 드문 경로). */
  function replayCoverage() {
    ensureHistory();
    cov = emptyCoverage();
    lastOptions = new Map();
    open = new Map();
    covReplay = false;
    for (const r of records) {
      try { feedCoverage(r); } catch { /* 이상한 기록은 건너뛴다 */ }
    }
    covDirty = true;
  }

  function fresh() {
    if (cache.version !== version) cache = { version };
    return cache;
  }

  return {
    append(batch: LogRecord[]) {
      if (!Array.isArray(batch) || batch.length === 0) return;
      for (const r of batch) {
        records.push(r);
        try { feed(r); } catch { covDirty = true; /* 이상한 기록은 건너뛴다 */ }
      }
      version++;
    },
    reset() {
      records = [];
      hist = newHistoryState();
      maxSeq = -Infinity;
      histDirty = false;
      cov = emptyCoverage();
      lastOptions = new Map();
      open = new Map();
      covDirty = true;
      covCopy = null;
      covReplay = false;
      times = new Map();
      noisySet = new Set();
      version++;
    },
    get records() { return records; },
    get version() { return version; },
    model() {
      const c = fresh();
      if (!c.model) {
        try {
          ensureHistory();
          const m = historyModelOf(hist);
          const branches = new Map([...m.branches].map(([id, b]) => [id, { ...b, children: b.children.slice() }]));
          c.model = {
            branches, runs: m.runs.map(x => ({ run: x.run, branches: x.branches.slice() })), alias: new Map(m.alias),
            latestBranch: m.latestBranch,
          };
        } catch {
          c.model = buildHistory(records);
        }
      }
      return c.model;
    },
    coverage() {
      if (covReplay) {
        try { replayCoverage(); } catch { cov = computeCoverage(records, data); covReplay = false; covDirty = true; }
      }
      if (!covCopy || covDirty) {
        const picks = new Map<string, PickInfo[]>();
        for (const [k, l] of cov.picks) picks.set(k, l.map(p => ({ ...p, aftermath: p.aftermath.slice() })));
        covCopy = { seen: new Set(cov.seen), picks, uncertainSeqs: new Set(cov.uncertainSeqs), changedSeqs: new Set(cov.changedSeqs) };
        covDirty = false;
      }
      return covCopy;
    },
    noisy() {
      const c = fresh();
      if (!c.noisy) c.noisy = new Set(noisySet);
      return c.noisy;
    },
  };
}

function emptyCoverage(): Coverage {
  return { seen: new Set(), picks: new Map(), uncertainSeqs: new Set(), changedSeqs: new Set() };
}

/** 정렬된 목록에 t를 넣고 위치를 돌려준다(대개 끝에 붙는다). */
function insertSorted(list: number[], t: number): number {
  if (list.length === 0 || list[list.length - 1] <= t) { list.push(t); return list.length - 1; }
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] <= t) lo = mid + 1; else hi = mid;
  }
  list.splice(lo, 0, t);
  return lo;
}
