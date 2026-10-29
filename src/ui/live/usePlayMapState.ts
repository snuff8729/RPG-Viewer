import { createContext, useContext, useMemo, useState } from "react";
import type { ChecklistEvent } from "@/core/live/mapChecklist";
import { useGame } from "@/app/GameProvider";
import { useMapLegend, visibleByLegend } from "./mapLegendState";
import { gameKeyOf } from "./readPosition";
import { actionableItems } from "./sidebarItems";
import { useHereMap } from "./useHereMap";

/** 맵을 이 칸으로 옮겨 보여 달라는 요청(n이 바뀔 때마다 다시 옮긴다) */
export interface MapFocus { x: number; y: number; n: number }

/**
 * 플레이 화면 맵 조각(맵 그림·지금 해 볼 것)이 함께 쓰는 상태: 지금 맵, 고른 이벤트, 맵 초점, 줄 위치.
 * 조각들이 다른 칸에 있어도 같은 것을 고르도록 PlayMapProvider 하나 아래에 둔다.
 */
export interface PlayMapState {
  here: ReturnType<typeof useHereMap>;
  /** 지금 해 볼 것(범례에서 끈 항목은 뺀다) */
  rows: ChecklistEvent[];
  focus: MapFocus | null;
  /** 목록에서 고름: 맵에서 고르고 그 칸으로 옮긴다 */
  choose(ev: ChecklistEvent): void;
  /** 맵에서 고름: 목록에서 그 줄이 보이게 한다 */
  pick(id: number): void;
  /** 목록 줄 자리(맵에서 고르면 그 줄로 스크롤) */
  rowRefs: Map<number, HTMLElement>;
}

export function usePlayMapController(): PlayMapState {
  const here = useHereMap();
  const { listed, select } = here;
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [rowRefs] = useState(() => new Map<number, HTMLElement>());
  const { data } = useGame();
  // 범례에서 끈 항목은 목록에서도 뺀다
  const [legendHidden] = useMapLegend(data ? gameKeyOf(data) : "");
  const rows = useMemo(() => actionableItems(visibleByLegend(listed, legendHidden)), [listed, legendHidden]);

  const choose = (ev: ChecklistEvent) => {
    select(ev.eventId);
    setFocus((f) => ({ x: ev.x, y: ev.y, n: (f?.n ?? 0) + 1 }));
  };
  const pick = (id: number) => {
    select(id);
    rowRefs.get(id)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  return { here, rows, focus, choose, pick, rowRefs };
}

export const PlayMapContext = createContext<PlayMapState | null>(null);

/** PlayMapProvider 아래에서 맵 조각들이 함께 쓰는 상태 */
export function usePlayMap(): PlayMapState {
  const s = useContext(PlayMapContext);
  if (!s) throw new Error("usePlayMap은 PlayMapProvider 안에서만 쓸 수 있어요");
  return s;
}
