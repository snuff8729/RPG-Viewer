/** 경로는 `/` 구분, 폴더 루트 기준 상대 경로. */
export interface GameFolder {
  readText(path: string): Promise<string | null>;
  readBinary(path: string): Promise<ArrayBuffer | null>;
  /**
   * readBinary와 같지만 "없음"(null)과 "읽기 실패"(throw: 네트워크·서버 오류 등)를 구분한다.
   * 없으면 readBinary의 null을 "없음"으로 본다.
   */
  readBinaryStrict?(path: string): Promise<ArrayBuffer | null>;
  /** 바로 아래 항목 이름만. 없으면 []. */
  list(dir: string): Promise<string[]>;
}

export interface FileStat {
  size: number;
  lastModified: number;
}

export interface WritableGameFolder extends GameFolder {
  stat(path: string): Promise<FileStat | null>;
  /** [start, end) 바이트. 파일 크기로 잘린다. 없으면 null. */
  readRange(path: string, start: number, end: number): Promise<ArrayBuffer | null>;
  /** 상위 폴더를 만들며 쓴다. 성공 여부. */
  writeText(path: string, text: string): Promise<boolean>;
  remove(path: string): Promise<boolean>;
  /** 권한 조회(요청 안 함). */
  canWrite(): Promise<boolean>;
  /** 권한 요청(사용자 제스처 안에서 호출). */
  requestWrite(): Promise<boolean>;
}

export function isWritableFolder(f: GameFolder): f is WritableGameFolder {
  const w = f as Partial<WritableGameFolder>;
  return (
    typeof w.stat === "function" &&
    typeof w.readRange === "function" &&
    typeof w.writeText === "function" &&
    typeof w.remove === "function" &&
    typeof w.canWrite === "function" &&
    typeof w.requestWrite === "function"
  );
}

/** 정확히 일치하면 그것, 아니면 소문자 비교로 첫 일치. */
export function resolveCaseInsensitive(names: string[], wanted: string): string | null {
  if (names.includes(wanted)) return wanted;
  const lw = wanted.toLowerCase();
  return names.find((n) => n.toLowerCase() === lw) ?? null;
}

function normalize(path: string): string {
  return path.split("/").filter((s) => s !== "" && s !== ".").join("/");
}

/** 경로 목록에서 dir 바로 아래 항목 이름(대소문자 무시 중복 제거)을 뽑는다. */
export function listChildren(paths: Iterable<string>, dir: string): string[] {
  const prefix = normalize(dir).toLowerCase();
  const out = new Map<string, string>();
  for (const path of paths) {
    let rest: string;
    if (prefix === "") rest = path;
    else if (path.toLowerCase().startsWith(prefix + "/")) rest = path.slice(prefix.length + 1);
    else continue;
    const name = rest.split("/")[0];
    if (name && !out.has(name.toLowerCase())) out.set(name.toLowerCase(), name);
  }
  return [...out.values()];
}

function toBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === "string" ? new TextEncoder().encode(data) : data;
}

export class MemoryFolder implements WritableGameFolder {
  private files = new Map<string, { path: string; data: string | Uint8Array; mtime: number }>();
  private clock = 0;

  constructor(files: Record<string, string | Uint8Array>) {
    for (const [p, data] of Object.entries(files)) {
      const path = normalize(p);
      this.files.set(path.toLowerCase(), { path, data, mtime: ++this.clock });
    }
  }

  private put(path: string, data: string | Uint8Array): void {
    const p = normalize(path);
    const key = p.toLowerCase();
    this.files.set(key, { path: this.files.get(key)?.path ?? p, data, mtime: ++this.clock });
  }

  /** 테스트용: 파일 끝에 텍스트를 덧붙인다(없으면 만든다). */
  appendText(path: string, text: string): void {
    const e = this.files.get(normalize(path).toLowerCase());
    const old = e ? toBytes(e.data) : new Uint8Array(0);
    const add = new TextEncoder().encode(text);
    const merged = new Uint8Array(old.length + add.length);
    merged.set(old, 0);
    merged.set(add, old.length);
    this.put(path, merged);
  }

  async stat(path: string): Promise<FileStat | null> {
    const e = this.files.get(normalize(path).toLowerCase());
    return e ? { size: toBytes(e.data).byteLength, lastModified: e.mtime } : null;
  }

  async readRange(path: string, start: number, end: number): Promise<ArrayBuffer | null> {
    const e = this.files.get(normalize(path).toLowerCase());
    if (!e) return null;
    const bytes = toBytes(e.data);
    const s = Math.max(0, Math.min(start, bytes.byteLength));
    const t = Math.max(s, Math.min(end, bytes.byteLength));
    return bytes.slice(s, t).buffer as ArrayBuffer;
  }

  async writeText(path: string, text: string): Promise<boolean> {
    this.put(path, text);
    return true;
  }

  async remove(path: string): Promise<boolean> {
    return this.files.delete(normalize(path).toLowerCase());
  }

  async canWrite(): Promise<boolean> {
    return true;
  }

  async requestWrite(): Promise<boolean> {
    return true;
  }

  async readText(path: string): Promise<string | null> {
    const e = this.files.get(normalize(path).toLowerCase());
    if (!e) return null;
    return typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data);
  }

  async readBinary(path: string): Promise<ArrayBuffer | null> {
    const e = this.files.get(normalize(path).toLowerCase());
    if (!e) return null;
    const bytes = typeof e.data === "string" ? new TextEncoder().encode(e.data) : e.data;
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  async list(dir: string): Promise<string[]> {
    return listChildren([...this.files.values()].map((e) => e.path), dir);
  }
}
