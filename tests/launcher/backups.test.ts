import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  backupIdFor, backupsDirOf, createBackup, deleteBackup, ERR_BAD_ID, ERR_NO_BACKUP, handleBackupRoute, hashDir,
  isValidBackupId, KEEP_AUTO, KEEP_SAFETY, listBackups, restoreBackup, saveDirOf, saveSignature, type GameLocation,
} from "../../scripts/backups";

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rpgv-backup-")); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const mz = (): GameLocation => ({ root: tmp, engine: "MZ" });
const mv = (): GameLocation => ({ root: tmp, engine: "MV" });

function write(abs: string, content: string) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}
function readTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string, rel: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else out[r] = fs.readFileSync(path.join(d, e.name), "utf8");
    }
  };
  walk(dir, "");
  return out;
}
let tick = 0;
const at = () => new Date(Date.UTC(2026, 9, 28, 0, 0, 0) + 1000 * tick++);

describe("save dirs and ids", () => {
  it("uses www/save for MV and save for MZ", () => {
    expect(saveDirOf(mv())).toBe(path.join(tmp, "www", "save"));
    expect(saveDirOf(mz())).toBe(path.join(tmp, "save"));
    expect(backupsDirOf(tmp)).toBe(path.join(tmp, "rpg-viewer", "backups"));
  });

  it("accepts only timestamp ids", () => {
    expect(isValidBackupId(backupIdFor(new Date()))).toBe(true);
    expect(isValidBackupId("20261028-101010-005-2")).toBe(true);
    for (const bad of ["..", "../x", "20261028-101010-005/..", "..\\20261028-101010-005", "", "abc", 5, null]) {
      expect(isValidBackupId(bad)).toBe(false);
    }
  });
});

describe("createBackup", () => {
  it("copies the whole save folder including global and nested files", () => {
    const save = saveDirOf(mv());
    write(path.join(save, "global.rpgsave"), "G");
    write(path.join(save, "file1.rpgsave"), "S1");
    write(path.join(save, "plugin", "data.json"), "P");
    write(path.join(tmp, "rpg-viewer", "log.jsonl"), "LOG");
    const r = createBackup(mv(), { kind: "manual", reason: "수동", name: " 보스 전 ", now: at() });
    expect(r.ok).toBe(true);
    const meta = r.ok ? r.backup! : null;
    expect(meta).toMatchObject({ kind: "manual", reason: "수동", name: "보스 전", fileCount: 3, bytes: 4 });
    expect(readTree(path.join(backupsDirOf(tmp), meta!.id, "files")))
      .toEqual({ "global.rpgsave": "G", "file1.rpgsave": "S1", "plugin/data.json": "P" });
    expect(fs.readFileSync(path.join(tmp, "rpg-viewer", "log.jsonl"), "utf8")).toBe("LOG");
    expect(listBackups(tmp).map((b) => b.id)).toEqual([meta!.id]);
  });

  it("snapshots a missing save folder as empty", () => {
    const r = createBackup(mz(), { kind: "manual", now: at() });
    expect(r.ok && r.backup!.fileCount).toBe(0);
  });

  it("skips an auto backup when nothing changed since the newest backup", () => {
    write(path.join(saveDirOf(mz()), "file1.rpgsave"), "A");
    expect(createBackup(mz(), { kind: "manual", now: at() })).toMatchObject({ ok: true });
    expect(createBackup(mz(), { kind: "auto", now: at() })).toEqual({ ok: true, skipped: true });
    write(path.join(saveDirOf(mz()), "file1.rpgsave"), "B");
    const r = createBackup(mz(), { kind: "auto", now: at() });
    expect(r.ok && r.backup?.kind).toBe("auto");
    // 수동은 같아도 만든다
    expect(createBackup(mz(), { kind: "manual", now: at() })).toMatchObject({ ok: true, backup: { kind: "manual" } });
  });

  it("keeps the newest auto and safety backups and never prunes manual ones", () => {
    const save = saveDirOf(mz());
    write(path.join(save, "m.rpgsave"), "m");
    createBackup(mz(), { kind: "manual", now: at() });
    for (let i = 0; i < KEEP_AUTO + 3; i++) {
      write(path.join(save, "file1.rpgsave"), `a${i}`);
      createBackup(mz(), { kind: "auto", now: at() });
    }
    for (let i = 0; i < KEEP_SAFETY + 2; i++) createBackup(mz(), { kind: "safety", now: at() });
    const all = listBackups(tmp);
    expect(all.filter((b) => b.kind === "auto")).toHaveLength(KEEP_AUTO);
    expect(all.filter((b) => b.kind === "safety")).toHaveLength(KEEP_SAFETY);
    expect(all.filter((b) => b.kind === "manual")).toHaveLength(1);
    // 새것부터
    expect(all.map((b) => b.createdAt)).toEqual([...all.map((b) => b.createdAt)].sort().reverse());
  });

  it("gives distinct ids within the same millisecond", () => {
    const now = at();
    const a = createBackup(mz(), { kind: "manual", now });
    const b = createBackup(mz(), { kind: "manual", now });
    expect(a.ok && b.ok && a.backup!.id !== b.backup!.id).toBe(true);
  });
});

