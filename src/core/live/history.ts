import { locationKey } from "../index/locations";
import type { Location } from "../types";
import { extendsArray } from "./lineage";
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

/**
 * bySeq(records)와 같다. prev가 앞의 bySeq 결과이고 records가 그것에 덧붙기만 했으면(줄기 표시, core/live/lineage)
 * 새로 붙은 기록만 확인한다(줄기 표시가 있는 prev는 bySeq가 받은 배열을 그대로 돌려준 것 — 모두 유효하고 seq 순이다).
 */
function bySeqFrom(records: LogRecord[], prev: LogRecord[] | null): LogRecord[] {
  if (!prev || !extendsArray(prev, records)) return bySeq(records);
  let last = prev.length > 0 ? prev[prev.length - 1].seq : -Infinity;
  for (let i = prev.length; i < records.length; i++) {
    const r = records[i];
    if (!isValid(r) || r.seq < last) return bySeq(records);
    last = r.seq;
  }
  return records;
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
  const lim = branchLimits(model, branchId);
  if (!lim || !Array.isArray(records)) return [];
  const { run, limits } = lim;
  return bySeq(records).filter(r => inBranchPath(r, run, limits));
}

/** branchPath에 들어가는 기록인가(유효한 기록, branchLimits의 run·limits) */
export function inBranchPath(r: LogRecord, run: number, limits: ReadonlyMap<number, number>): boolean {
  if (r.run !== run) return false;
  const l = limits.get(r.branch);
  return l !== undefined && r.seq <= l;
}

/** branchPath가 고르는 기록의 회차와 갈래별 seq 한계(대표 갈래·이어진 후손 = Infinity, 조상 = 자식의 fromSeq). 갈래가 없으면 null. */
export function branchLimits(model: HistoryModel, branchId: number): { run: number; limits: Map<number, number> } | null {
  const self = model?.branches?.get(representative(model, branchId));
  if (!self) return null;
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
  return { run: self.run, limits };
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

/** records: 대화 기록과 그 사이 화면 기록(1.10.0) */
interface Episode { key: string | null; lastCmd: number; records: (EpisodeRecord | RecordOf<"screen">)[] }

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
    } else if (r.type === "notice") {
      // 1.9.0 알림 문구(캐릭터 대사 등)도 같은 전투인지 보는 데 넣는다
      parts.push(`notice:${typeof r.text === "string" ? r.text : ""}`);
    }
  }
  return `${num(start.troopId)}|${String(end.result ?? "")}|${JSON.stringify(parts)}`;
}

/** 경로 기록을 화면용 타임라인으로 접는다(반복 대화, 상태 변경 묶음, 잦은 변수 제외, 갈래 지점, 전투 묶음). */
/** opts.noisy: 기록 전체 기준 잦은 변수(noisyVariables(전체 기록)). 없으면 경로에서 계산한다. */
export function foldTimeline(path: LogRecord[], model: HistoryModel, opts: FoldOptions): HistoryItem[] {
  return fold(path, model, opts, false);
}

/** foldTimeline 설정. isHiddenImage: 읽기에서 숨긴 그림(반복 대화의 그림 비교에서 뺀다) */
export interface FoldOptions {
  uncertainSeqs?: Set<number>; changedSeqs?: Set<number>; noisy?: Set<number>;
  isHiddenImage?: ((name: string) => boolean) | null;
}

/**
 * 대화 한 번에 보인 그림 이름들(그림 표시 명령·화면 기록·대사 그림, 숨긴 그림 제외)을 정렬해 이은 열쇠.
 * 글이 같아도 그림이 다르면 다른 대화로 본다(접지 않는다).
 */
export function episodePictureKey(records: readonly LogRecord[], hidden?: ((name: string) => boolean) | null): string {
  const names = new Set<string>();
  const add = (n: unknown) => {
    if (typeof n !== "string" || n === "") return;
    try { if (hidden && hidden(n)) return; } catch { /* 그대로 */ }
    names.add(n);
  };
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || typeof r !== "object") continue;
    if (r.type === "picture") { if (r.op === undefined) add(r.name); continue; }
    const pics = (r as { pics?: unknown }).pics;
    if (Array.isArray(pics)) for (const e of pics) if (Array.isArray(e)) add(e[1]);
  }
  return [...names].sort().join("\n");
}

