import type { ReactNode } from "react";
import type { AssistCommandKind } from "@/core/live/assist";

/**
 * 게임 보조 조작 하나하나의 고정 id(즐겨찾기 ☆가 이 id로 가리킨다)와 이름.
 * 백업·복원은 게임 보조가 아니라 BackupButton 쪽이라 여기 없다.
 */
export const ASSIST_ITEMS = [
  { id: "speed", label: "배속" },
  { id: "skipSeen", label: "본 대사 자동 넘기기" },
  { id: "autoFast", label: "본 이벤트 자동 배속" },
  { id: "win", label: "이기기" },
  { id: "lose", label: "지기" },
  { id: "escape", label: "도망" },
  { id: "enemyHpFull", label: "적 체력 100%" },
  { id: "enemyHpLow", label: "적 체력 1%" },
  { id: "hpFull", label: "체력 100%" },
  { id: "hpLow", label: "체력 1%" },
  { id: "quickSave", label: "퀵 세이브" },
  { id: "quickLoad", label: "퀵 로드" },
  { id: "saveMenu", label: "세이브 창" },
  { id: "loadMenu", label: "로드 창" },
] as const;

export type AssistItemId = (typeof ASSIST_ITEMS)[number]["id"];

/** 버튼 하나로 게임에 명령을 보내는 조작 */
export type AssistCommandItemId = Extract<AssistItemId, AssistCommandKind>;

export function assistItemLabel(id: AssistItemId): string {
  return ASSIST_ITEMS.find((i) => i.id === id)?.label ?? id;
}

/** 조작 옆에 둘 것(예: 즐겨찾기 ☆)을 id로 그려 준다 */
export type AssistFavoriteSlot = (id: AssistItemId) => ReactNode;
