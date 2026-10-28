// 갈래 정리: 갈래 요약·자동 분류(빈·중복·짧은 갈래)와 사용자 정리(이름·고정·숨기기) 설정.
// 모두 화면 표시용이다 — 기록(log.jsonl)과 갈래 모델(이어짐·조상 경로)은 바꾸지 않는다. 예외를 던지지 않는다.
import { locationKey } from "../index/locations";
import type { Location } from "../types";
import { isValidRecord, representative } from "./history";
import { classifyPluginRecord, type PluginOverrides } from "./pluginText";
import type { HistoryModel, LogRecord, RecordOf } from "./types";

export const SHORT_MAX_STORY = 3;
export const KEEP_RECENT = 10;

export type BranchKind = "normal" | "empty" | "duplicate" | "short";

/** 대표 갈래(이어진 갈래 포함) 하나의 요약. */
export interface BranchSummary {
  id: number;
  run: number;
  /** 화면상 부모(부모 갈래의 대표 갈래). 없으면 null. */
  parent: number | null;
  /** 이야기 기록 수(대사·스크롤·플러그인 글·고른 선택). */
  storyCount: number;
  /** 대사 줄 수(대사·스크롤·플러그인 글). */
  lineCount: number;
  startT: number;
  /** 마지막 활동 시각(묶음 전체 기록의 최대 t). */
  lastT: number;
  lastSeq: number;
  /** 갈래가 시작된 곳의 맵 id(모르면 null). */
  startMapId: number | null;
  /** 마지막 대사(원문). */
  lastLine: { speaker: string; text: string } | null;
  /** 이 갈래에서 처음 고른 선택(부모와 갈라지는 선택). options는 직전 같은 선택지의 원문 목록. */
  firstPick: { picked: number; options: string[] | null } | null;
  kind: BranchKind;
}

function num(x: unknown): number { return typeof x === "number" && Number.isFinite(x) ? x : 0; }
function srcKey(src: Location | null | undefined): string {
  if (!src || typeof src !== "object") return "?";
  try { return locationKey(src) ?? JSON.stringify(src); } catch { return "?"; }
}
function str(x: unknown): string { return typeof x === "string" ? x : ""; }

interface StoryRec { seq: number; sig: string; counts: boolean; line: { speaker: string; text: string } | null }

/** 이야기 기록이면 그 서명(같은 위치·같은 내용이면 같다), 아니면 null. */
function storyOf(r: LogRecord, overrides: PluginOverrides | null): StoryRec | null {
  try {
    switch (r.type) {
      case "message": {
        const text = str(r.text);
        return { seq: r.seq, sig: `m|${srcKey(r.src)}#${num(r.cmd)}|${str(r.speaker)}|${text}`, counts: true, line: { speaker: str(r.speaker), text } };
      }
      case "scroll": {
        const text = str(r.text);
        return { seq: r.seq, sig: `s|${srcKey(r.src)}#${num(r.cmd)}|${text}`, counts: true, line: { speaker: "", text } };
      }
      case "choices":
        return { seq: r.seq, sig: `o|${srcKey(r.src)}#${num(r.cmd)}|${JSON.stringify(Array.isArray(r.options) ? r.options : [])}`, counts: false, line: null };
      case "choice":
        return { seq: r.seq, sig: `c|${srcKey(r.src)}#${num(r.cmd)}|${num(r.picked)}`, counts: true, line: null };
      case "plugin": {
        const c = classifyPluginRecord(r, overrides);
        if (c.kind !== "text") return null;
        return { seq: r.seq, sig: `p|${srcKey(r.src)}#${num(r.cmd)}|${c.text}`, counts: true, line: { speaker: c.label ?? "", text: c.text } };
      }
      default:
        return null;
    }
  } catch { return null; }
}

/** a가 b의 앞부분인가(서명 비교). */
function isPrefix(a: StoryRec[], b: StoryRec[]): boolean {
  if (a.length > b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].sig !== b[i].sig) return false;
  return true;
}