/** 접기에 쓰는 고정된 것(경로·모델·설정에서 만든다) */
interface FoldEnv {
  model: HistoryModel; opts: FoldOptions; noisy: Set<number>; nested: boolean;
  /** 갈래 지점: `${parent}:${fromSeq}` → 그 지점에서 갈라진 자식 갈래들 */
  forkChildren: Map<string, number[]>;
  rep: (id: number) => number;
  /** 경로에 기록이 있는 대표 갈래들 */
  pathBranches: Set<number>;
  uncertain: (seq: number) => boolean;
  changed: (seq: number) => boolean;
}

/**
 * 접는 중인 상태. 이어 접기(foldTimelineFrom)는 이것을 보관했다가 새 기록만 더 접는다.
 * 이미 넣은 항목 중 뒤에서 바뀌는 것은 마지막 항목(반복 대화·같은 전투의 횟수)뿐이다.
 */
interface FoldState {
  items: HistoryItem[];
  seenSignatures: Set<string>;
  /** 마지막 항목이 반복 항목일 때 그 시그니처 */
  lastRepeatKey: string | null;
  episode: Episode | null;
  lastEpisode: { key: string | null; talk: boolean } | null;
  group: RecordOf<"state">[];
  seenBattles: Set<string>;
}

const newFoldState = (): FoldState => ({
  items: [], seenSignatures: new Set(), lastRepeatKey: null, episode: null, lastEpisode: null, group: [], seenBattles: new Set(),
});

/** 마지막 항목이 횟수가 바뀔 수 있는 것(반복·전투)이면 사본으로 바꾼다 — 이미 내준 항목 객체는 그대로 두게. */
function detachLast(items: HistoryItem[]): void {
  const last = items[items.length - 1];
  if (last?.kind === "repeat" || last?.kind === "battle") items[items.length - 1] = { ...last };
}

/** 같은 상태의 사본. 사본으로 계속 접어도 원본(과 원본이 내준 항목)은 바뀌지 않는다. */
function cloneFoldState(s: FoldState): FoldState {
  const items = s.items.slice();
  detachLast(items);
  return {
    items, seenSignatures: new Set(s.seenSignatures), lastRepeatKey: s.lastRepeatKey,
    episode: s.episode ? { ...s.episode, records: s.episode.records.slice() } : null,
    lastEpisode: s.lastEpisode, group: s.group.slice(), seenBattles: new Set(s.seenBattles),
  };
}

function foldEnv(records: LogRecord[], model: HistoryModel, opts: FoldOptions, nested: boolean, known?: Set<number>): FoldEnv {
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
  const pathBranches = known ?? new Set(records.map(r => rep(r.branch)));
  return {
    model, opts, noisy, nested, forkChildren, rep, pathBranches,
    uncertain: (seq: number) => opts?.uncertainSeqs?.has(seq) ?? false,
    changed: (seq: number) => opts?.changedSeqs?.has(seq) ?? false,
  };
}

function pushItem(s: FoldState, item: HistoryItem): void { s.items.push(item); s.lastRepeatKey = null; }
function pushRecord(env: FoldEnv, s: FoldState, record: LogRecord): void {
  pushItem(s, { kind: "record", record, uncertain: env.uncertain(record.seq), changed: env.changed(record.seq) });
}

function flushGroup(s: FoldState): void {
  if (s.group.length === 0) return;
  const group = s.group;
  pushItem(s, { kind: "stateGroup", records: group, count: group.reduce((n, r) => n + r.changes.length, 0) });
  s.group = [];
}

