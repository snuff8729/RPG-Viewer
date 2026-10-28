import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBackup, listBackups, saveDirOf } from "../../scripts/backups";
import { ERR_STILL_RUNNING, GameProcesses, parsePids, type ProcessOps } from "../../scripts/gameProcess";
import { restartRestore, type SpawnedLike, type SpawnFn } from "../../scripts/launcher";

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rpgv-proc-")); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

/** 가짜 프로세스 표: 실행 파일 → pid. kill하면 `dieAfter`번 조회 뒤 사라진다. */
function fakeOps(opts: { running?: Record<string, number[]>; queryFails?: boolean; dieAfter?: number; neverDies?: boolean } = {}) {
  const table = new Map<number, string>();
  for (const [exe, pids] of Object.entries(opts.running ?? {})) for (const p of pids) table.set(p, exe.toLowerCase());
  const dying = new Map<number, number>();
  const log: string[] = [];
  const ops: ProcessOps = {
    async findByExe(exe) {
      for (const [pid, left] of [...dying]) {
        if (left <= 0) { table.delete(pid); dying.delete(pid); } else dying.set(pid, left - 1);
      }
      log.push("find");
      if (opts.queryFails) return null;
      return [...table].filter(([, e]) => e === exe.toLowerCase()).map(([p]) => p);
    },
    async killTree(pid) {
      log.push(`kill ${pid}`);
      if (!opts.neverDies) dying.set(pid, opts.dieAfter ?? 0);
    },
    isAlive: (pid) => table.has(pid),
    async sleep() { log.push("sleep"); },
  };
  return { ops, log, table };
}

describe("parsePids", () => {
  it("reads one pid per line", () => {
    expect(parsePids("123\r\n 456 \r\n\r\nabc\r\n123\r\n")).toEqual([123, 456]);
    expect(parsePids("")).toEqual([]);
  });
});

describe("GameProcesses", () => {
  const exe = "C:\\Games\\A\\Game.exe";

  it("finds processes by exe path, case-insensitively", async () => {
    const { ops } = fakeOps({ running: { [exe.toUpperCase()]: [10, 11], "C:\\Other\\Game.exe": [20] } });
    expect(await new GameProcesses(ops).find(exe)).toEqual([10, 11]);
  });

  it("falls back to tracked pids that are still alive when the query fails", async () => {
    const { ops } = fakeOps({ running: { [exe]: [10] }, queryFails: true });
    const procs = new GameProcesses(ops);
    expect(await procs.running(exe)).toBe(false);
    procs.track(exe, 10);
    procs.track(exe, 99);
    expect(await procs.find(exe)).toEqual([10]);
  });

  it("kills the tree and waits until gone", async () => {
    const { ops, log } = fakeOps({ running: { [exe]: [10] }, dieAfter: 2 });
    expect(await new GameProcesses(ops).killAndWait(exe)).toEqual({ ok: true, killed: 1 });
    expect(log[0]).toBe("find");
    expect(log[1]).toBe("kill 10");
    expect(log).toContain("sleep");
  });

  it("gives up after the timeout", async () => {
    const { ops } = fakeOps({ running: { [exe]: [10] }, neverDies: true });
    expect(await new GameProcesses(ops).killAndWait(exe, 1000, 250)).toEqual({ ok: false, error: ERR_STILL_RUNNING });
  });
});

function fakeSpawn(log: string[]) {
  const spawn: SpawnFn = (command) => {
    log.push(`spawn ${path.basename(command)}`);
    const child: SpawnedLike = {
      pid: 4242,
      once(event: string, cb: (err: Error) => void) {
        if (event === "spawn") queueMicrotask(() => cb(undefined as unknown as Error));
        return child;
      },
      unref() {},
    };
    return child;
  };
  return spawn;
}

describe("restartRestore", () => {
  const setup = () => {
    const exe = path.join(tmp, "Game.exe");
    const game = { ok: true as const, root: tmp, title: "t", engine: "MZ" as const, exe };
    const save = saveDirOf(game);
    fs.mkdirSync(save, { recursive: true });
    fs.writeFileSync(path.join(save, "global.rpgsave"), "good");
    const b = createBackup(game, { kind: "manual" });
    fs.writeFileSync(path.join(save, "global.rpgsave"), "broken");
    return { game, exe, save, id: b.ok ? b.backup!.id : "" };
  };

  it("kills, waits, restores, then relaunches", async () => {
    const { game, exe, save, id } = setup();
    const { ops, log } = fakeOps({ running: { [exe]: [7] }, dieAfter: 1 });
    const procs = new GameProcesses(ops);
    const spawn = fakeSpawn(log);
    const origKill = ops.killTree;
    ops.killTree = async (pid) => {
      // 끄는 순간엔 아직 복원 전이어야 한다
      log.push(`content ${fs.readFileSync(path.join(save, "global.rpgsave"), "utf8")}`);
      await origKill(pid);
    };
    const r = await restartRestore(game, id, { launch: false }, { spawn, procs });
    expect(r).toEqual({ ok: true, killed: 1, relaunched: true });
    expect(fs.readFileSync(path.join(save, "global.rpgsave"), "utf8")).toBe("good");
    expect(log.indexOf("content broken")).toBeLessThan(log.indexOf("kill 7"));
    expect(log.lastIndexOf("find")).toBeLessThan(log.indexOf("spawn Game.exe"));
    expect(log.at(-1)).toBe("spawn Game.exe");
    expect(listBackups(tmp).some((b) => b.kind === "safety")).toBe(true);
  });

  it("does not restore when the game will not close", async () => {
    const { game, exe, save, id } = setup();
    const { ops, log } = fakeOps({ running: { [exe]: [7] }, neverDies: true });
    const r = await restartRestore(game, id, { launch: true }, { spawn: fakeSpawn(log), procs: new GameProcesses(ops), waitMs: 500 });
    expect(r).toEqual({ ok: false, error: ERR_STILL_RUNNING, killed: 0, relaunched: false });
    expect(fs.readFileSync(path.join(save, "global.rpgsave"), "utf8")).toBe("broken");
    expect(log.some((l) => l.startsWith("spawn"))).toBe(false);
  });

  it("restores without launching when the game is off, unless asked", async () => {
    const { game, id } = setup();
    const a = fakeOps();
    expect(await restartRestore(game, id, { launch: false }, { spawn: fakeSpawn(a.log), procs: new GameProcesses(a.ops) }))
      .toEqual({ ok: true, killed: 0, relaunched: false });
    const b = fakeOps();
    expect(await restartRestore(game, id, { launch: true }, { spawn: fakeSpawn(b.log), procs: new GameProcesses(b.ops) }))
      .toEqual({ ok: true, killed: 0, relaunched: true });
  });

  it("rejects bad ids before touching processes", async () => {
    const { game, exe } = setup();
    const { ops, log } = fakeOps({ running: { [exe]: [7] } });
    const r = await restartRestore(game, "../x", { launch: true }, { spawn: fakeSpawn(log), procs: new GameProcesses(ops) });
    expect(r.ok).toBe(false);
    expect(log).toEqual([]);
  });
});