/**
 * 대표 갈래마다 요약과 자동 분류를 만든다.
 * - empty: 이야기 기록이 없다.
 * - duplicate: 이야기 기록이 모두, 같은 지점(같은 부모·같은 저장 지점)에서 이어 간 다른 갈래(부모의 그 뒤 이야기 또는
 *   같은 지점의 형제 갈래)의 앞부분과 같다. 서로 똑같으면 먼저 생긴 갈래가 남는다.
 * - short: 이야기 기록이 maxStory개 이하이고, 같은 지점이나 이 갈래에서 이야기가 다른 갈래로 이어진다.
 * 가장 최근 갈래(model.latestBranch)는 언제나 normal이다(불러온 직후엔 비어 있으므로).
 */
export function summarizeBranches(
  records: LogRecord[], model: HistoryModel,
  opts: { overrides?: PluginOverrides | null; maxStory?: number } = {},
): Map<number, BranchSummary> {
  const out = new Map<number, BranchSummary>();
  try {
    if (!model?.branches) return out;
    const overrides = opts.overrides ?? null;
    const maxStory = typeof opts.maxStory === "number" ? opts.maxStory : SHORT_MAX_STORY;
    const rep = (id: number) => representative(model, id);
    const reps: number[] = [];
    for (const r of model.runs ?? []) reps.push(...r.branches);

    const story = new Map<number, StoryRec[]>();      // 대표 갈래 → 이야기(seq 순)
    const transfers = new Map<number, { seq: number; mapId: number }[]>(); // 원래 갈래 id → 이동
    const lastT = new Map<number, number>();
    const lastSeq = new Map<number, number>();
    const firstPick = new Map<number, BranchSummary["firstPick"]>();
    const lastChoices = new Map<number, Map<string, string[]>>();
    for (const id of reps) story.set(id, []);

    const sorted = (Array.isArray(records) ? records : []).filter(isValidRecord).slice().sort((a, b) => a.seq - b.seq);
    for (const r of sorted) {
      const b = num(r.branch);
      if (!model.branches.has(b)) continue;
      const g = rep(b);
      lastT.set(g, Math.max(lastT.get(g) ?? -Infinity, num(r.t)));
      lastSeq.set(g, Math.max(lastSeq.get(g) ?? -Infinity, r.seq));
      if (r.type === "transfer") {
        const list = transfers.get(b) ?? [];
        list.push({ seq: r.seq, mapId: num(r.mapId) });
        transfers.set(b, list);
      }
      const s = storyOf(r, overrides);
      if (!s) continue;
      story.get(g)?.push(s);
      if (r.type === "choices") {
        const m = lastChoices.get(g) ?? new Map<string, string[]>();
        m.set(`${srcKey(r.src)}#${num(r.cmd)}`, Array.isArray(r.options) ? r.options : []);
        lastChoices.set(g, m);
      } else if (r.type === "choice" && !firstPick.has(g)) {
        const c = r as RecordOf<"choice">;
        firstPick.set(g, { picked: num(c.picked), options: lastChoices.get(g)?.get(`${srcKey(c.src)}#${num(c.cmd)}`) ?? null });
      }
    }

    // 갈래 지점 `${부모 대표}:${fromSeq}` → 그 지점에서 시작한 대표 갈래들
    const forkKey = (id: number): string | null => {
      const b = model.branches.get(id);
      if (!b || b.parent === null || b.fromSeq === null) return null;
      const p = model.branches.get(b.parent);
      if (!p || p.run !== b.run) return null;
      return `${rep(b.parent)}:${b.fromSeq}`;
    };
    const atFork = new Map<string, number[]>();
    for (const id of reps) {
      const k = forkKey(id);
      if (k !== null) atFork.set(k, [...(atFork.get(k) ?? []), id]);
    }
    const hasChild = new Set<number>();
    for (const id of reps) {
      const b = model.branches.get(id);
      if (b?.parent != null && forkKey(id) !== null) hasChild.add(rep(b.parent));
    }

    /** 지점에서 이어 간 다른 이야기들: 부모의 지점 뒤 이야기 + 같은 지점의 형제 갈래(자신 제외). */
    const alternatives = (id: number): { id: number; story: StoryRec[] }[] => {
      const k = forkKey(id);
      if (k === null) return [];
      const b = model.branches.get(id)!;
      const parentRep = rep(b.parent!);
      const alts: { id: number; story: StoryRec[] }[] = [];
      const after = (story.get(parentRep) ?? []).filter(s => s.seq > b.fromSeq!);
      if (after.length > 0) alts.push({ id: parentRep, story: after });
      for (const sib of atFork.get(k) ?? []) if (sib !== id) alts.push({ id: sib, story: story.get(sib) ?? [] });
      return alts;
    };

    // 갈래가 시작된 곳의 맵: 자기 기록에서 시작 전·조상 경로에서 갈라진 지점 전 마지막 이동, 없으면 자기 묶음의 첫 이동
    const mapAt = (startId: number): number | null => {
      let cur = model.branches.get(startId);
      let limit = cur ? cur.startSeq : -Infinity;
      const seen = new Set<number>();
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        const list = transfers.get(cur.id) ?? [];
        for (let i = list.length - 1; i >= 0; i--) if (list[i].seq <= limit) return list[i].mapId;
        if (cur.parent === null || cur.fromSeq === null) break;
        limit = cur.fromSeq;
        const p = model.branches.get(cur.parent);
        if (!p || p.run !== cur.run) break;
        cur = p;
      }
      return null;
    };
    const firstTransferOfGroup = (id: number): number | null => {
      let best: { seq: number; mapId: number } | null = null;
      for (const [b, list] of transfers) {
        if (rep(b) !== id || list.length === 0) continue;
        if (!best || list[0].seq < best.seq) best = list[0];
      }
      return best?.mapId ?? null;
    };

    for (const id of reps) {
      const b = model.branches.get(id);
      if (!b) continue;
      const s = story.get(id) ?? [];
      const storyCount = s.filter(x => x.counts).length;
      const lines = s.filter(x => x.line !== null);
      let kind: BranchKind = "normal";
      if (id !== model.latestBranch) {
        if (storyCount === 0) kind = "empty";
        else {
          const alts = alternatives(id);
          const forkParent = rep(b.parent ?? id);
          // 서로 똑같으면 부모의 이야기, 또는 먼저 생긴 형제가 남는다
          const dup = alts.some(a => isPrefix(s, a.story) && (a.story.length > s.length || a.id === forkParent || a.id < id));
          if (dup) kind = "duplicate";
          else if (storyCount <= maxStory && (hasChild.has(id) || alts.some(a => a.story.length > 0))) kind = "short";
        }
      }
      const parentRep = b.parent !== null && model.branches.get(b.parent)?.run === b.run ? rep(b.parent) : null;
      out.set(id, {
        id, run: b.run,
        parent: parentRep !== null && parentRep !== id ? parentRep : null,
        storyCount, lineCount: lines.length,
        startT: b.startT, lastT: lastT.get(id) ?? b.lastT, lastSeq: lastSeq.get(id) ?? b.lastSeq,
        startMapId: mapAt(id) ?? firstTransferOfGroup(id),
        lastLine: lines.length > 0 ? lines[lines.length - 1].line : null,
        firstPick: firstPick.get(id) ?? null,
        kind,
      });
    }
  } catch { /* 요약 실패는 빈 결과 */ }
  return out;
}

