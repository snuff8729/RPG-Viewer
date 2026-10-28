// 갈래 영구 삭제 계획(순수 함수): 어떤 기록을 남기고 어떤 기록을 지울지 정한다.
// 남길 갈래의 기록 전부 + 그 조상 갈래의 필요한 앞부분(갈라진 저장 지점까지)을 남기고 나머지를 지운다.
// run/branch/seq는 절대 바꾸지 않는다. 예외를 던지지 않는다.
import { isContinuation, isValidRecord, representative } from "./history";
import type { HistoryModel, LogRecord } from "./types";

/** 이어짐 판단에 쓰이는 이야기 기록(history.ts STORY_TYPES와 같다). */
const STORY_TYPES = new Set(["message", "scroll", "choices", "choice", "picture"]);
/** 남겨야 할 때 고를 이야기 기록 순서(진행도에 덜 끼어드는 것부터). */
const SENTINEL_ORDER = ["picture", "message", "scroll", "choices", "choice"];

export interface PartialBranch {
  /** 대표 갈래 id */
  id: number;
  /** 이 갈래 묶음에서 남는 기록의 가장 큰 seq(구조 유지용 기록 제외) */
  upToSeq: number;
  /** 이 갈래의 앞부분이 필요한 남는 대표 갈래들 */
  neededBy: number[];
}

export interface DeletionPlan {
  /** 남는 기록(원래 순서) */
  kept: LogRecord[];
  /** 지우는 기록(원래 순서) */
  dropped: LogRecord[];
  /** 기록이 하나도 남지 않는 대표 갈래 */
  removedBranches: number[];
  /** 앞부분만 남는 대표 갈래 */
  partialBranches: PartialBranch[];
  /** 통째로 남는 대표 갈래 */
  keptBranches: number[];
  /** 기록이 하나도 남지 않는 모든 갈래 id(이어진 갈래 포함) — meta.json lastStory 정리에 쓴다 */
  removedIds: number[];
  /** 지우는 대사 줄 수(대사·스크롤) */
  removedLines: number;
  /** deleteSet으로 고른 갈래에서 이어져 함께 지워지는 대표 갈래(고른 것 제외) */
  dependents: number[];
}

const EMPTY_PLAN: DeletionPlan = {
  kept: [], dropped: [], removedBranches: [], partialBranches: [], keptBranches: [], removedIds: [], removedLines: 0, dependents: [],
};

/** 대표 갈래 → 묶음 구성원(대표 + 이어진 갈래들). */
function groupsOf(model: HistoryModel): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const id of model.branches.keys()) {
    const rep = representative(model, id);
    const l = out.get(rep);
    if (l) l.push(id); else out.set(rep, [id]);
  }
  return out;
}

/**
 * deleteSet(대표 갈래)과 그 갈래들에서 이어진(갈라져 나온) 모든 대표 갈래. 같은 회차 안에서만 따라간다.
 * 이어진 갈래는 함께 지워져야 한다(그렇지 않으면 지운 갈래의 앞부분이 남는다).
 */
export function deletionClosure(model: HistoryModel, deleteSet: Iterable<number>): Set<number> {
  const out = new Set<number>();
  try {
    const groups = groupsOf(model);
    const stack: number[] = [];
    for (const id of deleteSet) if (model.branches.has(id)) stack.push(representative(model, id));
    while (stack.length > 0) {
      const rep = stack.pop()!;
      if (out.has(rep)) continue;
      out.add(rep);
      for (const member of groups.get(rep) ?? [rep]) {
        const b = model.branches.get(member);
        for (const c of b?.children ?? []) {
          const child = model.branches.get(c);
          if (child && child.run === b!.run) stack.push(representative(model, c));
        }
      }
    }
  } catch { /* 모르는 모양은 건너뛴다 */ }
  return out;
}