function flushEpisode(env: FoldEnv, s: FoldState): void {
  const ep = s.episode;
  if (!ep) return;
  s.episode = null;
  const messages = ep.records.filter((r): r is RecordOf<"message"> => r.type === "message");
  const hasChoice = ep.records.some(r => r.type === "choices" || r.type === "choice");
  // 글(명령 위치)과 보인 그림이 모두 같아야 같은 대화
  const signature = ep.key !== null && messages.length > 0
    ? `${ep.key}|${messages.map(m => m.cmd).join(",")}|${episodePictureKey(ep.records, env.opts?.isHiddenImage)}` : null;
  const foldable = signature !== null && !hasChoice && s.seenSignatures.has(signature)
    && !ep.records.some(r => env.uncertain(r.seq));
  if (foldable) {
    const last = s.items[s.items.length - 1];
    // 접힌 대화마다 그 기록 전부(대사·그림·화면·알림·플러그인 글)를 남긴다(펼치면 회차별로 보인다)
    if (last?.kind === "repeat" && s.lastRepeatKey === signature) { last.count++; last.occurrences = [...(last.occurrences ?? []), ep.records]; }
    else { pushItem(s, { kind: "repeat", record: messages[0], count: 1, occurrences: [ep.records] }); s.lastRepeatKey = signature; }
  } else {
    for (const r of ep.records) pushRecord(env, s, r);
  }
  if (signature !== null && !ep.records.some(r => env.uncertain(r.seq))) s.seenSignatures.add(signature);
  s.lastEpisode = { key: ep.key, talk: ep.records.some(r => TALK_TYPES.has(r.type)) };
}

function forkAt(env: FoldEnv, s: FoldState, r: LogRecord): void {
  const children = env.forkChildren.get(`${r.branch}:${r.seq}`);
  if (!children) return;
  flushEpisode(env, s);
  flushGroup(s);
  const own = env.rep(r.branch);
  const all = [own, ...children];
  const next = children.find(id => env.pathBranches.has(id)) ?? own;
  const rest = [...new Set(all.filter(id => id !== next))].sort((a, b) => a - b);
  pushItem(s, { kind: "fork", atSeq: r.seq, branches: [next, ...rest] });
}

/**
 * records[from..]을 접는다(끝의 대화·상태 변경 묶음은 열어 둔다 — foldEnd가 닫는다). 다음에 접을 위치를 돌려준다.
 * stopAtOpen이면 기록 끝까지 이어지는(끝 기록이 아직 없는) 전투 앞에서 멈춘다(기록이 더 오면 그 전투 묶음이 바뀐다).
 */