// ── 사용자 정리 설정 ───────────────────────────────────────────

/** 갈래 하나의 사용자 설정. hidden: true = 숨김, false = 자동으로 숨겨질 갈래도 보이기, 없음 = 자동. */
export interface BranchPref { label?: string; pinned?: boolean; hidden?: boolean }
export interface BranchPrefs { v: 1; t: number; branches: Record<string, BranchPref> }

export const emptyPrefs = (): BranchPrefs => ({ v: 1, t: 0, branches: {} });

/** branches.json 원문 → 설정. 해석 못 하면 null. */
export function parseBranchPrefs(text: string | null | undefined): BranchPrefs | null {
  if (typeof text !== "string" || text.trim() === "") return null;
  try {
    const v = JSON.parse(text) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    if (o.v !== 1) return null;
    const branches: Record<string, BranchPref> = {};
    const raw = o.branches && typeof o.branches === "object" && !Array.isArray(o.branches) ? o.branches as Record<string, unknown> : {};
    for (const [k, x] of Object.entries(raw)) {
      if (!/^\d+$/.test(k) || !x || typeof x !== "object") continue;
      const p = x as Record<string, unknown>;
      const pref: BranchPref = {};
      if (typeof p.label === "string" && p.label.trim() !== "") pref.label = p.label.trim();
      if (p.pinned === true) pref.pinned = true;
      if (typeof p.hidden === "boolean") pref.hidden = p.hidden;
      if (Object.keys(pref).length > 0) branches[k] = pref;
    }
    return { v: 1, t: num(o.t), branches };
  } catch { return null; }
}

