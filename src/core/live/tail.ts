import type { WritableGameFolder } from "../fs/folder";
import { parseLogText } from "./log";
import type { LiveSnapshot, LogRecord } from "./types";

/** eof: 이번 poll 뒤 파일 끝까지 읽은 것이 확실함(파일 없음 포함). 읽기 실패·예외면 false. */
export interface TailResult { records: LogRecord[]; badLines: number; reset: boolean; changed: boolean; more: boolean; eof: boolean }

const NONE: TailResult = { records: [], badLines: 0, reset: false, changed: false, more: false, eof: false };
const DEFAULT_CHUNK = 4 * 1024 * 1024;

/** 로그 파일에서 새로 붙은 바이트만 읽는다. 마지막 개행 뒤 조각은 다음 poll로 이월. */
export class LogTail {
  private folder: WritableGameFolder;
  private path: string;
  private chunkBytes: number;
  private offset = 0;
  private carry = new Uint8Array(0);
  private pendingReset = false;
  private inflight: Promise<TailResult> | null = null;

  constructor(folder: WritableGameFolder, path: string, opts?: { chunkBytes?: number }) {
    this.folder = folder;
    this.path = path;
    this.chunkBytes = opts?.chunkBytes && opts.chunkBytes > 0 ? opts.chunkBytes : DEFAULT_CHUNK;
  }

  poll(): Promise<TailResult> {
    if (this.inflight) return this.inflight;
    const p = this.doPoll().finally(() => { this.inflight = null; });
    this.inflight = p;
    return p;
  }

  private async doPoll(): Promise<TailResult> {
    try {
      const st = await this.folder.stat(this.path);
      if (!st) return { ...NONE, eof: true };
      if (st.size < this.offset) this.pendingReset = true;
      const reset = this.pendingReset;
      const baseOffset = reset ? 0 : this.offset;
      const baseCarry = reset ? new Uint8Array(0) : this.carry;
      if (!reset && st.size === baseOffset) return { ...NONE, eof: true };
      const end = Math.min(st.size, baseOffset + this.chunkBytes);
      const buf = await this.folder.readRange(this.path, baseOffset, end);
      if (!buf) return { ...NONE };
      const fresh = new Uint8Array(buf);
      const all = new Uint8Array(baseCarry.length + fresh.length);
      all.set(baseCarry, 0);
      all.set(fresh, baseCarry.length);
      // 읽기 성공 후에만 상태 확정
      this.offset = baseOffset + fresh.length;
      this.pendingReset = false;
      const more = st.size > this.offset;
      const nl = all.lastIndexOf(0x0a);
      this.carry = nl < 0 ? all : all.slice(nl + 1);
      if (nl < 0) return { ...NONE, reset, changed: reset, more, eof: !more };
      const { records, badLines } = parseLogText(new TextDecoder().decode(all.subarray(0, nl + 1)));
      return { records, badLines, reset, changed: reset || records.length > 0 || badLines > 0, more, eof: !more };
    } catch {
      return { ...NONE };
    }
  }
}

export async function readLive(
  folder: WritableGameFolder, path: string, prevModified: number | null,
): Promise<{ snapshot: LiveSnapshot | null; modified: number | null; changed: boolean }> {
  const unchanged = { snapshot: null, modified: prevModified, changed: false };
  try {
    const st = await folder.stat(path);
    if (!st) return unchanged;
    if (st.lastModified === prevModified) return unchanged;
    const text = await folder.readText(path);
    if (text == null) return unchanged;
    const data: unknown = JSON.parse(text);
    if (typeof data !== "object" || data === null || Array.isArray(data)) return unchanged;
    const o = data as Record<string, unknown>;
    if (o.v !== 1 || typeof o.t !== "number" || typeof o.mapId !== "number") return unchanged;
    return { snapshot: data as LiveSnapshot, modified: st.lastModified, changed: true };
  } catch {
    return unchanged;
  }
}
