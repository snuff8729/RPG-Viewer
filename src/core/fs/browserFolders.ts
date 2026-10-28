import { listChildren, resolveCaseInsensitive, type GameFolder } from "./folder";

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

async function getDir(root: FileSystemDirectoryHandle, name: string): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await root.getDirectoryHandle(name);
  } catch {
    const real = resolveCaseInsensitive(await childNames(root), name);
    if (real === null) return null;
    try {
      return await root.getDirectoryHandle(real);
    } catch {
      return null;
    }
  }
}

async function getFile(dir: FileSystemDirectoryHandle, name: string): Promise<FileSystemFileHandle | null> {
  try {
    return await dir.getFileHandle(name);
  } catch {
    const real = resolveCaseInsensitive(await childNames(dir), name);
    if (real === null) return null;
    try {
      return await dir.getFileHandle(real);
    } catch {
      return null;
    }
  }
}

export class DirectoryHandleFolder implements GameFolder {
  private handle: FileSystemDirectoryHandle;

  constructor(handle: FileSystemDirectoryHandle) {
    this.handle = handle;
  }

  private async dirOf(segments: string[]): Promise<FileSystemDirectoryHandle | null> {
    let cur: FileSystemDirectoryHandle | null = this.handle;
    for (const s of segments) {
      cur = await getDir(cur, s);
      if (!cur) return null;
    }
    return cur;
  }

  private async fileOf(path: string): Promise<File | null> {
    const segs = path.split("/").filter(Boolean);
    const name = segs.pop();
    if (!name) return null;
    const dir = await this.dirOf(segs);
    if (!dir) return null;
    const fh = await getFile(dir, name);
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
