import { locationKey } from "../index/locations";
import type { Location } from "../types";
import type { BranchInfo, HistoryItem, HistoryModel, LogRecord, RecordOf, StateChange } from "./types";

export const NOISY_WINDOW_MS = 60_000;
export const NOISY_MAX_CHANGES = 10;

/** seq가 유한한 숫자인 객체 기록인가(buildHistory·noisyVariables가 받는 기록). */
export const isValidRecord = (r: unknown): r is LogRecord => isValid(r);
function isValid(r: unknown): r is LogRecord {
  return typeof r === "object" && r !== null && typeof (r as LogRecord).seq === "number" && Number.isFinite((r as LogRecord).seq);
}
function num(x: unknown): number { return typeof x === "number" && Number.isFinite(x) ? x : 0; }
/** 유효한 기록만 seq 순으로. 이미 순서대로면(O(n) 확인) 정렬을 건너뛰고, 모두 유효하면 복사도 하지 않는다. */
function bySeq(records: LogRecord[]): LogRecord[] {
  let allValid = true, ordered = true, prev = -Infinity;
  for (const r of records) {
    if (!isValid(r)) { allValid = false; continue; }
    if (r.seq < prev) ordered = false;
    prev = r.seq;
  }
  const valid = allValid ? records : records.filter(isValid);
  if (ordered) return valid;
  return (allValid ? valid.slice() : valid).sort((a, b) => a.seq - b.seq);
}

/** 이야기 기록(이어짐 판단에 쓰인다): 대화·스크롤·선택지·선택·그림. */
const STORY_TYPES = new Set(["message", "scroll", "choices", "choice", "picture"]);

/**
 * buildHistory의 진행 상태. 증분 누적기와 공유한다.
 * runBranches: 회차별 대표 갈래(이어진 갈래 제외). alias: 이어진 갈래 → 대표 갈래.
 * storyMax: 대표 갈래 → 그 묶음(대표 + 이어진 갈래들)의 이야기 기록 최대 seq.
 */
export interface HistoryState {
  branches: Map<number, BranchInfo>; runBranches: Map<number, number[]>; latestBranch: number | null;
  alias: Map<number, number>; storyMax: Map<number, number>;
}
export const newHistoryState = (): HistoryState => ({
  branches: new Map(), runBranches: new Map(), latestBranch: null, alias: new Map(), storyMax: new Map(),
});

/** 유효한 기록(isValidRecord) 하나를 seq 순으로 반영한다. run/branch 0 기록은 무시. */
export function applyHistoryRecord(st: HistoryState, r: LogRecord): void {
  const run = num(r.run), id = num(r.branch);
  if (run <= 0 || id <= 0) return;
  const t = num(r.t);
  let b = st.branches.get(id);
  if (!b) {
    const start = r.type === "branchStart" ? r : null;
    const reason = start && (start.reason === "newGame" || start.reason === "load") ? start.reason : "unknownSave";
    b = {
      id, run,
      parent: start && typeof start.parentBranch === "number" ? start.parentBranch : null,
      fromSeq: start && typeof start.fromSeq === "number" ? start.fromSeq : null,
      reason, startSeq: r.seq, startT: t, lastSeq: r.seq, lastT: t, children: [],
    };
    st.branches.set(id, b);
    const parent = b.parent !== null ? st.branches.get(b.parent) : undefined;
    if (parent && parent.id !== id && parent.run === run) {
      parent.children.push(id);
      // 이어짐: 불러오기로 시작했고, 부모가 속한 대표 갈래 묶음 전체(대표 + 이어진 갈래들, 형제 포함)에
      // 저장 지점(fromSeq) 뒤 이야기 기록이 없다.
      // 갈래가 시작되는 순간에 한 번 정하고 바꾸지 않는다(seq 순 처리라 일괄·증분이 같다).
      const rep = st.alias.get(parent.id) ?? parent.id;
      if (b.reason === "load" && b.fromSeq !== null && (st.storyMax.get(rep) ?? -Infinity) <= b.fromSeq) {
        st.alias.set(id, rep);
      }
    }
    if (!st.alias.has(id)) {
      const list = st.runBranches.get(run) ?? [];
      list.push(id);
      st.runBranches.set(run, list);
    }
  } else {
    b.lastSeq = Math.max(b.lastSeq, r.seq);
    b.lastT = Math.max(b.lastT, t);
  }
  const rep = st.alias.get(id) ?? id;
  if (STORY_TYPES.has(r.type)) st.storyMax.set(rep, Math.max(st.storyMax.get(rep) ?? -Infinity, r.seq));
  st.latestBranch = rep;
}