export function serializeBranchPrefs(p: BranchPrefs): string {
  return JSON.stringify({ v: 1, t: num(p?.t), branches: p?.branches ?? {} }, null, 2) + "\n";
}

/** 둘 중 더 최근(t가 큰) 설정. 둘 다 없으면 빈 설정. */
export function newerPrefs(a: BranchPrefs | null, b: BranchPrefs | null): BranchPrefs {
  if (a && b) return b.t > a.t ? b : a;
  return a ?? b ?? emptyPrefs();
}

/** 갈래 하나의 설정을 바꾼 새 설정(t = now). 빈 설정은 지운다. */
export function updatePref(prefs: BranchPrefs, id: number, patch: Partial<Record<keyof BranchPref, unknown>>, now: number): BranchPrefs {
  const key = String(id);
  const cur: BranchPref = { ...(prefs.branches[key] ?? {}) };
  if ("label" in patch) {
    const l = typeof patch.label === "string" ? patch.label.trim() : "";
    if (l) cur.label = l; else delete cur.label;
  }
  if ("pinned" in patch) { if (patch.pinned === true) cur.pinned = true; else delete cur.pinned; }
  if ("hidden" in patch) { if (typeof patch.hidden === "boolean") cur.hidden = patch.hidden; else delete cur.hidden; }
  const branches = { ...prefs.branches };
  if (Object.keys(cur).length > 0) branches[key] = cur; else delete branches[key];
  return { v: 1, t: now, branches };
}

/** 숨겨진 갈래인가: 사용자가 숨겼거나, 자동(빈·중복 갈래)이고 사용자가 보이기로 하지 않았다. 고정한 갈래는 숨지 않는다. */
export function isHidden(s: BranchSummary, prefs: BranchPrefs): boolean {
  const p = prefs.branches[String(s.id)];
  if (p?.pinned) return false;
  if (typeof p?.hidden === "boolean") return p.hidden;
  return s.kind === "empty" || s.kind === "duplicate";
}

export interface BranchRow { id: number; hidden: boolean; pinned: boolean; shorts: BranchRow[] }
export interface BranchList {
  pinned: BranchRow[];
  runs: { run: number; rows: BranchRow[] }[];
  hiddenCount: number;
}

/**
 * 갈래 목록(화면용). 고정한 갈래가 맨 위, 그 아래 회차별(최근 회차 먼저) 최근 활동 순.
 * 짧은 갈래는 보이는 부모 갈래 행의 shorts로 접힌다. showHidden이면 숨긴 갈래도 제자리에 보인다(hidden 표시).
 * always: 숨겨져 있어도 늘 보일 갈래(지금 고른 갈래 등).
 */