function foldRecords(env: FoldEnv, s: FoldState, records: LogRecord[], from: number, stopAtOpen: boolean): number {
  const { noisy } = env;
  for (let i = from; i < records.length; i++) {
    const r = records[i];
    if (!env.nested && r.type === "battle" && r.phase === "start") {
      // 전투 한 번을 묶는다: 끝 기록까지(없으면 다음 전투·갈래 시작·이동·불러오기 앞까지)
      let j = i + 1;
      let end: RecordOf<"battle"> | null = null;
      while (j < records.length) {
        const x = records[j];
        if (x.type === "battle") { if (x.phase === "end") { end = x; j++; } break; }
        if (BATTLE_STOP.has(x.type)) break;
        j++;
      }
      if (stopAtOpen && !end && j >= records.length) return i;
      const inner = records.slice(i + 1, end ? j - 1 : j);
      flushEpisode(env, s);
      flushGroup(s);
      const sub = fold(inner, env.model, { ...env.opts, noisy }, true);
      // 전투 로그 줄과 알림 문구(1.9.0)를 함께 센다
      const logLines = inner.reduce((n, x) => n + (x.type === "battlelog" || x.type === "notice" ? 1 : 0), 0);
      const signature = inner.some(x => env.uncertain(x.seq)) ? null : battleSignature(r, end, inner);
      const last = s.items[s.items.length - 1];
      if (signature !== null && s.seenBattles.has(signature)) {
        if (last?.kind === "battle" && last.repeat > 0 && s.lastRepeatKey === signature) last.repeat++;
        else { pushItem(s, { kind: "battle", start: r, end, items: sub, logLines, repeat: 1 }); s.lastRepeatKey = signature; }
      } else {
        pushItem(s, { kind: "battle", start: r, end, items: sub, logLines, repeat: 0 });
      }
      if (signature !== null) s.seenBattles.add(signature);
      s.lastEpisode = null;
      forkAt(env, s, r);
      if (end) forkAt(env, s, end);
      i = j - 1;
      continue;
    }
    if (r.type === "screen") {
      // 1.10.0 화면 기록은 접기에 영향이 없다: 진행 중인 대화 안이면 그 대화와 함께(반복으로 접히면 함께 접힌다),
      // 아니면 그 자리에 넣되 대화·상태 변경 묶음의 이어짐은 끊지 않는다
      if (s.episode) s.episode.records.push(r);
      else { flushGroup(s); pushItem(s, { kind: "record", record: r, uncertain: false, changed: false }); }
    } else if (EPISODE_TYPES.has(r.type)) {
      const er = r as EpisodeRecord;
      flushGroup(s);
      const key = srcKey(er.src);
      const cmd = num(er.cmd);
      if (s.episode && key !== null && key === s.episode.key && cmd > s.episode.lastCmd) {
        s.episode.records.push(er);
        s.episode.lastCmd = cmd;
      } else {
        flushEpisode(env, s);
        s.episode = { key, lastCmd: cmd, records: [er] };
      }
    } else if (r.type === "state") {
      const original: StateChange[] = Array.isArray(r.changes) ? r.changes : [];
      const changes = original.filter(c => !(c && c.kind === "variable" && noisy.has(Number(c.id))));
      // 잦은 변수만 바꾼 기록은 화면에서 사라지므로 에피소드·묶음도 끊지 않는다
      if (changes.length > 0) {
        flushEpisode(env, s);
        const rec: RecordOf<"state"> = changes.length === original.length && original === r.changes ? r : { ...r, changes };
        const key = srcKey(r.src);
        const prev = s.lastEpisode;
        if (prev?.talk && key !== null && key === prev.key) {
          flushGroup(s);
          pushRecord(env, s, rec);
        } else {
          s.group.push(rec);
        }
      }
    } else {
      flushEpisode(env, s);
      flushGroup(s);
      pushRecord(env, s, r);
      s.lastEpisode = null;
    }

    forkAt(env, s, r);
  }
  return records.length;
}

/** 끝에 열려 있는 대화·상태 변경 묶음을 닫는다. */
function foldEnd(env: FoldEnv, s: FoldState): void {
  flushEpisode(env, s);
  flushGroup(s);
}

function fold(path: LogRecord[], model: HistoryModel, opts: FoldOptions, nested: boolean): HistoryItem[] {
  const records = bySeq(Array.isArray(path) ? path : []);
  const env = foldEnv(records, model, opts, nested);
  const s = newFoldState();
  foldRecords(env, s, records, 0, false);
  foldEnd(env, s);
  return s.items;
}

// ---------------------------------------------------------------- 이어 접기

/** 이어 접기 상태(foldTimelineFrom이 돌려주고 다음 부를 때 다시 받는다). 밖에서 고치지 않는다. */
export interface FoldCache {
  /** 다 접은(뒤 기록과 상관없는) 기록 수와 그때의 경로 기록들 */
  done: number;
  records: LogRecord[];
  state: FoldState;
  modelKey: string;
  branchesKey: string;
  /** records의 대표 갈래들(이어 접을 때 새 기록만 더한다) */
  pathBranches?: Set<number>;
  noisy: Set<number>;
  uncertain: Set<number> | undefined;
  changed: Set<number> | undefined;
  hidden: FoldOptions["isHiddenImage"];
}

export interface FoldResult {
  /** foldTimeline(path, model, opts)와 같은 항목들 */
  items: HistoryItem[];
  /** 앞에서 이만큼의 항목은 이 cache로 이어 접는 동안 같은 객체 그대로다(바뀌지 않는다) */
  stable: number;
  /** 넘겨받은 cache를 이어 썼다(false = 처음부터 다시 접었다 — 이전 결과와 같은 항목이라고 볼 수 없다) */
  resumed: boolean;
  cache: FoldCache;
}