/** 진행 상태에서 모델을 만든다(내부 Map·배열을 그대로 쓴다). */
export function historyModelOf(st: HistoryState): HistoryModel {
  const runs = [...st.runBranches.entries()].sort((a, b) => a[0] - b[0]).map(([run, ids]) => ({ run, branches: ids }));
  return { branches: st.branches, runs, alias: st.alias, latestBranch: st.latestBranch };
}

/** 기록을 seq 순으로 모두 반영한 진행 상태. */
export function buildHistoryState(records: LogRecord[]): HistoryState {
  const st = newHistoryState();
  for (const r of bySeq(Array.isArray(records) ? records : [])) applyHistoryRecord(st, r);
  return st;
}

/** 기록에서 회차·갈래 모델을 만든다. run/branch 0 기록은 무시. 예외를 던지지 않는다. */
export function buildHistory(records: LogRecord[]): HistoryModel {
  return historyModelOf(buildHistoryState(records));
}

/**
 * 갈래를 화면에 보일 대표 갈래 id로 바꾼다. 이어진 갈래(저장 → 종료 → 이어하기로 생긴 갈래)는
 * 이어 간 원래 갈래(사슬이면 맨 위)로, 그 밖의 갈래와 모르는 id는 그대로.
 */
export function representative(model: HistoryModel, branchId: number): number {
  return model.alias?.get(branchId) ?? branchId;
}

/** `{run}회차 갈래 {n}` — n은 run 안에서 대표 갈래의 생성 순서(1부터). 이어진 갈래는 대표 갈래의 이름. */
export function branchLabel(model: HistoryModel, branchId: number): string {
  const id = representative(model, branchId);
  const b = model.branches.get(id);
  if (!b) return `갈래 ${branchId}`;
  const n = (model.runs.find(r => r.run === b.run)?.branches.indexOf(id) ?? -1) + 1;
  return `${b.run}회차 갈래 ${n > 0 ? n : id}`;
}

/**
 * 이어진 갈래(저장 → 종료 → 이어하기)라 대표 갈래에 합쳐지는가. 화면은 이런 갈래의 시작을
 * 새 갈래 시작이 아니라 `— 이어하기 —` 같은 구분으로 보이면 된다.
 */
export function isContinuation(model: HistoryModel, branchId: number): boolean {
  return model?.alias?.has(branchId) ?? false;
}

/**
 * 대표 갈래의 이야기 전체, seq 순: 대표 갈래와 그 이어진 후손 갈래들의 기록 전부 +
 * 같은 run의 조상 갈래 기록(각각 자식의 fromSeq 이하, 자식이 이어진 갈래면 조상 기록 전부).
 * 이어진 갈래 id를 주면 그 대표 갈래의 결과와 같다.
 */
export function branchPath(records: LogRecord[], model: HistoryModel, branchId: number): LogRecord[] {
  const self = model.branches.get(representative(model, branchId));
  if (!self || !Array.isArray(records)) return [];
  const limits = new Map<number, number>();
  // 대표 갈래와 이어진 후손들
  const stack = [self.id];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (limits.has(id)) continue;
    limits.set(id, Infinity);
    for (const c of model.branches.get(id)?.children ?? []) if (isContinuation(model, c)) stack.push(c);
  }
  // 조상
  let cur = self;
  while (cur.parent !== null && cur.fromSeq !== null) {
    const parent = model.branches.get(cur.parent);
    if (!parent || parent.run !== self.run || limits.has(parent.id)) break;
    limits.set(parent.id, isContinuation(model, cur.id) ? Infinity : cur.fromSeq);
    cur = parent;
  }
  return bySeq(records).filter(r => r.run === self.run && limits.has(r.branch) && r.seq <= limits.get(r.branch)!);
}

/**
 * state 기록의 변수 변경(id, 시각, 플러그인 조절 여부). noisyVariables와 증분 누적기가 공유한다.
 * throttled가 참인 변경이 하나라도 있으면 그 변수는 횟수와 관계없이 잦은 변수다.
 */
