import { describe, expect, it } from "vitest";
import {
  backupsToRemove, backupTimes, editBlockReason, GAME_RUNNING_MESSAGE, joinKeptLines, logCounters, pruneMetaText, recordsOf,
  restoredLogText, splitLogLines,
} from "./logMaintenance";

const line = (seq: number, branch = 1, type = "save") => JSON.stringify({ v: 1, seq, t: seq, run: 1, branch, type, slot: 1 });

describe("log lines", () => {
  it("keeps raw text of kept records and unparsable lines", () => {
    const text = [line(1), "{broken", line(2, 2), "", line(3)].join("\r\n");
    const lines = splitLogLines(text);
    const recs = recordsOf(lines);
    expect(recs.map(r => r.seq)).toEqual([1, 2, 3]);
    expect(joinKeptLines(lines, [recs[0], recs[2]])).toBe([line(1), "{broken", line(3)].join("\n") + "\n");
    expect(joinKeptLines([], [])).toBe("");
  });
  it("counters", () => {
    expect(logCounters(recordsOf(splitLogLines([line(4, 7), line(2, 9)].join("\n"))))).toEqual({ run: 1, branch: 9, seq: 4 });
    expect(logCounters([])).toEqual({ run: 0, branch: 0, seq: 0 });
  });
});

describe("meta.json", () => {
  it("drops lastStory of removed branches and never lowers counters", () => {
    const meta = JSON.stringify({ nextRun: 3, nextBranch: 10, nextSeq: 500, lastStory: { 1: { run: 1, seq: 4 }, 4: { run: 1, seq: 23 }, 9: 7 } });
    const out = JSON.parse(pruneMetaText(meta, [4, 9], { run: 2, branch: 9, seq: 499 })!);
    expect(out).toEqual({ nextRun: 3, nextBranch: 10, nextSeq: 500, lastStory: { 1: { run: 1, seq: 4 } } });
  });
  it("raises counters that lag behind the original log", () => {
    const out = JSON.parse(pruneMetaText(JSON.stringify({ nextRun: 1, nextBranch: 2, nextSeq: 5, lastStory: {} }), [], { run: 2, branch: 6, seq: 40 })!);
    expect(out).toMatchObject({ nextRun: 3, nextBranch: 7, nextSeq: 41 });
  });
  it("returns null when nothing changes and creates meta when missing or broken", () => {
    const meta = JSON.stringify({ nextRun: 3, nextBranch: 10, nextSeq: 500, lastStory: { 1: 2 } });
    expect(pruneMetaText(meta, [5], { run: 1, branch: 1, seq: 1 })).toBeNull();
    expect(JSON.parse(pruneMetaText(null, [1], { run: 1, branch: 2, seq: 3 })!)).toEqual({ nextRun: 2, nextBranch: 3, nextSeq: 4, lastStory: {} });
    expect(JSON.parse(pruneMetaText("{oops", [], { run: 0, branch: 0, seq: 0 })!)).toEqual({ nextRun: 1, nextBranch: 1, nextSeq: 1, lastStory: {} });
  });
});

describe("backups", () => {
  it("keeps the newest five sets", () => {
    const names = [1, 2, 3, 4, 5, 6, 7].flatMap(t => [`log-${t}.jsonl`, `log-${t}.branches.json`]);
    names.push("log-2.archive.json", "log-0.archive.json", "notes.txt");
    expect(backupTimes(names)).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect(backupsToRemove(names).sort()).toEqual([
      "log-0.archive.json", "log-1.branches.json", "log-1.jsonl", "log-2.archive.json", "log-2.branches.json", "log-2.jsonl",
    ]);
    expect(backupsToRemove(names.slice(0, 4))).toEqual([]);
  });
  it("restore appends records written after the deletion", () => {
    const backup = [line(1), line(2), line(3)].join("\n") + "\n";
    const current = [line(1), line(3), line(4), "{bad"].join("\n");
    expect(restoredLogText(backup, current)).toBe([line(1), line(2), line(3), line(4)].join("\n") + "\n");
    expect(restoredLogText(backup, null)).toBe(backup);
  });
});

describe("editBlockReason", () => {
  it("refuses while the game is connected or reported running", () => {
    expect(editBlockReason({ connected: true, running: null })).toBe(GAME_RUNNING_MESSAGE);
    expect(editBlockReason({ connected: false, running: true })).toBe(GAME_RUNNING_MESSAGE);
    expect(editBlockReason({ connected: true, running: false })).toBe(GAME_RUNNING_MESSAGE);
    expect(editBlockReason({ connected: false, running: false })).toBeNull();
    expect(editBlockReason({ connected: false, running: null })).toBeNull();
  });
});
