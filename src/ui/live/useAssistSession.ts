import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAssist, useLive } from "@/app/LiveProvider";
import {
  COMMAND_RESPONSE_MS, commandStatus, commandStatusText, ENCOUNTER_MIN_VERSION, ENEMY_HP_COMMAND_MIN_VERSION, HP_COMMAND_MIN_VERSION,
  liveHotkeys, SAVE_COMMAND_MIN_VERSION, sameHotkeys, versionAtLeast, WALK_SPEED_MIN_VERSION,
} from "@/core/live/assist";

/** 이미 토스트로 알린 명령 응답(명령 id:상태). 이 훅을 쓰는 곳이 여럿이거나 다시 그려져도 한 번만 알려요. */
const announced = new Set<string>();

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
  /** 랜덤 전투 끄기·전투 건너뛰기·잡아 본 적만은 플러그인 1.24.0부터 */
  const encounterSupported = supported && versionAtLeast(live?.pluginVersion, ENCOUNTER_MIN_VERSION);
  const walkSpeedSupported = supported && versionAtLeast(live?.pluginVersion, WALK_SPEED_MIN_VERSION);
  // 전투 안전장치: 플러그인이 false라고 알려 줄 때만 막는다(구버전은 필드가 없다).
  const canEscape = live?.assist?.canEscape !== false;
  const canLose = live?.assist?.canLose !== false;
  return { supported, inBattle, hpSupported, saveSupported, enemyHpSupported, encounterSupported, walkSpeedSupported, canEscape, canLose };
}

/**
 * 게임 보조의 남는 상태: 보낸 명령의 응답(토스트로 알려요 — 보조·위쪽 막대·전투 막대 어디서 보냈든), 단축키 불일치 안내.
 * 탭이 숨어 있어도 시간을 재야 하므로 늘 그려진 곳에서 부른다.
 */
export interface AssistSession {
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
  // 응답은 화면 배치를 밀지 않게 토스트로: 보내는 중 → 적용됐어요(성공) / 무시·실패·응답 없음(오류). 같은 토스트를 바꿔 가요.
  useEffect(() => {
    if (!sentCommand || status === null) return;
    const key = `${sentCommand.id}:${status}`;
    if (announced.has(key)) return;
    announced.add(key);
    const text = commandStatusText(status, sentCommand.kind);
    const opts = { id: `assist-${sentCommand.id}` };
    if (status === "sent") toast.loading(text, opts);
    else if (status === "applied") toast.success(text, opts);
    else toast.error(text, opts);
  }, [sentCommand, status]);

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
    showMismatch: mismatchKey !== null && staleKey === mismatchKey,
  };
}
