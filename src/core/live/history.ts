import { locationKey } from "../index/locations";
import type { Location } from "../types";
import type { BranchInfo, HistoryItem, HistoryModel, LogRecord, RecordOf, StateChange } from "./types";

const NOISY_WINDOW_MS = 60_000;
const NOISY_MAX_CHANGES = 10;

function isValid(r: unknown): r is LogRecord {
  return typeof r === "object" && r !== null && typeof (r as LogRecord).seq === "number" && Number.isFinite((r as LogRecord).seq);
}
function num(x: unknown): number { return typeof x === "number" && Number.isFinite(x) ? x : 0; }
function bySeq(records: LogRecord[]): LogRecord[] {
  return records.filter(isValid).sort((a, b) => a.seq - b.seq);
}

/** 기록에서 회차·갈래 모델을 만든다. run/branch 0 기록은 무시. 예외를 던지지 않는다. */
export function buildHistory(records: LogRecord[]): HistoryModel {
  const branches = new Map<number, BranchInfo>();
  const runBranches = new Map<number, number[]>();
  let latestBranch: number | null = null;
  for (const r of bySeq(Array.isArray(records) ? records : [])) {
    const run = num(r.run), id = num(r.branch);
    if (run <= 0 || id <= 0) continue;
    const t = num(r.t);
    let b = branches.get(id);
    if (!b) {
      const start = r.type === "branchStart" ? r : null;
      const reason = start && (start.reason === "newGame" || start.reason === "load") ? start.reason : "unknownSave";
      b = {
        id, run,
        parent: start && typeof start.parentBranch === "number" ? start.parentBranch : null,
        fromSeq: start && typeof start.fromSeq === "number" ? start.fromSeq : null,
        reason, startSeq: r.seq, startT: t, lastSeq: r.seq, lastT: t, children: [],
      };
      branches.set(id, b);
      const list = runBranches.get(run) ?? [];
      list.push(id);
      runBranches.set(run, list);
      const parent = b.parent !== null ? branches.get(b.parent) : undefined;
      if (parent && parent.id !== id && parent.run === run) parent.children.push(id);
    } else {
      b.lastSeq = Math.max(b.lastSeq, r.seq);
      b.lastT = Math.max(b.lastT, t);
    }
    latestBranch = id;
  }
  const runs = [...runBranches.entries()].sort((a, b) => a[0] - b[0]).map(([run, ids]) => ({ run, branches: ids }));
  return { branches, runs, latestBranch };
}

/** `{run}회차 갈래 {n}` — n은 run 안에서 생성 순서(1부터). */
export function branchLabel(model: HistoryModel, branchId: number): string {
  const b = model.branches.get(branchId);
  if (!b) return `갈래 ${branchId}`;
  const n = (model.runs.find(r => r.run === b.run)?.branches.indexOf(branchId) ?? -1) + 1;
  return `${b.run}회차 갈래 ${n > 0 ? n : branchId}`;
}

/** 같은 run의 조상 갈래 기록(각각 자식의 fromSeq 이하) + 자기 기록, seq 순. */
export function branchPath(records: LogRecord[], model: HistoryModel, branchId: number): LogRecord[] {
  const self = model.branches.get(branchId);
  if (!self || !Array.isArray(records)) return [];
  const limits = new Map<number, number>([[self.id, Infinity]]);
  let cur = self;
  while (cur.parent !== null && cur.fromSeq !== null) {
    const parent = model.branches.get(cur.parent);
    if (!parent || parent.run !== self.run || limits.has(parent.id)) break;
    limits.set(parent.id, cur.fromSeq);
    cur = parent;
  }
  return bySeq(records).filter(r => r.run === self.run && limits.has(r.branch) && r.seq <= limits.get(r.branch)!);
}

function variableChanges(r: LogRecord): { id: number; t: number }[] {
  if (r.type !== "state" || !Array.isArray(r.changes)) return [];
  const out: { id: number; t: number }[] = [];
  for (const c of r.changes) {
    if (!c || c.kind !== "variable") continue;
    const id = Number(c.id);
    if (Number.isFinite(id)) out.push({ id, t: num(r.t) });
  }
  return out;
}

/** 어떤 60초 창 안에서 10회 넘게 바뀐 변수 id. */
export function noisyVariables(records: LogRecord[]): Set<number> {
  const times = new Map<number, number[]>();
  for (const r of Array.isArray(records) ? records : []) {
    if (!isValid(r)) continue;
    for (const { id, t } of variableChanges(r)) {
      const list = times.get(id) ?? [];
      list.push(t);
      times.set(id, list);
    }
  }
  const noisy = new Set<number>();
  for (const [id, list] of times) {
    if (list.length <= NOISY_MAX_CHANGES) continue;
    list.sort((a, b) => a - b);
    for (let i = 0, j = 0; j < list.length; j++) {
      while (list[j] - list[i] >= NOISY_WINDOW_MS) i++;
      if (j - i + 1 > NOISY_MAX_CHANGES) { noisy.add(id); break; }
    }
  }
  return noisy;
}

