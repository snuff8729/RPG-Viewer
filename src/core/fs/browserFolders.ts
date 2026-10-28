import { listChildren, type FileStat, type GameFolder, type WritableGameFolder } from "./folder";

// 브라우저 전용. lib.dom에 비동기 이터레이터 타입이 없을 수 있어 최소 타입을 둔다.
type IterableDir = FileSystemDirectoryHandle & { keys(): AsyncIterable<string> };

async function childNames(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const name of (dir as IterableDir).keys()) names.push(name);
  } catch {
    /* 나열 실패는 빈 목록으로 */
  }
  return names;
}

/** 대소문자·유니코드 정규화(NFC/NFD)를 무시한 이름 비교 키. */
const nameKey = (s: string) => s.normalize("NFC").toLowerCase();

/**
 * 핸들 객체는 호출마다 새로 만들어질 수 있으므로, 디렉터리는 폴더 루트 기준 경로(소문자)로 식별한다.
 * 각 디렉터리의 `소문자 이름 → 실제 이름` 표는 처음 필요할 때 한 번만 나열해 만든다.
 */
export class DirectoryHandleFolder implements WritableGameFolder {
  private dirs = new Map<string, Promise<FileSystemDirectoryHandle | null>>();
  private names = new Map<string, Promise<Map<string, string>>>();

  private root: FileSystemDirectoryHandle;

  constructor(root: FileSystemDirectoryHandle) {
    this.root = root;
    this.dirs.set("", Promise.resolve(root));
  }

  /** 디렉터리(key) 안 이름을 대소문자 무시로 실제 이름으로 바꾼다. 나열은 디렉터리당 한 번. */
  private async realName(key: string, dir: FileSystemDirectoryHandle, name: string): Promise<string | null> {
    let table = this.names.get(key);
    if (!table) {
      table = childNames(dir).then((all) => {
        const m = new Map<string, string>();
        for (const n of all) if (!m.has(nameKey(n))) m.set(nameKey(n), n);
        return m;
      });
      this.names.set(key, table);
    }
    return (await table).get(nameKey(name)) ?? null;
  }

  private dirOf(segments: string[]): Promise<FileSystemDirectoryHandle | null> {
    const key = segments.join("/").toLowerCase();
    let p = this.dirs.get(key);
    if (!p) {
      p = (async () => {
        const name = segments[segments.length - 1];
        const parentSegs = segments.slice(0, -1);
        const parent = await this.dirOf(parentSegs);
        if (!parent) return null;
        try {
          return await parent.getDirectoryHandle(name);
        } catch {
          const real = await this.realName(parentSegs.join("/").toLowerCase(), parent, name);
          if (real === null || real === name) return null;
          try {
            return await parent.getDirectoryHandle(real);
          } catch {
            return null;
          }
        }
      })();
      this.dirs.set(key, p);
      // 없던 디렉터리는 기억하지 않는다: 나중에 (게임이) 만든 rpg-viewer/ 등을 다시 찾을 수 있게.
      const pending = p;
      void pending.then((d) => {
        if (d === null && this.dirs.get(key) === pending) this.dirs.delete(key);
      });
    }
    return p;
  }

  private async fileHandleOf(path: string): Promise<{ fh: FileSystemFileHandle; dir: FileSystemDirectoryHandle; name: string } | null> {
    const segs = path.split("/").filter(Boolean);
    const name = segs.pop();
    if (!name) return null;
    const dir = await this.dirOf(segs);
    if (!dir) return null;
    try {
      return { fh: await dir.getFileHandle(name), dir, name };
    } catch {
      const real = await this.realName(segs.join("/").toLowerCase(), dir, name);
      if (real === null || real === name) return null;
      try {
        return { fh: await dir.getFileHandle(real), dir, name: real };
      } catch {
        return null;
      }
    }
  }

  private async fileOf(path: string): Promise<File | null> {
    const h = await this.fileHandleOf(path);
    if (!h) return null;
    try {
      return await h.fh.getFile();
    } catch {
      return null;
    }
  }

  /** 새 항목 이름을 해당 디렉터리의 이름 표에 반영한다(표가 아직 없으면 나중에 실제 나열로 만들어진다). */
  private async learn(key: string, name: string): Promise<void> {
    const t = this.names.get(key);
    if (t) (await t).set(nameKey(name), name);
  }

