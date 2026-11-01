import type { ReactNode } from "react";
import {
  ASSIST_MIN_VERSION, ENEMY_HP_COMMAND_MIN_VERSION, HP_COMMAND_MIN_VERSION, SAVE_COMMAND_MIN_VERSION, type AssistCommandKind,
} from "@/core/live/assist";
import { battleOnly, type AssistFavoriteId } from "@/core/live/favoritesFile";

/**
 * 게임 보조 조작 하나하나의 고정 id(즐겨찾기 ☆가 이 id로 가리킨다)와 이름.
 * 백업·복원은 게임 보조가 아니라 관리의 세이브 백업 쪽이라 여기 없다.
 */
export const ASSIST_ITEMS = [
  { id: "speed", label: "배속", short: "배속" },
  { id: "walkSpeed", label: "이동 속도", short: "이동 속도" },
  { id: "skipSeen", label: "본 대사 자동 넘기기", short: "넘기기" },
  { id: "autoFast", label: "본 이벤트 자동 배속", short: "자동 배속" },
  { id: "noRandomEncounter", label: "랜덤 전투 끄기", short: "랜덤 전투 끔" },
  { id: "skipBattles", label: "전투 건너뛰기", short: "전투 건너뛰기" },
  { id: "skipKnownOnly", label: "잡아 본 적만", short: "잡아 본 적만" },
  { id: "win", label: "이기기", short: "이기기" },
  { id: "lose", label: "지기", short: "지기" },
  { id: "escape", label: "도망", short: "도망" },
  { id: "enemyHpFull", label: "적 체력 100%", short: "적 HP 100%" },
  { id: "enemyHpLow", label: "적 체력 1%", short: "적 HP 1%" },
  { id: "hpFull", label: "체력 100%", short: "HP 100%" },
  { id: "hpLow", label: "체력 1%", short: "HP 1%" },
  { id: "quickSave", label: "퀵 세이브", short: "퀵 세이브" },
  { id: "quickLoad", label: "퀵 로드", short: "퀵 로드" },
  { id: "saveMenu", label: "세이브 창", short: "세이브 창" },
  { id: "loadMenu", label: "로드 창", short: "로드 창" },
] as const;

export type AssistItemId = (typeof ASSIST_ITEMS)[number]["id"];

/** 버튼 하나로 게임에 명령을 보내는 조작 */
export type AssistCommandItemId = Extract<AssistItemId, AssistCommandKind>;

export function assistItemLabel(id: AssistItemId): string {
  return ASSIST_ITEMS.find((i) => i.id === id)?.label ?? id;
}

/** 맨 위 줄(즐겨찾기 줄)에 쓰는 짧은 이름. 보조 탭은 긴 이름(assistItemLabel). */
export function assistItemShortLabel(id: AssistItemId): string {
  return ASSIST_ITEMS.find((i) => i.id === id)?.short ?? assistItemLabel(id);
}

/** 보조 즐겨찾기(맨 위 줄)에 올릴 수 있는 것: 게임 보조 조작 + 백업·복원(BackupControls) */
export const BACKUP_ITEMS = [
  { id: "backup", label: "지금 백업", short: "백업" },
  { id: "restore", label: "마지막 백업으로 복원", short: "복원" },
] as const;

export type BackupItemId = (typeof BACKUP_ITEMS)[number]["id"];

/** 보조 즐겨찾기 id 하나의 이름 */
export function assistFavoriteLabel(id: AssistItemId | BackupItemId): string {
  return BACKUP_ITEMS.find((i) => i.id === id)?.label ?? assistItemLabel(id as AssistItemId);
}

/** 보조 즐겨찾기 id 하나의 짧은 이름(맨 위 줄) */
export function assistFavoriteShortLabel(id: AssistItemId | BackupItemId): string {
  return BACKUP_ITEMS.find((i) => i.id === id)?.short ?? assistItemShortLabel(id as AssistItemId);
}

/** 전투 막대(전투 중일 때 위쪽 막대 전체)의 버튼, 왼쪽부터 */
export const BATTLE_BAR_ITEMS = ["win", "escape", "lose", "enemyHpLow", "enemyHpFull", "hpFull"] as const satisfies readonly AssistCommandItemId[];

/** 전투 막대에 쓰는 이름(내 체력은 적 체력과 헷갈리지 않게) */
export function battleBarLabel(id: (typeof BATTLE_BAR_ITEMS)[number]): string {
  return id === "hpFull" ? "내 체력 100%" : assistItemLabel(id);
}

/**
 * 평소 위쪽 막대에 보일 고정 항목(순서 유지). 전투 기능은 전투 막대가 맡으므로 평소 막대에는 없다.
 * hidden = 이 화면에서 그리지 않는 것(예: 휴대폰 보기의 백업·복원).
 */
export function quickBarItems(ids: readonly AssistFavoriteId[], opts: { hidden?: readonly AssistFavoriteId[] } = {}): AssistFavoriteId[] {
  return ids.filter((id) => !battleOnly(id) && !opts.hidden?.includes(id));
}

/** 고정 핀을 둘 수 있는가(전투 기능은 전투 중 늘 나오므로 고정하지 않는다) */
export const pinnable = (id: AssistFavoriteId): boolean => !battleOnly(id);

/** 명령 버튼을 쓸 수 있는지 판단에 쓰는 것(useAssistGuards의 일부) */
export interface CommandGuards {
  supported: boolean; inBattle: boolean; canEscape: boolean;
  hpSupported: boolean; saveSupported: boolean; enemyHpSupported: boolean;
}

const needUpdate = (v: string) => `기록 플러그인을 ${v}으로 업데이트하면 쓸 수 있어요`;

/** 명령 버튼을 지금 못 쓰는 이유(쓸 수 있으면 null). 버튼은 꺼지고 이 글을 Tooltip으로 보인다. */
export function commandBlockReason(id: AssistCommandItemId, g: CommandGuards): string | null {
  if (!g.supported) return needUpdate(ASSIST_MIN_VERSION);
  switch (id) {
    case "win": case "lose": return g.inBattle ? null : "전투 중에만 쓸 수 있어요";
    case "escape": return !g.inBattle ? "전투 중에만 쓸 수 있어요" : g.canEscape ? null : "이 전투는 도망칠 수 없어요";
    case "enemyHpFull": case "enemyHpLow":
      return !g.enemyHpSupported ? needUpdate(ENEMY_HP_COMMAND_MIN_VERSION) : g.inBattle ? null : "전투 중에만 쓸 수 있어요";
    case "hpFull": case "hpLow": return g.hpSupported ? null : needUpdate(HP_COMMAND_MIN_VERSION);
    case "quickSave": case "quickLoad": case "saveMenu": case "loadMenu": return g.saveSupported ? null : needUpdate(SAVE_COMMAND_MIN_VERSION);
  }
}

/** 키 이름 + 을/를(끝 글자를 한국어로 읽은 받침 기준: 0·1·3·6·7·8, L·M·N·R은 받침 있음). */
export function withObjectParticle(label: string): string {
  return `${label}${/[013678LMNR]$/.test(label) ? "을" : "를"}`;
}

/** 조작 옆에 둘 것(위쪽 막대에 고정 핀)을 id로 그려 준다 */
export type AssistFavoriteSlot = (id: AssistItemId) => ReactNode;
