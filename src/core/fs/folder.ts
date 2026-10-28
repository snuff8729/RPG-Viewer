/** 경로는 `/` 구분, 폴더 루트 기준 상대 경로. */
export interface GameFolder {
  readText(path: string): Promise<string | null>;
  readBinary(path: string): Promise<ArrayBuffer | null>;
  /** 바로 아래 항목 이름만. 없으면 []. */
  list(dir: string): Promise<string[]>;
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

export class MemoryFolder implements GameFolder {
  private files = new Map<string, { path: string; data: string | Uint8Array }>();

  constructor(files: Record<string, string | Uint8Array>) {
    for (const [p, data] of Object.entries(files)) {
      const path = normalize(p);
      this.files.set(path.toLowerCase(), { path, data });
    }
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
