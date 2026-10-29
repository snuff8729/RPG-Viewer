import { useMemo } from "react";
import { useGame } from "@/app/GameProvider";
import { useLive, useLiveData } from "@/app/LiveProvider";
import { groupMissing, type MissingGroup } from "@/core/live/missingGroups";
import { useConditionsLive } from "./useConditionsLive";

/** 못 본 것을 맵 → 이벤트 페이지로 묶은 것. 항목·데이터·색인·조건 상태가 바뀔 때만 다시 묶는다. */
export function useMissingGroups(): MissingGroup[] {
  const { index } = useGame();
  const data = useLiveData();
  const { missing, live } = useLive();
  const condLive = useConditionsLive(live);
  return useMemo(
    () => (data && index ? groupMissing(missing, data, index, condLive) : []),
    [missing, data, index, condLive],
  );
}