export function variableChanges(r: LogRecord): { id: number; t: number; throttled: boolean }[] {
  if (r.type !== "state" || !Array.isArray(r.changes)) return [];
  const out: { id: number; t: number; throttled: boolean }[] = [];
  for (const c of r.changes) {
    if (!c || c.kind !== "variable") continue;
    const id = Number(c.id);
    if (Number.isFinite(id)) out.push({ id, t: num(r.t), throttled: c.throttled === true });
  }
  return out;
}

/** 어떤 60초 창 안에서 10회 넘게 바뀌었거나, 플러그인이 조절한(throttled) 변경이 있는 변수 id. */
export function noisyVariables(records: LogRecord[]): Set<number> {
  const times = new Map<number, number[]>();
  const noisy = new Set<number>();
  for (const r of Array.isArray(records) ? records : []) {
    if (!isValid(r)) continue;
    for (const { id, t, throttled } of variableChanges(r)) {
      if (throttled) noisy.add(id);
      const list = times.get(id) ?? [];
      list.push(t);
      times.set(id, list);
    }
  }
  for (const [id, list] of times) {
    if (noisy.has(id) || list.length <= NOISY_MAX_CHANGES) continue;
    list.sort((a, b) => a - b);
    for (let i = 0, j = 0; j < list.length; j++) {
      while (list[j] - list[i] >= NOISY_WINDOW_MS) i++;
      if (j - i + 1 > NOISY_MAX_CHANGES) { noisy.add(id); break; }
    }
  }
  return noisy;
}

// 플러그인 명령은 이야기 기록이 아니지만, 같은 페이지 대화 사이에 끼면 대화(반복 묶음)를 끊지 않도록 에피소드에 넣는다
const EPISODE_TYPES = new Set(["message", "scroll", "choices", "choice", "picture", "plugin"]);
const TALK_TYPES = new Set(["message", "scroll", "choices", "choice"]);
type EpisodeRecord = RecordOf<"message" | "scroll" | "choices" | "choice" | "picture" | "plugin">;

function srcKey(src: Location | null | undefined): string | null {
  if (!src || typeof src !== "object") return null;
  try { return locationKey(src) ?? JSON.stringify(src); } catch { return null; }
}

interface Episode { key: string | null; lastCmd: number; records: EpisodeRecord[] }

/** 전투 묶음을 끊는 기록(전투 끝 기록이 없을 때): 갈래 시작·장소 이동·불러오기·다음 전투 시작 */
const BATTLE_STOP = new Set(["branchStart", "transfer", "load", "save"]);

/** 같은 전투인지 보는 열쇠(적 무리·결과·전투 로그·대사). 선택이 있거나 끝나지 않은 전투는 null(접지 않는다). */
function battleSignature(start: RecordOf<"battle">, end: RecordOf<"battle"> | null, inner: LogRecord[]): string | null {
  if (!end) return null;
  const parts: string[] = [];
  for (const r of inner) {
    if (r.type === "choices" || r.type === "choice") return null;
    if (r.type === "battlelog" || r.type === "message" || r.type === "scroll") {
      // 1.8.1 사용 줄: 같은 글이어도 쓴 쪽·기술이 다르면 다른 전투
      const who = r.type === "battlelog" && r.kind === "action" ? `${String(r.by ?? "")}>${String(r.item ?? "")}>` : "";
      parts.push(`${r.type}:${who}${typeof r.text === "string" ? r.text : ""}`);
    }
  }
  return `${num(start.troopId)}|${String(end.result ?? "")}|${JSON.stringify(parts)}`;
}

/** 경로 기록을 화면용 타임라인으로 접는다(반복 대화, 상태 변경 묶음, 잦은 변수 제외, 갈래 지점, 전투 묶음). */
/** opts.noisy: 기록 전체 기준 잦은 변수(noisyVariables(전체 기록)). 없으면 경로에서 계산한다. */
export function foldTimeline(
  path: LogRecord[], model: HistoryModel, opts: { uncertainSeqs?: Set<number>; changedSeqs?: Set<number>; noisy?: Set<number> },
): HistoryItem[] {
  return fold(path, model, opts, false);
}

