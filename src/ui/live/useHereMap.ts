import { useMemo, useState } from "react";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { livePositions, withLivePositions } from "@/core/live/positions";
import { routeTo, standTiles } from "@/core/map/route";
import type { ChecklistEvent } from "@/core/live/mapChecklist";
import { blockersFor, currentEvents, mapNumbers, pagesKey, targetOf, type LiveEventEntry } from "./mapEvents";
import { useMapChecklist } from "./useMapChecklist";
import { useMapTiles } from "./useMapTiles";

/**
 * 지금 있는 맵 그림과 체크리스트(이 맵·플레이 화면 공용): 맵 타일, 지금 이벤트 그림, 지금 위치의 체크리스트 이벤트,
 * 고른 이벤트와 그곳까지 가는 길.
 */
export function useHereMap() {
  const { live } = useLive();
  const checklist = useMapChecklist();
  const { data } = useGame();
  const mapId = checklist?.mapId ?? null;
  const tilesState = useMapTiles(mapId);
  const tiles = tilesState.status === "ready" ? tilesState.tiles : null;
  const mapData = mapId != null ? data?.maps.get(mapId) : undefined;
  // 활성 페이지·이벤트 위치가 바뀔 때만 이벤트 그림·길막음을 다시 계산한다
  const livePages = live && live.mapId === mapId ? live.events : null;
  const pk = livePages ? pagesKey(livePages) : "";
  const [pagesFor, setPagesFor] = useState<{ pk: string; pages: LiveEventEntry[] }>({ pk: "", pages: [] });
  if (pagesFor.pk !== pk) setPagesFor({ pk, pages: livePages ?? [] });
  const current = useMemo(() => currentEvents(mapData, pagesFor.pages), [mapData, pagesFor]);
  /** 체크리스트 이벤트를 지금 위치(돌아다니는 NPC)로 */
  const listed = useMemo(
    () => (checklist ? withLivePositions(checklist.events, livePositions(pagesFor.pages)) : []),
    [checklist, pagesFor],
  );
  // 맵 데이터로 정한 고정 번호(확인해도 안 바뀐다). 맵 점과 카드·줄 제목이 같이 쓴다
  const numbers = useMemo(() => mapNumbers(listed), [listed]);
  /** 맵에서 고른 이벤트(맵이 바뀌면 풀린다) */
  const [sel, setSel] = useState<{ mapId: number; id: number } | null>(null);
  const selected = sel && sel.mapId === mapId ? sel.id : null;
  const selectedEv: ChecklistEvent | undefined = selected != null ? listed.find((e) => e.eventId === selected) : undefined;
  const px = live?.x ?? 0, py = live?.y ?? 0;
  const route = useMemo(() => {
    if (!tiles || !selectedEv) return null;
    const stands = standTiles(targetOf(mapData, selectedEv), tiles.map, tiles.tileset);
    return routeTo(tiles.map, tiles.tileset, { x: px, y: py }, stands, blockersFor(current, selectedEv.eventId));
  }, [tiles, selectedEv, mapData, current, px, py]);
  const select = (id: number) => { if (mapId != null) setSel({ mapId, id }); };
  /** 고른 이벤트의 길 설명: 타일을 못 읽으면 보여주지 않는다(undefined), 길이 없으면 null */
  const routeText: string | null | undefined = tiles ? (route?.text ?? null) : undefined;

  return { live, checklist, tilesState, tiles, current, listed, numbers, selected, select, route, routeText };
}

export type HereMap = ReturnType<typeof useHereMap>;