/** 남길 대표 갈래 → 갈래별 남길 seq 상한(Infinity = 전부). */
function keepLimits(model: HistoryModel, keep: Set<number>, groups: Map<number, number[]>): Map<number, number> {
  const limits = new Map<number, number>();
  const raise = (id: number, lim: number) => limits.set(id, Math.max(limits.get(id) ?? -Infinity, lim));
  for (const k of keep) {
    for (const id of groups.get(k) ?? []) raise(id, Infinity);
  }
  // 조상: branchPath와 같은 규칙(같은 회차, 이어진 갈래면 부모 전부, 아니면 부모의 fromSeq까지)
  for (const start of [...limits.keys()]) {
    let cur = model.branches.get(start);
    const visited = new Set<number>();
    while (cur && cur.parent !== null && cur.fromSeq !== null && !visited.has(cur.id)) {
      visited.add(cur.id);
      const parent = model.branches.get(cur.parent);
      if (!parent || parent.run !== cur.run) break;
      raise(parent.id, isContinuation(model, cur.id) ? Infinity : cur.fromSeq);
      cur = parent;
    }
  }
  return limits;
}

/**
 * 영구 삭제 계획. keep = 남길 대표 갈래 id(이어진 갈래 id를 주면 그 대표 갈래).
 * 남길 갈래와 그 이어진 갈래들의 기록 전부, 조상 갈래는 필요한 앞부분(가장 늦게 갈라진 저장 지점까지)만 남긴다.
 * 갈래 모양(부모·이어짐)이 바뀌지 않도록, 남는 갈래가 "이어진 갈래"로 잘못 합쳐지지 않게
 * 부모 묶음의 이야기 기록 한 줄(그리고 그 갈래의 시작 기록)을 더 남길 수 있다.
 * 갈래(run/branch)가 없는 기록은 늘 남긴다. model은 buildHistory(records)여야 한다.
 */
