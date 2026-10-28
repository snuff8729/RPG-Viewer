import { listChildren, type GameFolder } from "./folder";

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

/**
 * 핸들 객체는 호출마다 새로 만들어질 수 있으므로, 디렉터리는 폴더 루트 기준 경로(소문자)로 식별한다.
 * 각 디렉터리의 `소문자 이름 → 실제 이름` 표는 처음 필요할 때 한 번만 나열해 만든다.
 */
export class DirectoryHandleFolder implements GameFolder {
  private dirs = new Map<string, Promise<FileSystemDirectoryHandle | null>>();
  private names = new Map<string, Promise<Map<string, string>>>();

  constructor(handle: FileSystemDirectoryHandle) {
    this.dirs.set("", Promise.resolve(handle));
  }

  /** 디렉터리(key) 안 이름을 대소문자 무시로 실제 이름으로 바꾼다. 나열은 디렉터리당 한 번. */
  private async realName(key: string, dir: FileSystemDirectoryHandle, name: string): Promise<string | null> {
    let table = this.names.get(key);
    if (!table) {
      table = childNames(dir).then((all) => {
        const m = new Map<string, string>();
        for (const n of all) if (!m.has(n.toLowerCase())) m.set(n.toLowerCase(), n);
        return m;
      });
      this.names.set(key, table);
    }
    return (await table).get(name.toLowerCase()) ?? null;
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
    }
    return p;
  }

  private async fileOf(path: string): Promise<File | null> {
    const segs = path.split("/").filter(Boolean);
    const name = segs.pop();
    if (!name) return null;
    const dir = await this.dirOf(segs);
    if (!dir) return null;
    let fh: FileSystemFileHandle | null = null;
    try {
      fh = await dir.getFileHandle(name);
    } catch {
      const real = await this.realName(segs.join("/").toLowerCase(), dir, name);
      if (real !== null && real !== name) {
        try {
          fh = await dir.getFileHandle(real);
        } catch {
          fh = null;
        }
      }
    }
    if (!fh) return null;
    try {
      return await fh.getFile();
    } catch {
      return null;
    }
  }

  async readText(path: string): Promise<string | null> {
    const f = await this.fileOf(path);
    return f ? await f.text() : null;
  }

  async readBinary(path: string): Promise<ArrayBuffer | null> {
    const f = await this.fileOf(path);
    return f ? await f.arrayBuffer() : null;
  }

  async list(dir: string): Promise<string[]> {
    const d = await this.dirOf(dir.split("/").filter(Boolean));
    return d ? childNames(d) : [];
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
