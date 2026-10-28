import { beforeAll, describe, expect, it } from "vitest";
import { loadFixtureFolder } from "../../tests/helpers/fixtureFolder";
import { fixtureLogText, fixtureRecords } from "../../tests/helpers/fixtureLog";
import { MemoryFolder } from "@/core/fs/folder";
import { computeCoverage } from "@/core/live/coverage";
import { parseLogText } from "@/core/live/log";
import { GAME_RUNNING_MESSAGE } from "@/core/live/logMaintenance";
import { mergeSeenArchive, parseSeenArchive } from "@/core/live/seenArchive";
import { loadGame } from "@/core/loader/loadGame";
import type { GameData } from "@/core/types";
import { deleteBranches, gameRunningBlock, latestBackupTime, logEditPaths, undoLastDeletion } from "./logEdit";

let data: GameData;
beforeAll(async () => {
  const r = await loadGame(loadFixtureFolder("sample-mz"));
  if (!r.ok) throw new Error("load failed");
  data = r.data;
});

const ROOT = "data";
const P = logEditPaths(ROOT);
const META = JSON.stringify({ nextRun: 3, nextBranch: 4, nextSeq: 36, lastStory: { 1: { run: 1, seq: 14 }, 2: { run: 1, seq: 31 }, 3: { run: 2, seq: 34 } } });

function folder(extra: Record<string, string> = {}) {
  return new MemoryFolder({ [P.log]: fixtureLogText(), [P.meta]: META, [P.branches]: "{\"v\":1,\"t\":1,\"branches\":{}}\n", ...extra });
}
const sortedCov = (c: ReturnType<typeof computeCoverage>) => ({
  seen: [...c.seen].sort(), touched: [...c.touched].sort(), pluginRan: [...c.pluginRan].sort(),
  picks: [...c.picks.entries()].sort((a, b) => a[0].localeCompare(b[0])),
});

describe("deleteBranches", () => {
  it("rewrites the log, keeps seen data, backs up and fixes meta", async () => {
    const f = folder();
    let t = 1000;
    const res = await deleteBranches({ folder: f, dataRoot: ROOT, data, checkStopped: async () => null, now: () => t++ }, { mode: "delete", ids: [2] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const text = (await f.readText(P.log))!;
    const recs = parseLogText(text).records;
    expect(recs.some(r => r.branch === 2)).toBe(false);
    expect(recs.map(r => r.seq)).toEqual(fixtureRecords().filter(r => r.branch !== 2).map(r => r.seq));   // 번호 그대로
    expect(text).toContain("{broken");   // 해석 못 한 줄도 그대로
    expect(res.bytesAfter).toBeLessThan(res.bytesBefore);
    // 진행도: 남은 기록 + 보관 = 원래
    const archive = parseSeenArchive(await f.readText(P.archive));
    expect(archive).not.toBeNull();
    expect(sortedCov(mergeSeenArchive(computeCoverage(recs, data), archive))).toEqual(sortedCov(computeCoverage(fixtureRecords(), data)));
    // 백업
    expect(await f.readText(`${P.backupDir}/log-1000.jsonl`)).toBe(fixtureLogText());
    expect(await f.readText(`${P.backupDir}/log-1000.branches.json`)).not.toBeNull();
    expect(await f.readText(`${P.backupDir}/log-1000.archive.json`)).toBeNull();
    // meta: 지운 갈래의 lastStory만 빠진다
    expect(JSON.parse((await f.readText(P.meta))!)).toEqual({
      nextRun: 3, nextBranch: 4, nextSeq: 36, lastStory: { 1: { run: 1, seq: 14 }, 3: { run: 2, seq: 34 } },
    });
  });

  it("refuses while the game is running and writes nothing", async () => {
    const f = folder();
    const res = await deleteBranches({ folder: f, dataRoot: ROOT, data, checkStopped: async () => GAME_RUNNING_MESSAGE }, { mode: "delete", ids: [2] });
    expect(res).toEqual({ ok: false, message: GAME_RUNNING_MESSAGE });
    expect(await f.readText(P.log)).toBe(fixtureLogText());
    expect(await f.list(P.backupDir)).toEqual([]);
  });

  it("stops when the game starts between backup and write", async () => {
    const f = folder();
    let calls = 0;
    const res = await deleteBranches(
      { folder: f, dataRoot: ROOT, data, checkStopped: async () => (calls++ === 0 ? null : GAME_RUNNING_MESSAGE) }, { mode: "delete", ids: [2] },
    );
    expect(res.ok).toBe(false);
    expect(await f.readText(P.log)).toBe(fixtureLogText());
  });

  it("keeps only the newest five backups and undo restores the latest one", async () => {
    const f = folder();
    let t = 1;
    const deps = { folder: f, dataRoot: ROOT, data, checkStopped: async () => null, now: () => t++ };
    // 같은 갈래를 계속 지울 수는 없으니, 지울 때마다 원래 기록으로 되돌려 둔다
    for (let i = 0; i < 7; i++) {
      await f.writeText(P.log, fixtureLogText());
      await f.remove(P.archive);
      expect((await deleteBranches(deps, { mode: "delete", ids: [3] })).ok).toBe(true);
    }
    expect((await f.list(P.backupDir)).filter(n => n.endsWith(".jsonl")).sort()).toEqual(
      ["log-3.jsonl", "log-4.jsonl", "log-5.jsonl", "log-6.jsonl", "log-7.jsonl"],
    );
    expect(await latestBackupTime(f, ROOT)).toBe(7);
    // 지운 뒤 새로 쌓인 기록은 되돌려도 남는다
    f.appendText(P.log, JSON.stringify({ v: 1, seq: 40, t: 1, run: 1, branch: 1, type: "save", slot: 2 }) + "\n");
    const undo = await undoLastDeletion({ folder: f, dataRoot: ROOT, checkStopped: async () => null });
    expect(undo.ok).toBe(true);
    const restored = parseLogText((await f.readText(P.log))!).records.map(r => r.seq);
    expect(restored).toEqual([...fixtureRecords().map(r => r.seq), 40]);
    expect(await f.readText(P.archive)).toBeNull();   // 그때는 보관이 없었다
    expect(await latestBackupTime(f, ROOT)).toBe(6);
  });

  it("undo refuses while running", async () => {
    const f = folder({ [`${P.backupDir}/log-5.jsonl`]: "x" });
    const r = await undoLastDeletion({ folder: f, dataRoot: ROOT, checkStopped: async () => GAME_RUNNING_MESSAGE });
    expect(r).toEqual({ ok: false, message: GAME_RUNNING_MESSAGE });
  });
});

describe("gameRunningBlock", () => {
  it("asks the launcher only when not connected and a path is known", async () => {
    let asked = 0;
    const fetchRunning = async () => { asked++; return { ok: true as const, running: true }; };
    expect(await gameRunningBlock(true, { launcher: true, gamePath: "C:/g", fetchRunning })).toBe(GAME_RUNNING_MESSAGE);
    expect(asked).toBe(0);
    expect(await gameRunningBlock(false, { launcher: true, gamePath: "C:/g", fetchRunning })).toBe(GAME_RUNNING_MESSAGE);
    expect(await gameRunningBlock(false, { launcher: true, gamePath: null, fetchRunning })).toBeNull();
    expect(await gameRunningBlock(false, { launcher: false, gamePath: "C:/g", fetchRunning })).toBeNull();
    expect(await gameRunningBlock(false, {
      launcher: true, gamePath: "C:/g", fetchRunning: async () => ({ ok: false as const, error: "x" }),
    })).toBeNull();
  });
});
