import type { CheatOp } from "@/core/live/cheat";
import type { LiveSnapshot } from "@/core/live/types";
import type { GameData } from "@/core/types";

/** 치트 창의 각 탭이 받는 값 */
export interface CheatTabProps {
  data: GameData;
  /** 연결됐을 때의 지금 상태(아니면 null) */
  live: LiveSnapshot | null;
  /** 게임이 연결되지 않았거나 플러그인이 낮음 */
  disabled: boolean;
  /** 치트를 보내고 기록에 남긴다 */
  apply(ops: CheatOp[], label?: string): void;
}

/** 입력 글 → 정수(아니면 null) */
export function parseIntInput(text: string): number | null {
  const t = text.trim();
  if (!/^[-+]?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

/** 목록에 한 번에 보이는 최대 개수 */
export const LIST_LIMIT = 100;