export function branchList(
  summaries: Map<number, BranchSummary>, prefs: BranchPrefs, opts: { showHidden?: boolean; always?: number | null } = {},
): BranchList {
  const result: BranchList = { pinned: [], runs: [], hiddenCount: 0 };
  try {
    const all = [...summaries.values()].sort((a, b) => b.lastT - a.lastT || b.id - a.id);
    const hidden = new Map<number, boolean>();
    for (const s of all) {
      const h = isHidden(s, prefs);
      hidden.set(s.id, h);
      if (h) result.hiddenCount++;
    }
    const visible = (s: BranchSummary) => !hidden.get(s.id) || opts.showHidden === true || s.id === opts.always;
    const pinnedOf = (id: number) => prefs.branches[String(id)]?.pinned === true;
    const rows = new Map<number, BranchRow>();
    const shown = all.filter(visible);
    for (const s of shown) rows.set(s.id, { id: s.id, hidden: hidden.get(s.id) ?? false, pinned: pinnedOf(s.id), shorts: [] });
    const byRun = new Map<number, BranchRow[]>();
    for (const s of shown) {
      const row = rows.get(s.id)!;
      const parentRow = s.parent !== null ? rows.get(s.parent) : undefined;
      if (s.kind === "short" && !row.pinned && s.id !== opts.always && parentRow) { parentRow.shorts.push(row); continue; }
      if (row.pinned) { result.pinned.push(row); continue; }
      byRun.set(s.run, [...(byRun.get(s.run) ?? []), row]);
    }
    result.runs = [...byRun.entries()].sort((a, b) => b[0] - a[0]).map(([run, list]) => ({ run, rows: list }));
  } catch { /* 빈 목록 */ }
  return result;
}

/** `이 갈래와 이전 갈래 모두 숨기기`: 이 갈래와 그 전에 시작한 갈래(모든 회차, 고정 제외)를 숨긴다. 새로 숨긴 수도 돌려준다. */
export function hideUpTo(
  summaries: Map<number, BranchSummary>, prefs: BranchPrefs, id: number, now: number,
): { prefs: BranchPrefs; count: number } {
  const target = summaries.get(id);
  if (!target) return { prefs, count: 0 };
  const ids = [...summaries.values()]
    .filter(s => s.startT < target.startT || (s.startT === target.startT && s.id <= id))
    .map(s => s.id);
  return hideMany(summaries, prefs, ids, now);
}

/** `오래된 갈래 정리`: 보이는 갈래 중 최근 활동 keep개와 고정한 갈래·latest를 빼고 모두 숨긴다. */
export function tidyOld(
  summaries: Map<number, BranchSummary>, prefs: BranchPrefs, now: number, keep = KEEP_RECENT, latest: number | null = null,
): { prefs: BranchPrefs; count: number } {
  const visible = [...summaries.values()].filter(s => !isHidden(s, prefs)).sort((a, b) => b.lastT - a.lastT || b.id - a.id);
  const ids = visible.slice(Math.max(0, keep)).filter(s => s.id !== latest).map(s => s.id);
  return hideMany(summaries, prefs, ids, now);
}

function hideMany(summaries: Map<number, BranchSummary>, prefs: BranchPrefs, ids: number[], now: number): { prefs: BranchPrefs; count: number } {
  let next = prefs, count = 0;
  for (const id of ids) {
    const s = summaries.get(id);
    if (!s || prefs.branches[String(id)]?.pinned) continue;
    if (!isHidden(s, prefs)) count++;
    next = updatePref(next, id, { hidden: true }, now);
  }
  return { prefs: next, count };
}

/** 정리 버튼의 미리보기: 새로 숨겨질 수. */
export function tidyOldCount(summaries: Map<number, BranchSummary>, prefs: BranchPrefs, keep = KEEP_RECENT, latest: number | null = null): number {
  return tidyOld(summaries, prefs, 0, keep, latest).count;
}

/** 갈래 id(이어진 갈래 id 포함)를 설정 키가 되는 대표 갈래 id로. */
export function prefId(model: HistoryModel, id: number): number {
  return representative(model, id);
}
