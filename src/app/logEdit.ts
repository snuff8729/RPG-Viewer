/**
 * 갈래 영구 삭제·되돌리기: 게임 폴더의 rpg-viewer/log.jsonl을 고쳐 쓴다(게임이 꺼져 있을 때만).
 * 고치기 전에 기록·본 기록 보관·갈래 정리를 rpg-viewer/log-backups/에 백업하고(최신 5벌),
 * 지운 기록이 보태던 진행도는 rpg-viewer/seen-archive.json에 남긴다. run/branch/seq는 바꾸지 않는다.
 */
import type { WritableGameFolder } from "@/core/fs/folder";
import { planDeleteSet, planDeletion, type DeletionPlan } from "@/core/live/branchDelete";
import { computeCoverage } from "@/core/live/coverage";
import { buildHistory } from "@/core/live/history";
import { livePaths } from "@/core/live/installer";
import {
  backupArchiveName, backupBranchesName, backupLogName, backupsToRemove, backupTimes, byteLength, editBlockReason, joinKeptLines,
  logCounters, pruneMetaText, recordsOf, restoredLogText, splitLogLines,
} from "@/core/live/logMaintenance";
import { buildSeenArchive, mergeSeenArchive, parseSeenArchive, serializeSeenArchive } from "@/core/live/seenArchive";
import type { GameData } from "@/core/types";

export interface LogEditPaths { log: string; archive: string; meta: string; branches: string; backupDir: string }

export function logEditPaths(dataRoot: string): LogEditPaths {
  const dir = livePaths(dataRoot).logDir;
  return {
    log: livePaths(dataRoot).logFile,
    archive: `${dir}/seen-archive.json`,
    meta: `${dir}/meta.json`,
    branches: `${dir}/branches.json`,
    backupDir: `${dir}/log-backups`,
  };
}

export type RunningCheck = (path: string) => Promise<{ ok: true; running: boolean } | { ok: false; error: string }>;

/**
 * 기록 파일을 고칠 수 없는 이유(게임이 켜져 있음), 고쳐도 되면 null.
 * connected: 뷰어가 게임과 연결됨. 실행 API가 있고 게임 경로를 알면 `/api/game/running`도 묻는다(답을 못 받으면 연결 상태로만 판단).
 */
export async function gameRunningBlock(
  connected: boolean, opts: { launcher: boolean; gamePath: string | null; fetchRunning: RunningCheck },
): Promise<string | null> {
  let running: boolean | null = null;
  if (!connected && opts.launcher && opts.gamePath) {
    try {
      const r = await opts.fetchRunning(opts.gamePath);
      running = r.ok ? r.running : null;
    } catch { running = null; }
  }
  return editBlockReason({ connected, running });
}

export type DeleteRequest = { mode: "keep"; ids: number[] } | { mode: "delete"; ids: number[] };

export interface LogEditDeps {
  folder: WritableGameFolder;
  dataRoot: string;
  data: GameData;
  /** 게임이 켜져 있으면 그 이유(gameRunningBlock). 쓰기 바로 전에 다시 부른다. */
  checkStopped: () => Promise<string | null>;
  now?: () => number;
}

export type LogEditResult =
  | { ok: true; plan: DeletionPlan | null; bytesBefore: number; bytesAfter: number }
  | { ok: false; message: string };

const READ_FAILED = "기록 파일을 읽지 못했어요";
const BACKUP_FAILED = "기록 파일을 백업하지 못해서 지우지 않았어요";
const WRITE_FAILED = "기록 파일을 쓰지 못했어요. 백업은 rpg-viewer/log-backups에 있어요";
const CHANGED = "기록 파일이 그사이 바뀌었어요. 다시 시도해 주세요";
const NO_BACKUP = "되돌릴 백업이 없어요";

/** 요청대로 계획한다(미리보기와 실제 삭제가 같은 함수를 쓴다). */
export function planRequest(records: Parameters<typeof planDeletion>[0], req: DeleteRequest): DeletionPlan {
  const model = buildHistory(records);
  return req.mode === "keep" ? planDeletion(records, model, req.ids) : planDeleteSet(records, model, req.ids);
}

async function writeVerified(folder: WritableGameFolder, path: string, text: string): Promise<boolean> {
  try {
    if (!(await folder.writeText(path, text))) return false;
    const st = await folder.stat(path);
    return st !== null && st.size === byteLength(text);
  } catch { return false; }
}

const readOrNull = async (folder: WritableGameFolder, path: string): Promise<string | null> => {
  try { return await folder.readText(path); } catch { return null; }
};

/** 백업 폴더를 최신 5벌로 줄인다. */
async function rotateBackups(folder: WritableGameFolder, dir: string): Promise<void> {
  try {
    const names = await folder.list(dir);
    for (const n of backupsToRemove(names)) await folder.remove(`${dir}/${n}`).catch(() => false);
  } catch { /* 다음에 다시 */ }
}

