import { useMemo } from "react";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { mapChecklist, type MapChecklist } from "@/core/live/mapChecklist";
import type { Coverage, LiveSnapshot } from "@/core/live/types";
import type { GameData, GameIndex } from "@/core/types";
import { useConditionsLive } from "./useConditionsLive";

/** 탭 라벨과 이 맵 화면이 같은 입력으로 두 번 계산하지 않도록 마지막 결과 하나를 기억한다. */
let last: { data: GameData; index: GameIndex; coverage: Coverage; live: LiveSnapshot; result: MapChecklist | null } | null = null;

function compute(data: GameData, index: GameIndex, coverage: Coverage, live: LiveSnapshot): MapChecklist | null {
  if (last && last.data === data && last.index === index && last.coverage === coverage && last.live === live) return last.result;
  const result = mapChecklist(data, index, coverage, live);
  last = { data, index, coverage, live, result };
  return result;
}

/**
 * 지금 있는 맵의 체크리스트. 조건 관련 필드(conditionsKey)·기록·데이터가 바뀔 때만 다시 계산한다.
 * 위치만 바뀐 스냅샷에는 다시 계산하지 않으므로 result.player는 오래됐을 수 있다 — 플레이어 표시는 live.x/y를 쓴다.
 */
export function useMapChecklist(): MapChecklist | null {
  const { data, index } = useGame();
  const { connection, coverage, live } = useLive();
  const condLive = useConditionsLive(live);
  const connected = connection === "connected";
  return useMemo(
    () => (connected && data && index && condLive ? compute(data, index, coverage, condLive) : null),
    [connected, data, index, coverage, condLive],
  );
}
