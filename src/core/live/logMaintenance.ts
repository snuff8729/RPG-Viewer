// 기록 파일 손보기(갈래 영구 삭제·되돌리기)에 쓰는 순수 도우미: 줄 단위 다시 쓰기, 백업 이름·정리, meta.json 정리,
// 게임이 켜져 있는지 판단. 예외를 던지지 않는다.
import { parseLogLine } from "./log";
import type { LogRecord } from "./types";

export const BACKUP_KEEP = 5;
export const GAME_RUNNING_MESSAGE = "게임을 끈 뒤에 지울 수 있어요";

/** 기록 파일의 줄들: 원문과(해석되면) 기록. 빈 줄은 뺀다. */
export interface LogLine { raw: string; record: LogRecord | null }

export function splitLogLines(text: string): LogLine[] {
  const out: LogLine[] = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    out.push({ raw: line, record: parseLogLine(line) });
  }
  return out;
}

export const recordsOf = (lines: LogLine[]): LogRecord[] =>
  lines.flatMap(l => (l.record ? [l.record] : []));

/** 남길 기록(같은 객체)과 해석 못 한 줄만 원래 순서·원문 그대로 이어 쓴다. */
export function joinKeptLines(lines: LogLine[], kept: Iterable<LogRecord>): string {
  const keep = new Set<LogRecord>(kept);
  const out = lines.filter(l => !l.record || keep.has(l.record)).map(l => l.raw);
  return out.length === 0 ? "" : out.join("\n") + "\n";
}

/** UTF-8 바이트 수. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** 기록에 나온 가장 큰 run·branch·seq(없으면 0). */
export function logCounters(records: LogRecord[]): { run: number; branch: number; seq: number } {
  let run = 0, branch = 0, seq = 0;
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || typeof r !== "object") continue;
    if (typeof r.run === "number" && Number.isFinite(r.run)) run = Math.max(run, r.run);
    if (typeof r.branch === "number" && Number.isFinite(r.branch)) branch = Math.max(branch, r.branch);
    if (typeof r.seq === "number" && Number.isFinite(r.seq)) seq = Math.max(seq, r.seq);
  }
  return { run, branch, seq };
}

/**
 * meta.json 정리: 기록이 모두 지워진 갈래의 lastStory 항목을 빼고(다음에 그 갈래 세이브를 불러오면 새 갈래로 시작한다),
 * 다음 번호(nextRun·nextBranch·nextSeq)가 지운 기록의 번호보다 크도록 올린다(번호를 다시 쓰지 않게).
 * 원문이 없거나 깨졌으면 번호만 담은 새 meta를 만든다. 바꿀 것이 없으면 null.
 */
export function pruneMetaText(
  metaText: string | null | undefined, removedIds: Iterable<number>, counters: { run: number; branch: number; seq: number },
): string | null {
  let meta: Record<string, unknown> | null = null;
  try {
    const v = typeof metaText === "string" && metaText.trim() !== "" ? JSON.parse(metaText) as unknown : null;
    if (v && typeof v === "object" && !Array.isArray(v)) meta = { ...(v as Record<string, unknown>) };
  } catch { meta = null; }
  const created = meta === null;
  const m: Record<string, unknown> = meta ?? {};
  let changed = created;
  const raise = (key: string, min: number) => {
    const cur = typeof m[key] === "number" && Number.isFinite(m[key]) && (m[key] as number) >= 1 ? m[key] as number : 1;
    const next = Math.max(cur, Math.floor(min));
    if (m[key] !== next) { m[key] = next; changed = true; }
  };
  raise("nextRun", counters.run + 1);
  raise("nextBranch", counters.branch + 1);
  raise("nextSeq", counters.seq + 1);
  const ls = m.lastStory;
  if (ls && typeof ls === "object" && !Array.isArray(ls)) {
    const story = { ...(ls as Record<string, unknown>) };
    for (const id of removedIds) {
      const k = String(id);
      if (Object.prototype.hasOwnProperty.call(story, k)) { delete story[k]; changed = true; }
    }
    m.lastStory = story;
  } else if (created) {
    m.lastStory = {};
  }
  return changed ? JSON.stringify(m) : null;
}

// ── 백업 ─────────────────────────────────────────────────────

/** 백업 한 벌: 기록(log-<t>.jsonl), 그때의 본 기록 보관(log-<t>.archive.json, 있었을 때만), 갈래 정리(log-<t>.branches.json). */
export const backupLogName = (t: number) => `log-${t}.jsonl`;
export const backupArchiveName = (t: number) => `log-${t}.archive.json`;
export const backupBranchesName = (t: number) => `log-${t}.branches.json`;

const BACKUP_RE = /^log-(\d+)\.(jsonl|archive\.json|branches\.json)$/;

/** 백업 폴더 파일 이름들 → 기록 백업이 있는 시각들(최신 먼저). */
export function backupTimes(names: string[]): number[] {
  const times = new Set<number>();
  for (const n of Array.isArray(names) ? names : []) {
    const m = BACKUP_RE.exec(n);
    if (m && m[2] === "jsonl") times.add(Number(m[1]));
  }
  return [...times].sort((a, b) => b - a);
}

/** 최신 keep벌만 남길 때 지울 파일 이름들(기록이 없는 짝 잃은 파일 포함). */
export function backupsToRemove(names: string[], keep = BACKUP_KEEP): string[] {
  const keepTimes = new Set(backupTimes(names).slice(0, Math.max(0, keep)));
  return (Array.isArray(names) ? names : []).filter(n => {
    const m = BACKUP_RE.exec(n);
    return m !== null && !keepTimes.has(Number(m[1]));
  });
}

/**
 * 되돌리기: 백업한 기록에, 지운 뒤 새로 쌓인 기록(백업의 가장 큰 seq보다 큰 seq)을 원문 그대로 이어 붙인다.
 */
export function restoredLogText(backupText: string, currentText: string | null): string {
  const backup = splitLogLines(backupText);
  const maxSeq = logCounters(recordsOf(backup)).seq;
  const extra = splitLogLines(currentText ?? "").filter(l => l.record && l.record.seq > maxSeq);
  const out = [...backup, ...extra].map(l => l.raw);
  return out.length === 0 ? "" : out.join("\n") + "\n";
}

// ── 게임이 켜져 있는지 ────────────────────────────────────────

/**
 * 기록 파일을 고쳐도 되는가. connected: 게임이 지금 live.json을 쓰고 있다(5초 이내).
 * running: 실행 API의 답(true/false), 확인할 수 없으면 null. 막아야 하면 그 이유, 아니면 null.
 */
export function editBlockReason(s: { connected: boolean; running: boolean | null }): string | null {
  if (s.connected || s.running === true) return GAME_RUNNING_MESSAGE;
  return null;
}