describe("restoreBackup", () => {
  it("mirrors the snapshot exactly after a safety backup of the current state", () => {
    const save = saveDirOf(mv());
    write(path.join(save, "global.rpgsave"), "G1");
    write(path.join(save, "file1.rpgsave"), "S1");
    const snap = createBackup(mv(), { kind: "manual", now: at() });
    const id = snap.ok ? snap.backup!.id : "";

    write(path.join(save, "global.rpgsave"), "G2-broken");
    write(path.join(save, "file2.rpgsave"), "S2");
    write(path.join(save, "sub", "x.dat"), "X");

    const r = restoreBackup(mv(), id);
    expect(r.ok).toBe(true);
    expect(readTree(save)).toEqual({ "global.rpgsave": "G1", "file1.rpgsave": "S1" });

    const safety = listBackups(tmp).find((b) => b.kind === "safety")!;
    expect(safety.reason).toBe("복원 전");
    expect(readTree(path.join(backupsDirOf(tmp), safety.id, "files")))
      .toEqual({ "global.rpgsave": "G2-broken", "file1.rpgsave": "S1", "file2.rpgsave": "S2", "sub/x.dat": "X" });
    // 임시 폴더가 남지 않는다
    expect(fs.readdirSync(path.join(tmp, "www")).sort()).toEqual(["save"]);
  });

  it("creates the save folder when it is missing, and empties it for an empty snapshot", () => {
    const empty = createBackup(mz(), { kind: "manual", now: at() });
    write(path.join(saveDirOf(mz()), "file1.rpgsave"), "S");
    expect(restoreBackup(mz(), empty.ok ? empty.backup!.id : "").ok).toBe(true);
    expect(readTree(saveDirOf(mz()))).toEqual({});

    write(path.join(saveDirOf(mz()), "file1.rpgsave"), "S");
    const full = createBackup(mz(), { kind: "manual", now: at() });
    fs.rmSync(saveDirOf(mz()), { recursive: true });
    expect(restoreBackup(mz(), full.ok ? full.backup!.id : "").ok).toBe(true);
    expect(readTree(saveDirOf(mz()))).toEqual({ "file1.rpgsave": "S" });
  });

  it("does not prune the backup being restored", () => {
    write(path.join(saveDirOf(mz()), "a"), "1");
    const first = createBackup(mz(), { kind: "safety", now: at() });
    for (let i = 0; i < KEEP_SAFETY - 1; i++) createBackup(mz(), { kind: "safety", now: at() });
    const id = first.ok ? first.backup!.id : "";
    expect(restoreBackup(mz(), id).ok).toBe(true);
    expect(listBackups(tmp).some((b) => b.id === id)).toBe(true);
  });

  it("rejects bad or unknown ids without touching the save folder", () => {
    write(path.join(saveDirOf(mz()), "file1.rpgsave"), "S");
    fs.mkdirSync(path.join(tmp, "rpg-viewer", "backups"), { recursive: true });
    expect(restoreBackup(mz(), "../../save")).toEqual({ ok: false, error: ERR_BAD_ID });
    expect(restoreBackup(mz(), "20200101-000000-000")).toEqual({ ok: false, error: ERR_NO_BACKUP });
    expect(deleteBackup(mz(), "..")).toEqual({ ok: false, error: ERR_BAD_ID });
    expect(readTree(saveDirOf(mz()))).toEqual({ "file1.rpgsave": "S" });
    expect(listBackups(tmp)).toEqual([]);
  });
});

describe("routes", () => {
  it("lists, creates, deletes and reports a change signature", () => {
    const g = mz();
    const s0 = (handleBackupRoute("backups/state", g, {}) as { signature: string }).signature;
    write(path.join(saveDirOf(g), "file1.rpgsave"), "S");
    expect(saveSignature(g)).not.toBe(s0);
    expect(handleBackupRoute("backups/create", g, { kind: "bogus" })).toMatchObject({ ok: false });
    const c = handleBackupRoute("backups/create", g, { kind: "manual", name: "n" }) as { ok: true; backup: { id: string; hash: string } };
    expect(c.backup.hash).toBe(hashDir(saveDirOf(g)));
    expect((handleBackupRoute("backups/list", g, {}) as { backups: unknown[] }).backups).toHaveLength(1);
    expect(handleBackupRoute("backups/delete", g, { id: c.backup.id })).toEqual({ ok: true });
    expect((handleBackupRoute("backups/list", g, {}) as { backups: unknown[] }).backups).toHaveLength(0);
  });
});