function fold(
  path: LogRecord[], model: HistoryModel, opts: { uncertainSeqs?: Set<number>; changedSeqs?: Set<number>; noisy?: Set<number> },
  nested: boolean,
): HistoryItem[] {
  const records = bySeq(Array.isArray(path) ? path : []);
  const uncertain = (seq: number) => opts?.uncertainSeqs?.has(seq) ?? false;
  const changed = (seq: number) => opts?.changedSeqs?.has(seq) ?? false;
  const noisy = opts?.noisy instanceof Set ? opts.noisy : noisyVariables(records);

  // 갈래 지점: `${parent}:${fromSeq}` → 그 지점에서 갈라진 자식 갈래들(이어진 갈래는 갈래 지점이 아니다)
  const forkChildren = new Map<string, number[]>();
  for (const b of model?.branches?.values() ?? []) {
    if (b.parent === null || b.fromSeq === null || isContinuation(model, b.id)) continue;
    const parent = model.branches.get(b.parent);
    if (!parent || parent.run !== b.run) continue;
    const k = `${b.parent}:${b.fromSeq}`;
    forkChildren.set(k, [...(forkChildren.get(k) ?? []), b.id]);
  }
  // 갈래 지점의 갈래들은 대표 갈래 id로 보인다
  const rep = (id: number) => (model ? representative(model, id) : id);
  const pathBranches = new Set(records.map(r => rep(r.branch)));

  const items: HistoryItem[] = [];
  const seenSignatures = new Set<string>();
  let lastRepeatKey: string | null = null;   // 마지막 항목이 반복 항목일 때 그 시그니처
  let episode: Episode | null = null;
  let lastEpisode: { key: string | null; talk: boolean } | null = null;
  let group: RecordOf<"state">[] = [];

  const push = (item: HistoryItem) => { items.push(item); lastRepeatKey = null; };
  const pushRecord = (record: LogRecord) => push({ kind: "record", record, uncertain: uncertain(record.seq), changed: changed(record.seq) });

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
    if (signature !== null && !ep.records.some(r => uncertain(r.seq))) seenSignatures.add(signature);
    lastEpisode = { key: ep.key, talk: ep.records.some(r => TALK_TYPES.has(r.type)) };
  };

  const seenBattles = new Set<string>();
  const forkAt = (r: LogRecord) => {
    const children = forkChildren.get(`${r.branch}:${r.seq}`);
    if (!children) return;
    flushEpisode();
    flushGroup();
    const own = rep(r.branch);
    const all = [own, ...children];
    const next = children.find(id => pathBranches.has(id)) ?? own;
    const rest = [...new Set(all.filter(id => id !== next))].sort((a, b) => a - b);
    push({ kind: "fork", atSeq: r.seq, branches: [next, ...rest] });
  };

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!nested && r.type === "battle" && r.phase === "start") {
      // 전투 한 번을 묶는다: 끝 기록까지(없으면 다음 전투·갈래 시작·이동·불러오기 앞까지)
      let j = i + 1;
      let end: RecordOf<"battle"> | null = null;
      while (j < records.length) {
        const x = records[j];
        if (x.type === "battle") { if (x.phase === "end") { end = x; j++; } break; }
        if (BATTLE_STOP.has(x.type)) break;
        j++;
      }
      const inner = records.slice(i + 1, end ? j - 1 : j);
      flushEpisode();
      flushGroup();
      const sub = fold(inner, model, { ...opts, noisy }, true);
      const logLines = inner.reduce((n, x) => n + (x.type === "battlelog" ? 1 : 0), 0);
      const signature = inner.some(x => uncertain(x.seq)) ? null : battleSignature(r, end, inner);
      const last = items[items.length - 1];
      if (signature !== null && seenBattles.has(signature)) {
        if (last?.kind === "battle" && last.repeat > 0 && lastRepeatKey === signature) last.repeat++;
        else { push({ kind: "battle", start: r, end, items: sub, logLines, repeat: 1 }); lastRepeatKey = signature; }
      } else {
        push({ kind: "battle", start: r, end, items: sub, logLines, repeat: 0 });
      }
      if (signature !== null) seenBattles.add(signature);
      lastEpisode = null;
      forkAt(r);
      if (end) forkAt(end);
      i = j - 1;
      continue;
    }
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
      const original: StateChange[] = Array.isArray(r.changes) ? r.changes : [];
      const changes = original.filter(c => !(c && c.kind === "variable" && noisy.has(Number(c.id))));
      // 잦은 변수만 바꾼 기록은 화면에서 사라지므로 에피소드·묶음도 끊지 않는다
      if (changes.length > 0) {
        flushEpisode();
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

    forkAt(r);
  }
  flushEpisode();
  flushGroup();
  return items;
}