const EPISODE_TYPES = new Set(["message", "scroll", "choices", "choice", "picture"]);
const TALK_TYPES = new Set(["message", "scroll", "choices", "choice"]);
type EpisodeRecord = RecordOf<"message" | "scroll" | "choices" | "choice" | "picture">;

function srcKey(src: Location | null | undefined): string | null {
  if (!src || typeof src !== "object") return null;
  try { return locationKey(src) ?? JSON.stringify(src); } catch { return null; }
}

interface Episode { key: string | null; lastCmd: number; records: EpisodeRecord[] }

/** 경로 기록을 화면용 타임라인으로 접는다(반복 대화, 상태 변경 묶음, 잦은 변수 제외, 갈래 지점). */
export function foldTimeline(path: LogRecord[], model: HistoryModel, opts: { uncertainSeqs?: Set<number> }): HistoryItem[] {
  const records = bySeq(Array.isArray(path) ? path : []);
  const uncertain = (seq: number) => opts?.uncertainSeqs?.has(seq) ?? false;
  const noisy = noisyVariables(records);

  // 갈래 지점: `${parent}:${fromSeq}` → 그 지점에서 갈라진 자식 갈래들
  const forkChildren = new Map<string, number[]>();
  for (const b of model?.branches?.values() ?? []) {
    if (b.parent === null || b.fromSeq === null) continue;
    const parent = model.branches.get(b.parent);
    if (!parent || parent.run !== b.run) continue;
    const k = `${b.parent}:${b.fromSeq}`;
    forkChildren.set(k, [...(forkChildren.get(k) ?? []), b.id]);
  }
  const pathBranches = new Set(records.map(r => r.branch));

  const items: HistoryItem[] = [];
  const seenSignatures = new Set<string>();
  let lastRepeatKey: string | null = null;   // 마지막 항목이 반복 항목일 때 그 시그니처
  let episode: Episode | null = null;
  let lastEpisode: { key: string | null; talk: boolean } | null = null;
  let group: RecordOf<"state">[] = [];

  const push = (item: HistoryItem) => { items.push(item); lastRepeatKey = null; };
  const pushRecord = (record: LogRecord) => push({ kind: "record", record, uncertain: uncertain(record.seq) });

  const flushGroup = () => {
    if (group.length === 0) return;
    push({ kind: "stateGroup", records: group, count: group.reduce((n, r) => n + r.changes.length, 0) });
    group = [];
  };

  const flushEpisode = () => {
    const ep = episode;
    if (!ep) return;
    episode = null;
    const messages = ep.records.filter((r): r is RecordOf<"message"> => r.type === "message");
    const hasChoice = ep.records.some(r => r.type === "choices" || r.type === "choice");
    const signature = ep.key !== null && messages.length > 0 ? `${ep.key}|${messages.map(m => m.cmd).join(",")}` : null;
    const foldable = signature !== null && !hasChoice && seenSignatures.has(signature)
      && !ep.records.some(r => uncertain(r.seq));
    if (foldable) {
      const last = items[items.length - 1];
      if (last?.kind === "repeat" && lastRepeatKey === signature) last.count++;
      else { push({ kind: "repeat", record: messages[0], count: 1 }); lastRepeatKey = signature; }
    } else {
      for (const r of ep.records) pushRecord(r);
    }
    if (signature !== null) seenSignatures.add(signature);
    lastEpisode = { key: ep.key, talk: ep.records.some(r => TALK_TYPES.has(r.type)) };
  };

  for (const r of records) {
    if (EPISODE_TYPES.has(r.type)) {
      const er = r as EpisodeRecord;
      flushGroup();
      const key = srcKey(er.src);
      const cmd = num(er.cmd);
      if (episode && key !== null && key === episode.key && cmd > episode.lastCmd) {
        episode.records.push(er);
        episode.lastCmd = cmd;
      } else {
        flushEpisode();
        episode = { key, lastCmd: cmd, records: [er] };
      }
    } else if (r.type === "state") {
      flushEpisode();
      const original: StateChange[] = Array.isArray(r.changes) ? r.changes : [];
      const changes = original.filter(c => !(c && c.kind === "variable" && noisy.has(Number(c.id))));
      if (changes.length > 0) {
        const rec: RecordOf<"state"> = changes.length === original.length && original === r.changes ? r : { ...r, changes };
        const key = srcKey(r.src);
        // flushEpisode가 클로저 안에서 갱신하므로 TS 좁히기를 피해 명시적 타입으로 읽는다
        const prev = lastEpisode as { key: string | null; talk: boolean } | null;
        if (prev?.talk && key !== null && key === prev.key) {
          flushGroup();
          pushRecord(rec);
        } else {
          group.push(rec);
        }
      }
    } else {
      flushEpisode();
      flushGroup();
      pushRecord(r);
      lastEpisode = null;
    }

    const children = forkChildren.get(`${r.branch}:${r.seq}`);
    if (children) {
      flushEpisode();
      flushGroup();
      const all = [r.branch, ...children];
      const next = children.find(id => pathBranches.has(id)) ?? r.branch;
      const rest = [...new Set(all.filter(id => id !== next))].sort((a, b) => a - b);
      push({ kind: "fork", atSeq: r.seq, branches: [next, ...rest] });
    }
  }
  flushEpisode();
  flushGroup();
  return items;
}