/** 갈래를 영구 삭제한다. 게임이 켜져 있으면 아무것도 하지 않는다. */
export async function deleteBranches(deps: LogEditDeps, req: DeleteRequest): Promise<LogEditResult> {
  const { folder, dataRoot, data } = deps;
  const now = deps.now ?? Date.now;
  const p = logEditPaths(dataRoot);
  const block = await deps.checkStopped();
  if (block) return { ok: false, message: block };

  const original = await readOrNull(folder, p.log);
  if (original === null) return { ok: false, message: READ_FAILED };
  const bytesBefore = byteLength(original);
  const lines = splitLogLines(original);
  const records = recordsOf(lines);
  const model = buildHistory(records);
  const plan = req.mode === "keep" ? planDeletion(records, model, req.ids) : planDeleteSet(records, model, req.ids);
  if (plan.dropped.length === 0) return { ok: true, plan, bytesBefore, bytesAfter: bytesBefore };

  // 본 기록 보관: 지우기 전 진행도(기록 + 이전 보관)에서 남는 기록으로 나오지 않는 것만
  const archiveText = await readOrNull(folder, p.archive);
  const prevArchive = parseSeenArchive(archiveText);
  const full = mergeSeenArchive(computeCoverage(records, data, model), prevArchive);
  const rest = computeCoverage(plan.kept, data);
  const t = now();
  const nextArchive = buildSeenArchive(full, rest, t);
  const newLog = joinKeptLines(lines, plan.kept);

  // 백업(실패하면 멈춘다)
  if (!(await writeVerified(folder, `${p.backupDir}/${backupLogName(t)}`, original))) return { ok: false, message: BACKUP_FAILED };
  if (archiveText !== null && !(await writeVerified(folder, `${p.backupDir}/${backupArchiveName(t)}`, archiveText))) {
    return { ok: false, message: BACKUP_FAILED };
  }
  const branchesText = await readOrNull(folder, p.branches);
  if (branchesText !== null) await writeVerified(folder, `${p.backupDir}/${backupBranchesName(t)}`, branchesText);
  await rotateBackups(folder, p.backupDir);

  // 쓰기 바로 전에 다시 확인: 게임이 켜졌거나 기록이 늘었으면 멈춘다
  const block2 = await deps.checkStopped();
  if (block2) return { ok: false, message: block2 };
  try {
    const st = await folder.stat(p.log);
    if (!st || st.size !== bytesBefore) return { ok: false, message: CHANGED };
  } catch { return { ok: false, message: CHANGED }; }

  // 보관을 먼저 쓴다(기록만 줄고 보관이 없는 순간이 없도록)
  if (!(await writeVerified(folder, p.archive, serializeSeenArchive(nextArchive)))) return { ok: false, message: WRITE_FAILED };
  // 두 구현 모두 writeText가 원자적이다(서버: 임시 파일 + 이름 바꾸기, 브라우저: createWritable 교체)
  if (!(await writeVerified(folder, p.log, newLog))) {
    // 기록을 못 썼으면 보관도 되돌린다(늘어난 보관은 해롭지 않지만 깔끔하게)
    if (archiveText !== null) await folder.writeText(p.archive, archiveText).catch(() => false);
    else await folder.remove(p.archive).catch(() => false);
    return { ok: false, message: WRITE_FAILED };
  }

  // meta.json: 지운 갈래의 lastStory를 빼고 번호를 지운 기록보다 크게
  try {
    const meta = pruneMetaText(await readOrNull(folder, p.meta), plan.removedIds, logCounters(records));
    if (meta !== null) await folder.writeText(p.meta, meta);
  } catch { /* 플러그인이 기록 끝에서 번호를 다시 올린다 */ }

  return { ok: true, plan, bytesBefore, bytesAfter: byteLength(newLog) };
}

/** 가장 최근 백업 시각(없으면 null). */
export async function latestBackupTime(folder: WritableGameFolder, dataRoot: string): Promise<number | null> {
  try {
    return backupTimes(await folder.list(logEditPaths(dataRoot).backupDir))[0] ?? null;
  } catch { return null; }
}

/**
 * 마지막 삭제를 되돌린다: 가장 최근 백업의 기록 + 그 뒤 새로 쌓인 기록으로 log.jsonl을 다시 쓰고,
 * 본 기록 보관도 그때로 돌린 뒤, 쓴 백업 한 벌을 지운다. 게임이 켜져 있으면 아무것도 하지 않는다.
 */
export async function undoLastDeletion(deps: Omit<LogEditDeps, "data">): Promise<LogEditResult> {
  const { folder, dataRoot } = deps;
  const p = logEditPaths(dataRoot);
  const block = await deps.checkStopped();
  if (block) return { ok: false, message: block };
  const t = await latestBackupTime(folder, dataRoot);
  if (t === null) return { ok: false, message: NO_BACKUP };
  const backup = await readOrNull(folder, `${p.backupDir}/${backupLogName(t)}`);
  if (backup === null) return { ok: false, message: NO_BACKUP };
  const current = await readOrNull(folder, p.log);
  const bytesBefore = current === null ? 0 : byteLength(current);
  const text = restoredLogText(backup, current);
  const archiveBackup = await readOrNull(folder, `${p.backupDir}/${backupArchiveName(t)}`);

  if (!(await writeVerified(folder, p.log, text))) return { ok: false, message: WRITE_FAILED };
  // 늘어난 기록과 합쳐도 진행도가 같도록 보관은 그때로(없었으면 지운다)
  if (archiveBackup !== null) await folder.writeText(p.archive, archiveBackup).catch(() => false);
  else await folder.remove(p.archive).catch(() => false);
  try {
    const meta = pruneMetaText(await readOrNull(folder, p.meta), [], logCounters(recordsOf(splitLogLines(text))));
    if (meta !== null) await folder.writeText(p.meta, meta);
  } catch { /* 무시 */ }
  for (const name of [backupLogName(t), backupArchiveName(t), backupBranchesName(t)]) {
    await folder.remove(`${p.backupDir}/${name}`).catch(() => false);
  }
  return { ok: true, plan: null, bytesBefore, bytesAfter: byteLength(text) };
}
