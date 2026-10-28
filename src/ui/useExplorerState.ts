import { useState } from "react";
import { useLive } from "@/app/LiveProvider";
import type { Route } from "@/app/route";

/** 찾아보기 화면 상태. 이벤트 페이지를 보고 돌아와도 유지되도록 Shell이 들고 있는다. */
export interface ExplorerState {
  query: string;
  showEmpty: boolean;
  /** 펼친 그룹: "map:{id}" | "common" | "troop" */
  open: Set<string>;
}

export const mapKey = (id: number) => `map:${id}`;

/** 찾아보기 상태. 열어 본 이벤트의 맵과, 따라가기가 켜져 있으면 게임 속 맵을 펼친다(맵이 바뀔 때만). */
export function useExplorerState(route: Route, follow: boolean) {
  const { live, connection } = useLive();
  const [state, setState] = useState<ExplorerState>(() => ({ query: "", showEmpty: false, open: new Set() }));
  const activeMapId = route.kind === "page" && route.location.source === "map" ? route.location.mapId : null;
  const liveMapId = follow && connection === "connected" && live ? live.mapId : null;
  // 렌더 중에 이전 값과 비교해 펼친다(effect 없이)
  const sig = `${activeMapId}|${liveMapId}`;
  const [lastSig, setLastSig] = useState<string | null>(null);
  if (sig !== lastSig) {
    setLastSig(sig);
    const keys = [activeMapId, liveMapId].filter((id): id is number => id !== null).map(mapKey);
    if (keys.some((k) => !state.open.has(k))) setState({ ...state, open: new Set([...state.open, ...keys]) });
  }
  return [state, setState] as const;
}