  /** 디렉터리를 (없으면 만들며) 얻는다. */
  private async ensureDir(segments: string[]): Promise<FileSystemDirectoryHandle | null> {
    const existing = await this.dirOf(segments);
    if (existing) return existing;
    if (segments.length === 0) return null;
    const parentSegs = segments.slice(0, -1);
    const parent = await this.ensureDir(parentSegs);
    if (!parent) return null;
    const name = segments[segments.length - 1];
    try {
      const d = await parent.getDirectoryHandle(name, { create: true });
      this.dirs.set(segments.join("/").toLowerCase(), Promise.resolve(d));
      await this.learn(parentSegs.join("/").toLowerCase(), name);
      return d;
    } catch {
      return null;
    }
  }

  async readText(path: string): Promise<string | null> {
    const f = await this.fileOf(path);
    try {
      return f ? await f.text() : null;
    } catch {
      return null;
    }
  }

  async readBinary(path: string): Promise<ArrayBuffer | null> {
    const f = await this.fileOf(path);
    try {
      return f ? await f.arrayBuffer() : null;
    } catch {
      return null;
    }
  }

  async list(dir: string): Promise<string[]> {
    const d = await this.dirOf(dir.split("/").filter(Boolean));
    return d ? childNames(d) : [];
  }

  async stat(path: string): Promise<FileStat | null> {
    const f = await this.fileOf(path);
    try {
      return f ? { size: f.size, lastModified: f.lastModified } : null;
    } catch {
      return null;
    }
  }

  async readRange(path: string, start: number, end: number): Promise<ArrayBuffer | null> {
    const f = await this.fileOf(path);
    if (!f) return null;
    const s = Math.max(0, start);
    try {
      return await f.slice(s, Math.max(s, end)).arrayBuffer();
    } catch {
      return null;
    }
  }

  async writeText(path: string, text: string): Promise<boolean> {
    try {
      const segs = path.split("/").filter(Boolean);
      const name = segs.pop();
      if (!name) return false;
      const dir = await this.ensureDir(segs);
      if (!dir) return false;
      const existing = await this.fileHandleOf(path);
      const key = segs.join("/").toLowerCase();
      const fh = existing ? existing.fh : await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      try {
        await w.write(text);
        await w.close();
      } catch {
        try {
          await (w as unknown as { abort?: () => Promise<void> }).abort?.();
        } catch {
          /* ignore */
        }
        return false;
      }
      if (!existing) await this.learn(key, name);
      return true;
    } catch {
      return false;
    }
  }

  async remove(path: string): Promise<boolean> {
    const h = await this.fileHandleOf(path);
    if (!h) return false;
    try {
      await h.dir.removeEntry(h.name);
      const segs = path.split("/").filter(Boolean);
      segs.pop();
      const t = this.names.get(segs.join("/").toLowerCase());
      if (t) (await t).delete(nameKey(h.name));
      return true;
    } catch {
      return false;
    }
  }

  async canWrite(): Promise<boolean> {
    const h = this.root as unknown as { queryPermission?: (d: { mode: string }) => Promise<string> };
    if (typeof h.queryPermission !== "function") return false;
    try {
      return (await h.queryPermission({ mode: "readwrite" })) === "granted";
    } catch {
      return false;
    }
  }

  async requestWrite(): Promise<boolean> {
    const h = this.root as unknown as { requestPermission?: (d: { mode: string }) => Promise<string> };
    if (typeof h.requestPermission !== "function") return false;
    try {
      return (await h.requestPermission({ mode: "readwrite" })) === "granted";
    } catch {
      return false;
    }
  }
}

export class FileListFolder implements GameFolder {
  private map = new Map<string, File>();
  private paths: string[] = [];

  constructor(files: FileList) {
    for (const f of Array.from(files)) {
      // 첫 세그먼트는 사용자가 선택한 폴더 이름이므로 뗀다.
      const rel = (f.webkitRelativePath || f.name).split("/").slice(1).join("/");
      if (!rel) continue;
      this.map.set(rel.toLowerCase(), f);
      this.paths.push(rel);
    }
  }

  private find(path: string): File | undefined {
    return this.map.get(path.split("/").filter(Boolean).join("/").toLowerCase());
  }

  async readText(path: string): Promise<string | null> {
    const f = this.find(path);
    return f ? await f.text() : null;
  }

  async readBinary(path: string): Promise<ArrayBuffer | null> {
    const f = this.find(path);
    return f ? await f.arrayBuffer() : null;
  }

  async list(dir: string): Promise<string[]> {
    return listChildren(this.paths, dir);
  }
}
