import { useMemo } from "react";
import { conditionsKey } from "@/core/live/interactable";
import type { LiveSnapshot } from "@/core/live/types";

/**
 * 출현 조건에 영향을 주는 필드(conditionsKey)가 바뀔 때만 새 객체가 되는 live.
 * 위치·시각만 바뀐 스냅샷에는 같은 객체를 돌려줘 무거운 계산의 useMemo가 다시 돌지 않게 한다.
 */
export function useConditionsLive(live: LiveSnapshot | null): LiveSnapshot | null {
  const key = conditionsKey(live);
  // key가 같으면 조건 결과가 같으므로 live 자체는 의존성에서 뺀다
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => live, [key]);
}
