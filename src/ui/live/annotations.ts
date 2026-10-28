import type { EvalStatus } from "@/core/live/types";

/** 플러그인이 설치돼 있으면(noPlugin이 아니면) 판정·고른 기록 같은 라이브 힌트를 보여준다. */
export function liveHintsEnabled(connection: "noPlugin" | "waiting" | "connected" | "stale"): boolean {
  return connection !== "noPlugin";
}

export function conditionIcon(status: EvalStatus): "✓" | "✗" | "?" {
  return status === "met" ? "✓" : status === "unmet" ? "✗" : "?";
}
