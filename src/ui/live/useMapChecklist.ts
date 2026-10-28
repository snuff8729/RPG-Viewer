import { useEffect, useMemo, useState } from "react";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { mapChecklist, type MapChecklist, type MapPassage } from "@/core/live/mapChecklist";
import { loadMapTiles } from "@/core/map/tiles";
import type { Coverage, LiveSnapshot } from "@/core/live/types";
import type { GameData, GameIndex } from "@/core/types";
import { useConditionsLive } from "./useConditionsLive";

/** 탭 라벨과 이 맵 화면이 같은 입력으로 두 번 계산하지 않도록 마지막 결과 하나를 기억한다. */
let last: {
  data: GameData; index: GameIndex; coverage: Coverage; live: LiveSnapshot; passage: MapPassage | null; result: MapChecklist | null;
} | null = null;

function compute(data: GameData, index: GameIndex, coverage: Coverage, live: LiveSnapshot, passage: MapPassage | null): MapChecklist | null {
  if (last && last.data === data && last.index === index && last.coverage === coverage && last.live === live && last.passage === passage) {
    return last.result;
  }
  const result = mapChecklist(data, index, coverage, live, passage);
  last = { data, index, coverage, live, passage, result };
  return result;
}

/** 걸어서 갈 수 있는지 볼 맵 타일(그림 없이 통행 정보만). 데이터·맵별로 한 번만 읽는다. */
const passageCache = new WeakMap<GameData, Map<number, Promise<MapPassage | null>>>();

function useMapPassage(mapId: number | null): MapPassage | null {
  const { folder, data } = useGame();
  const [state, setState] = useState<{ data: GameData; mapId: number; passage: MapPassage | null } | null>(null);
  useEffect(() => {
    if (!folder || !data || mapId == null) return;
    let alive = true;
    let byMap = passageCache.get(data);
    if (!byMap) { byMap = new Map(); passageCache.set(data, byMap); }
    let p = byMap.get(mapId);
    if (!p) { p = loadMapTiles(folder, data, mapId).catch(() => null); byMap.set(mapId, p); }
    void p.then((passage) => { if (alive) setState({ data, mapId, passage }); });
    return () => { alive = false; };
  }, [folder, data, mapId]);
  return state && state.data === data && state.mapId === mapId ? state.passage : null;
}

/**
 * 지금 있는 맵의 체크리스트. 조건 관련 필드(conditionsKey)·기록·데이터·맵 타일이 바뀔 때만 다시 계산한다.
 * 위치만 바뀐 스냅샷에는 다시 계산하지 않으므로 result.player·이벤트 x·y는 오래됐을 수 있다 —
 * 플레이어 표시는 live.x/y를, 이벤트 위치는 live.events(withLivePositions)를 쓴다.
 */
export function useMapChecklist(): MapChecklist | null {
  const { data, index } = useGame();
  const { connection, coverage, live } = useLive();
  const condLive = useConditionsLive(live);
  const passage = useMapPassage(condLive?.mapId ?? null);
  const connected = connection === "connected";
  return useMemo(
    () => (connected && data && index && condLive ? compute(data, index, coverage, condLive, passage) : null),
    [connected, data, index, coverage, condLive, passage],
  );
}
