import type { WritableGameFolder } from "../fs/folder";
import { parseLogText } from "./log";
import type { LiveSnapshot, LogRecord } from "./types";

export interface TailResult { records: LogRecord[]; badLines: number; reset: boolean; changed: boolean }

const NONE: TailResult = { records: [], badLines: 0, reset: false, changed: false };

/** 로그 파일에서 새로 붙은 바이트만 읽는다. 마지막 개행 뒤 조각은 다음 poll로 이월. */
export class LogTail {
  private offset = 0;
  private carry = new Uint8Array(0);

  private folder: WritableGameFolder;
  private path: string;

  constructor(folder: WritableGameFolder, path: string) {
    this.folder = folder;
    this.path = path;
  }

  async poll(): Promise<TailResult> {
    try {
      const st = await this.folder.stat(this.path);
      if (!st) return { ...NONE };
      let reset = false;
      if (st.size < this.offset) {
        this.offset = 0;
        this.carry = new Uint8Array(0);
        reset = true;
      } else if (st.size === this.offset) {
        return { ...NONE };
      }
      const buf = await this.folder.readRange(this.path, this.offset, st.size);
      if (!buf) return { ...NONE };
      const fresh = new Uint8Array(buf);
      const all = new Uint8Array(this.carry.length + fresh.length);
      all.set(this.carry, 0);
      all.set(fresh, this.carry.length);
      this.offset += fresh.length;
      const nl = all.lastIndexOf(0x0a);
      this.carry = nl < 0 ? all : all.slice(nl + 1);
      if (nl < 0) return { ...NONE, reset, changed: reset };
      const { records, badLines } = parseLogText(new TextDecoder().decode(all.subarray(0, nl + 1)));
      return { records, badLines, reset, changed: reset || records.length > 0 || badLines > 0 };
    } catch {
      return { ...NONE };
    }
  }
}

export async function readLive(
  folder: WritableGameFolder, path: string, prevModified: number | null,
): Promise<{ snapshot: LiveSnapshot | null; modified: number | null; changed: boolean }> {
  try {
    const st = await folder.stat(path);
    if (!st) return { snapshot: null, modified: prevModified, changed: false };
    if (st.lastModified === prevModified) return { snapshot: null, modified: prevModified, changed: false };
    const text = await folder.readText(path);
    if (text == null) return { snapshot: null, modified: prevModified, changed: false };
    const data: unknown = JSON.parse(text);
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return { snapshot: null, modified: prevModified, changed: false };
    }
    return { snapshot: data as LiveSnapshot, modified: st.lastModified, changed: true };
  } catch {
    return { snapshot: null, modified: prevModified, changed: false };
  }
}