/** 갈래 모델에서 접기·읽기 항목에 쓰는 것(갈래 부모·저장 지점·회차·이어짐·회차별 순서)만 이은 열쇠 */
function modelKey(model: HistoryModel): string {
  const parts: string[] = [];
  for (const b of model?.branches?.values() ?? []) parts.push(`${b.id},${b.run},${b.parent},${b.fromSeq},${model.alias?.get(b.id) ?? ""}`);
  return `${parts.join(";")}|${(model?.runs ?? []).map(r => `${r.run}:${r.branches.join(",")}`).join(";")}`;
}

function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/** limit 이하의 값이 두 집합에서 같은가 */
function sameUpTo(a: Set<number> | undefined, b: Set<number> | undefined, limit: number): boolean {
  if (a === b) return true;
  for (const x of a ?? []) if (x <= limit && !b?.has(x)) return false;
  for (const x of b ?? []) if (x <= limit && !a?.has(x)) return false;
  return true;
}

/** 앞의 n개 기록이 같은가(같은 객체이거나, 같은 seq·종류 — 메뉴 화면 기록을 빼면서 새로 만든 사본) */
function samePrefix(prev: LogRecord[], next: LogRecord[], n: number): boolean {
  if (next.length < n || prev.length < n) return false;
  for (let i = 0; i < n; i++) {
    const a = prev[i], b = next[i];
    if (a !== b && (a.seq !== b.seq || a.type !== b.type)) return false;
  }
  return true;
}

/**
 * foldTimeline을 이어서 한다: 경로가 앞의 것에 기록만 덧붙은 것이면(같은 갈래에 기록이 쌓이는 보통의 경우)
 * 앞에서 다 접은 데서부터 새 기록만 접는다. 갈래 모델(새 갈래)·잦은 변수·접기 설정이 바뀌었거나, 앞의 기록이
 * 바뀌었으면(지우기·고치기·불확실 표시) 처음부터 다시 접는다. 결과 항목은 언제나 foldTimeline과 같다.
 * opts.noisy가 없으면(경로에서 계산) 이어 쓰지 않는다.
 */
export function foldTimelineFrom(path: LogRecord[], model: HistoryModel, opts: FoldOptions, prev: FoldCache | null): FoldResult {
  const records = bySeqFrom(Array.isArray(path) ? path : [], prev?.records ?? null);
  const keyM = modelKey(model);
  // 경로가 앞의 것에 덧붙기만 했으면(줄기 표시, core/live/lineage) 앞부분 비교·경로 갈래 모으기를 새 기록만으로 한다
  const grown = !!prev && extendsArray(prev.records, records);
  let known: Set<number> | undefined;
  if (grown && prev && prev.modelKey === keyM && prev.pathBranches) {
    known = new Set(prev.pathBranches);
    for (let i = prev.records.length; i < records.length; i++) known.add(model ? representative(model, records[i].branch) : records[i].branch);
  }
  const env = foldEnv(records, model, opts, false, known);
  const keyB = [...env.pathBranches].sort((a, b) => a - b).join(",");
  const limit = prev && prev.done > 0 ? prev.records[prev.done - 1].seq : -Infinity;
  const resumable = !!prev && opts?.noisy instanceof Set
    && prev.modelKey === keyM && prev.branchesKey === keyB && prev.hidden === (opts?.isHiddenImage ?? null)
    && sameSet(prev.noisy, env.noisy)
    && sameUpTo(prev.uncertain, opts?.uncertainSeqs, limit) && sameUpTo(prev.changed, opts?.changedSeqs, limit)
    && (grown || samePrefix(prev.records, records, prev.done));
  let state: FoldState;
  let from = 0;
  if (resumable && prev) {
    state = prev.state;
    from = prev.done;
  } else {
    state = newFoldState();
  }
  const done = foldRecords(env, state, records, from, true);
  const stable = Math.max(0, state.items.length - 1);
  const out = cloneFoldState(state);
  foldRecords(env, out, records, done, false);
  foldEnd(env, out);
  return {
    items: out.items, stable, resumed: resumable,
    cache: {
      done, records, state, modelKey: keyM, branchesKey: keyB, noisy: env.noisy, pathBranches: env.pathBranches,
      uncertain: opts?.uncertainSeqs, changed: opts?.changedSeqs, hidden: opts?.isHiddenImage ?? null,
    },
  };
}
