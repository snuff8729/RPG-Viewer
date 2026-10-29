import type { ReactNode } from "react";
import type { AssistCommandKind } from "@/core/live/assist";
import { battleOnly, type AssistFavoriteId } from "@/core/live/favoritesFile";

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

/** 보조 즐겨찾기(맨 위 줄)에 올릴 수 있는 것: 게임 보조 조작 + 백업·복원(BackupControls) */
export const BACKUP_ITEMS = [
  { id: "backup", label: "지금 백업" },
  { id: "restore", label: "마지막 백업으로 복원" },
] as const;

export type BackupItemId = (typeof BACKUP_ITEMS)[number]["id"];

/** 보조 즐겨찾기 id 하나의 이름 */
export function assistFavoriteLabel(id: AssistItemId | BackupItemId): string {
  return BACKUP_ITEMS.find((i) => i.id === id)?.label ?? assistItemLabel(id as AssistItemId);
}

/**
 * 맨 위 줄에 지금 보일 즐겨찾기(순서 유지): 전투 기능은 전투 중에만. battleFirst면 전투 중에 전투 기능을 맨 앞으로(휴대폰).
 * hidden = 이 화면에서 그리지 않는 것(예: 휴대폰 보기의 백업·복원).
 */
export function visibleAssistFavorites(
  ids: readonly AssistFavoriteId[], inBattle: boolean, opts: { battleFirst?: boolean; hidden?: readonly AssistFavoriteId[] } = {},
): AssistFavoriteId[] {
  const shown = ids.filter((id) => (inBattle || !battleOnly(id)) && !opts.hidden?.includes(id));
  if (!opts.battleFirst || !inBattle) return shown;
  return [...shown.filter(battleOnly), ...shown.filter((id) => !battleOnly(id))];
}

/** 키 이름 + 을/를(끝 글자를 한국어로 읽은 받침 기준: 0·1·3·6·7·8, L·M·N·R은 받침 있음). */
export function withObjectParticle(label: string): string {
  return `${label}${/[013678LMNR]$/.test(label) ? "을" : "를"}`;
}

/** 조작 옆에 둘 것(예: 즐겨찾기 ☆)을 id로 그려 준다 */
export type AssistFavoriteSlot = (id: AssistItemId) => ReactNode;