export function planDeletion(records: LogRecord[], model: HistoryModel, keepIds: Iterable<number>): DeletionPlan {
  try {
    const recs = Array.isArray(records) ? records : [];
    const groups = groupsOf(model);
    const keep = new Set<number>();
    for (const id of keepIds) if (model.branches.has(id)) keep.add(representative(model, id));
    const limits = keepLimits(model, keep, groups);

    const branchOf = (r: LogRecord): number | null =>
      isValidRecord(r) && typeof r.run === "number" && r.run > 0 && typeof r.branch === "number" && r.branch > 0 && model.branches.has(r.branch)
        ? r.branch : null;
    const keepMask = recs.map(r => {
      const b = branchOf(r);
      if (b === null) return true;
      const lim = limits.get(b);
      return lim !== undefined && r.seq <= lim;
    });

    // 구조 유지: 남는, 이어진 갈래가 아닌 갈래 K의 부모 묶음에 (K.fromSeq, K.startSeq) 사이 이야기 기록이 남아야
    // 다시 읽었을 때도 K가 따로 보인다(history.ts 이어짐 규칙).
    const indexBySeq = new Map<number, number[]>();
    recs.forEach((r, i) => {
      if (branchOf(r) === null) return;
      const l = indexBySeq.get(r.seq);
      if (l) l.push(i); else indexBySeq.set(r.seq, [i]);
    });
    const startIndex = new Map<number, number>();   // 갈래 → 첫 기록 위치(startSeq)
    recs.forEach((r, i) => {
      const b = branchOf(r);
      if (b === null) return;
      const info = model.branches.get(b)!;
      if (r.seq === info.startSeq && !startIndex.has(b)) startIndex.set(b, i);
    });
    const keptIds = [...limits.keys()].sort((a, b) => (model.branches.get(a)!.startSeq - model.branches.get(b)!.startSeq));
    for (const kid of keptIds) {
      const k = model.branches.get(kid)!;
      if (k.parent === null || k.fromSeq === null || isContinuation(model, kid)) continue;
      const parent = model.branches.get(k.parent);
      if (!parent || parent.run !== k.run || !limits.has(parent.id)) continue;
      const rep = representative(model, parent.id);
      const members = new Set(groups.get(rep) ?? [rep]);
      const lo = k.fromSeq, hi = k.startSeq;
      const inWindow = (i: number) => {
        const r = recs[i];
        const b = branchOf(r);
        return b !== null && members.has(b) && STORY_TYPES.has(r.type) && r.seq > lo && r.seq < hi;
      };
      let ok = false;
      for (let i = 0; i < recs.length && !ok; i++) if (keepMask[i] && inWindow(i)) ok = true;
      if (ok) continue;
      // 고를 기록: 종류 순서대로 창 안 첫 기록
      let pick = -1;
      for (const type of SENTINEL_ORDER) {
        for (let i = 0; i < recs.length; i++) if (recs[i].type === type && inWindow(i)) { pick = i; break; }
        if (pick >= 0) break;
      }
      if (pick < 0) continue;   // 원래도 없었다(이 경우 원래 모델에서도 이어짐 판단이 같다)
      keepMask[pick] = true;
      // 그 기록의 갈래가 다시 같은 묶음으로 보이도록 시작 기록을 묶음 대표까지 남긴다
      let cur = model.branches.get(recs[pick].branch);
      const seen = new Set<number>();
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        const si = startIndex.get(cur.id);
        if (si !== undefined) keepMask[si] = true;
        if (cur.id === rep || cur.parent === null) break;
        cur = model.branches.get(cur.parent);
      }
    }

    const kept: LogRecord[] = [];
    const dropped: LogRecord[] = [];
    recs.forEach((r, i) => (keepMask[i] ? kept : dropped).push(r));

    // 갈래별 남은 기록 수·최대 seq
    const keptCount = new Map<number, number>();
    const keptMax = new Map<number, number>();
    const droppedCount = new Map<number, number>();
    recs.forEach((r, i) => {
      const b = branchOf(r);
      if (b === null) return;
      if (keepMask[i]) {
        keptCount.set(b, (keptCount.get(b) ?? 0) + 1);
        if (limits.has(b) && r.seq <= limits.get(b)!) keptMax.set(b, Math.max(keptMax.get(b) ?? -Infinity, r.seq));
      } else {
        droppedCount.set(b, (droppedCount.get(b) ?? 0) + 1);
      }
    });

    const removedIds = [...model.branches.keys()].filter(id => (keptCount.get(id) ?? 0) === 0).sort((a, b) => a - b);
    const removedBranches: number[] = [];
    const keptBranches: number[] = [];
    const partialBranches: PartialBranch[] = [];
    for (const [rep, members] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
      const any = members.some(id => (keptCount.get(id) ?? 0) > 0);
      const lost = members.some(id => (droppedCount.get(id) ?? 0) > 0);
      if (!any) removedBranches.push(rep);
      else if (keep.has(rep) || !lost) keptBranches.push(rep);
      else {
        const upToSeq = Math.max(-Infinity, ...members.map(id => keptMax.get(id) ?? -Infinity));
        partialBranches.push({ id: rep, upToSeq: Number.isFinite(upToSeq) ? upToSeq : 0, neededBy: [] });
      }
    }
    // 앞부분이 필요한 남는 갈래: 남길 대표 갈래에서 조상으로 올라가며 만나는 부분 갈래
    const partialById = new Map(partialBranches.map(p => [p.id, p]));
    for (const k of keep) {
      let cur = model.branches.get(k);
      const visited = new Set<number>();
      while (cur && cur.parent !== null && !visited.has(cur.id)) {
        visited.add(cur.id);
        const parent = model.branches.get(cur.parent);
        if (!parent || parent.run !== cur.run) break;
        const p = partialById.get(representative(model, parent.id));
        if (p && !p.neededBy.includes(k)) p.neededBy.push(k);
        cur = parent;
      }
    }
    for (const p of partialBranches) p.neededBy.sort((a, b) => a - b);

    const removedLines = dropped.reduce((n, r) => n + (r.type === "message" || r.type === "scroll" ? 1 : 0), 0);
    return { kept, dropped, removedBranches, partialBranches, keptBranches, removedIds, removedLines, dependents: [] };
  } catch {
    return { ...EMPTY_PLAN, kept: Array.isArray(records) ? records.slice() : [] };
  }
}

/**
 * 고른 대표 갈래들을 지우는 계획(나머지는 모두 남긴다). 고른 갈래에서 이어진 갈래도 함께 지운다(dependents).
 */
export function planDeleteSet(records: LogRecord[], model: HistoryModel, deleteSet: Iterable<number>): DeletionPlan {
  try {
    const chosen = new Set<number>();
    for (const id of deleteSet) if (model.branches.has(id)) chosen.add(representative(model, id));
    const closure = deletionClosure(model, chosen);
    const keep: number[] = [];
    for (const id of model.branches.keys()) {
      const rep = representative(model, id);
      if (rep === id && !closure.has(rep)) keep.push(rep);
    }
    const plan = planDeletion(records, model, keep);
    plan.dependents = [...closure].filter(id => !chosen.has(id)).sort((a, b) => a - b);
    return plan;
  } catch {
    return { ...EMPTY_PLAN, kept: Array.isArray(records) ? records.slice() : [] };
  }
}
