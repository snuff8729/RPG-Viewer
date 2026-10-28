import type { LogRecord } from "./types";

/** 기록 파일 원문(JSONL)을 기록 목록으로. 빈 줄은 무시, 해석 못 하는 줄은 badLines로 센다. 예외를 던지지 않는다. */
export function parseLogText(text: string): { records: LogRecord[]; badLines: number } {
  const records: LogRecord[] = [];
  let badLines = 0;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const r = parseLogLine(line);
    if (r) records.push(r);
    else badLines++;
  }
  return { records, badLines };
}

/** 기록 한 줄(앞뒤 공백 제거, 비어 있지 않음) → 기록. 해석 못 하면 null. 예외를 던지지 않는다. */
export function parseLogLine(line: string): LogRecord | null {
  let value: unknown;
  try { value = JSON.parse(line); } catch { return null; }
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is LogRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const o = value as Record<string, unknown>;
  return o.v === 1 && typeof o.type === "string" && o.type !== "" && typeof o.seq === "number" && Number.isFinite(o.seq);
}
