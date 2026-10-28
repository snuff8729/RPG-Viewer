import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LiveSnapshot, LogRecord } from "../../src/core/live/types";

const LOGS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "fixtures", "logs");

/** sample-mz 기록 파일 원문 (깨진 줄 포함) */
export function fixtureLogText(): string {
  return readFileSync(join(LOGS, "sample-mz.log.jsonl"), "utf8");
}

/** sample-mz 실시간 상태 스냅샷 */
export function fixtureLive(): LiveSnapshot {
  return JSON.parse(readFileSync(join(LOGS, "sample-mz.live.json"), "utf8")) as LiveSnapshot;
}

/** 테스트 편의: 각 줄을 JSON.parse, 깨진 줄은 건너뛴다 (기록 파서에 의존하지 않음). */
export function fixtureRecords(): LogRecord[] {
  const out: LogRecord[] = [];
  for (const line of fixtureLogText().split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as LogRecord); } catch { /* 깨진 줄 */ }
  }
  return out;
}
