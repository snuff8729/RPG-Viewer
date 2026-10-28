import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  backupIdFor, backupsDirOf, createBackup, deleteBackup, ERR_BAD_ID, ERR_NO_BACKUP, handleBackupRoute, hashDir,
  isValidBackupId, KEEP_AUTO, KEEP_SAFETY, listBackups, restoreBackup, saveDirOf, saveSignature, type GameLocation,
  backupSaveRel, ERR_BAD_SAVE_DIR, pluginSaveRels, resolveSaveDir, safeSaveRel, saveFilesMissing,
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

function writePlugins(engine: "MV" | "MZ", plugins: { name: string; status: boolean; parameters: Record<string, string> }[]) {
  const file = engine === "MV" ? path.join(tmp, "www", "js", "plugins.js") : path.join(tmp, "js", "plugins.js");
  write(file, `// Generated by RPG Maker.\nvar $plugins =\n${JSON.stringify(plugins).replace(/\},\{/g, "},\n{")};\n`);
}
const relocation = (BaseAt: string, RelatedName: string, status = true) =>
  ({ name: "SavePathRelocation", status, parameters: { BaseAt, RelatedName } });

describe("resolveSaveDir", () => {
  it("follows SavePathRelocation BaseAt exe to <root>/save for MV", () => {
    writePlugins("MV", [relocation("exe", "save")]);
    write(path.join(tmp, "save", "file1.rpgsave"), "S");
    write(path.join(tmp, "save", "global.rpgsave"), "G");
    expect(resolveSaveDir(tmp, "MV")).toEqual({ rel: "save", abs: path.join(tmp, "save"), hasSaves: true });
    // 세이브가 아직 없어도 플러그인 폴더를 쓴다
    fs.rmSync(path.join(tmp, "save"), { recursive: true });
    expect(resolveSaveDir(tmp, "MV")).toMatchObject({ rel: "save", hasSaves: false });
  });

  it("follows SavePathRelocation BaseAt www relative to the www folder", () => {
    writePlugins("MV", [relocation("www", "mysave")]);
    expect(resolveSaveDir(tmp, "MV")).toMatchObject({ rel: "www/mysave", hasSaves: false });
    writePlugins("MZ", [relocation("www", "mysave")]);
    expect(resolveSaveDir(tmp, "MZ")).toMatchObject({ rel: "mysave" });
    writePlugins("MV", [relocation("exe", "data/saves")]);
    expect(resolveSaveDir(tmp, "MV").rel).toBe("data/saves");
  });

  it("ignores a disabled SavePathRelocation", () => {
    writePlugins("MV", [relocation("exe", "elsewhere", false)]);
    expect(resolveSaveDir(tmp, "MV").rel).toBe("www/save");
  });

  it("uses a generic save-path parameter only when it holds save files", () => {
    writePlugins("MZ", [{ name: "OtherSaver", status: true, parameters: { SaveFolderPath: "userdata/saves", Other: "x" } }]);
    expect(resolveSaveDir(tmp, "MZ").rel).toBe("save");
    write(path.join(tmp, "userdata", "saves", "file1.rmmzsave"), "S");
    expect(resolveSaveDir(tmp, "MZ")).toMatchObject({ rel: "userdata/saves", hasSaves: true });
    expect(pluginSaveRels(tmp, "MZ")).toEqual({ primary: [], guessed: ["userdata/saves"] });
  });

  it("falls back to save then www/save, picking the first with save files", () => {
    expect(resolveSaveDir(tmp, "MV").rel).toBe("www/save");
    expect(resolveSaveDir(tmp, "MZ").rel).toBe("save");
    write(path.join(tmp, "www", "save", "file1.rpgsave"), "W");
    expect(resolveSaveDir(tmp, "MZ").rel).toBe("www/save");
    write(path.join(tmp, "save", "notes.txt"), "not a save");
    expect(resolveSaveDir(tmp, "MV").rel).toBe("www/save");
    write(path.join(tmp, "save", "file1.rpgsave"), "R");
    expect(resolveSaveDir(tmp, "MV").rel).toBe("save");
    // 플러그인 폴더가 비어 있으면 세이브가 있는 기본 폴더를 쓴다
    writePlugins("MV", [relocation("exe", "empty")]);
    expect(resolveSaveDir(tmp, "MV").rel).toBe("save");
  });

  it("rejects save dirs outside the game root", () => {
    for (const bad of ["../outside", "..", "save/../../x", "C:\\abs", "/abs", "\\\\server\\share", "", ".", "www", "rpg-viewer/backups"]) {
      expect(safeSaveRel(tmp, tmp, bad)).toBeNull();
    }
    expect(safeSaveRel(tmp, path.join(tmp, "www"), "..")).toBeNull();
    expect(safeSaveRel(tmp, path.join(tmp, "www"), "../save")).toBe("save");
    const outside = path.join(path.dirname(tmp), `${path.basename(tmp)}-escape`);
    write(path.join(outside, "file1.rpgsave"), "X");
    try {
      const rel = `../${path.basename(outside)}`;
      writePlugins("MV", [relocation("exe", rel), { name: "Gen", status: true, parameters: { savePath: rel } }]);
      expect(resolveSaveDir(tmp, "MV").rel).toBe("www/save");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("survives a broken plugins.js", () => {
    write(path.join(tmp, "js", "plugins.js"), "var $plugins = [ nope");
    expect(resolveSaveDir(tmp, "MZ").rel).toBe("save");
  });

  it("flags NW.js games with no save files anywhere", () => {
    expect(saveFilesMissing(mv())).toBe(false);
    write(path.join(tmp, "package.json"), "{}");
    expect(saveFilesMissing(mv())).toBe(true);
    write(path.join(tmp, "save", "file1.rpgsave"), "S");
    expect(saveFilesMissing(mv())).toBe(false);
  });
});

describe("relocated saves", () => {
  it("backs up and restores the relocated folder, recording it in meta.json", () => {
    writePlugins("MV", [relocation("exe", "save")]);
    const save = path.join(tmp, "save");
    write(path.join(save, "file1.rpgsave"), "S1");
    write(path.join(save, "global.rpgsave"), "G1");
    const snap = createBackup(mv(), { kind: "manual", now: at() });
    expect(snap.ok && snap.backup).toMatchObject({ fileCount: 2, saveDir: "save" });
    const id = snap.ok ? snap.backup!.id : "";
    expect(JSON.parse(fs.readFileSync(path.join(backupsDirOf(tmp), id, "meta.json"), "utf8")).saveDir).toBe("save");
    write(path.join(save, "file1.rpgsave"), "S2");
    expect(restoreBackup(mv(), id).ok).toBe(true);
    expect(readTree(save)).toEqual({ "file1.rpgsave": "S1", "global.rpgsave": "G1" });
    expect(fs.existsSync(path.join(tmp, "www", "save"))).toBe(false);
    expect(listBackups(tmp).find((b) => b.kind === "safety")?.saveDir).toBe("save");
    const list = handleBackupRoute("backups/list", mv(), {}) as { saveDir: string; saveFilesMissing: boolean };
    expect(list).toMatchObject({ saveDir: "save", saveFilesMissing: false });
  });

  it("restores into the folder recorded in the backup, legacy backups into the old default", () => {
    write(path.join(tmp, "www", "save", "file1.rpgsave"), "W");
    const snap = createBackup(mv(), { kind: "manual", now: at() });
    const id = snap.ok ? snap.backup!.id : "";
    // 이후 세이브가 save에 생겨도 이 백업은 www/save로 되돌린다
    write(path.join(tmp, "save", "file1.rpgsave"), "R");
    fs.writeFileSync(path.join(tmp, "www", "save", "file1.rpgsave"), "W2");
    expect(restoreBackup(mv(), id).ok).toBe(true);
    expect(readTree(path.join(tmp, "www", "save"))).toEqual({ "file1.rpgsave": "W" });
    expect(readTree(path.join(tmp, "save"))).toEqual({ "file1.rpgsave": "R" });

    expect(backupSaveRel(mv(), {})).toBe("www/save");
    expect(backupSaveRel(mz(), {})).toBe("save");
    const metaFile = path.join(backupsDirOf(tmp), id, "meta.json");
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    meta.saveDir = "../evil";
    fs.writeFileSync(metaFile, JSON.stringify(meta));
    expect(restoreBackup(mv(), id)).toEqual({ ok: false, error: ERR_BAD_SAVE_DIR });
  });

  it("skips auto backups when there is nothing to back up", () => {
    expect(createBackup(mv(), { kind: "auto", now: at() })).toEqual({ ok: true, skipped: true });
    expect(listBackups(tmp)).toEqual([]);
  });
});
