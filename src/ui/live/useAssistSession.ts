import { useEffect, useState } from "react";
import { useAssist, useLive } from "@/app/LiveProvider";
import {
  COMMAND_RESPONSE_MS, commandStatus, commandStatusText, ENEMY_HP_COMMAND_MIN_VERSION, HP_COMMAND_MIN_VERSION, isHpCommand, isSaveCommand,
  liveHotkeys, SAVE_COMMAND_MIN_VERSION, sameHotkeys, versionAtLeast,
} from "@/core/live/assist";

/** 게임에 걸린 단축키가 설정과 이만큼 오래 다르면 안내한다. */
const HOTKEY_MISMATCH_MS = 5000;

/** 게임 보조 조작을 쓸 수 있는지(플러그인 버전·전투 중·전투 안전장치) */
export function useAssistGuards() {
  const { supported } = useAssist();
  const { live } = useLive();
  const inBattle = supported && live?.inBattle === true;
  /** 체력 명령은 플러그인 1.12.0부터(맵·전투 모두) */
  const hpSupported = supported && versionAtLeast(live?.pluginVersion, HP_COMMAND_MIN_VERSION);
  /** 세이브·로드 명령은 플러그인 1.21.0부터(맵, 불러오기는 타이틀에서도) */
  const saveSupported = supported && versionAtLeast(live?.pluginVersion, SAVE_COMMAND_MIN_VERSION);
  /** 적 체력 명령은 플러그인 1.23.0부터(전투 중만) */
  const enemyHpSupported = supported && versionAtLeast(live?.pluginVersion, ENEMY_HP_COMMAND_MIN_VERSION);
  // 전투 안전장치: 플러그인이 false라고 알려 줄 때만 막는다(구버전은 필드가 없다).
  const canEscape = live?.assist?.canEscape !== false;
  const canLose = live?.assist?.canLose !== false;
  return { supported, inBattle, hpSupported, saveSupported, enemyHpSupported, canEscape, canLose };
}

/**
 * 게임 보조 창의 남는 상태: 보낸 명령의 응답 글, 단축키 불일치 안내.
 * 창(Popover)이 닫혀 있어도 시간을 재야 하므로 덮개 쪽(항상 그려진 곳)에서 부른다.
 */
export interface AssistSession {
  /** 마지막 명령의 응답 글(없으면 null) */
  statusText: string | null;
  /** 마지막 명령이 체력 명령이면 응답을 체력 칸에 보인다 */
  hpSent: boolean;
  /** 마지막 명령이 세이브·로드 명령이면 응답을 세이브 칸에 보인다 */
  saveSent: boolean;
  /** 게임에 걸린 단축키가 설정과 5초 넘게 다르다 */
  showMismatch: boolean;
}

export function useAssistSession(): AssistSession {
  const { settings, sentCommand, supported } = useAssist();
  const { live } = useLive();

  // 보낸 명령의 응답: COMMAND_RESPONSE_MS 안에 live.json에 메아리가 없으면 응답 없음.
  const [timedOutId, setTimedOutId] = useState<string | null>(null);
  useEffect(() => {
    if (!sentCommand) return;
    const id = setTimeout(() => setTimedOutId(sentCommand.id), Math.max(0, sentCommand.at + COMMAND_RESPONSE_MS - Date.now()));
    return () => clearTimeout(id);
  }, [sentCommand]);
  const status = commandStatus(sentCommand, live?.assist?.lastCommand, sentCommand !== null && timedOutId === sentCommand.id);
  const statusText = status === null ? null : commandStatusText(status, sentCommand?.kind);

  // 게임이 보고한 단축키가 설정과 5초 넘게 다르면 플러그인 업데이트를 안내한다.
  const hotkeys = settings.hotkeys;
  const effective = liveHotkeys(live?.assist);
  const mismatchKey = supported && live?.assist && !sameHotkeys(effective, hotkeys)
    ? JSON.stringify([effective, hotkeys]) : null;
  const [staleKey, setStaleKey] = useState<string | null>(null);
  useEffect(() => {
    if (mismatchKey === null) return;
    const id = setTimeout(() => setStaleKey(mismatchKey), HOTKEY_MISMATCH_MS);
    return () => clearTimeout(id);
  }, [mismatchKey]);

  return {
    statusText,
    hpSent: isHpCommand(sentCommand?.kind),
    saveSent: isSaveCommand(sentCommand?.kind),
    showMismatch: mismatchKey !== null && staleKey === mismatchKey,
  };
}
