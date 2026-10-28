import { Skeleton } from "@/components/ui/skeleton";
import { MapCanvas } from "./MapCanvas";
import { MapGrid } from "./MapGrid";
import { mapMarkers } from "./mapEvents";
import type { HereMap } from "./useHereMap";

/** 지금 맵 그림(이 맵·플레이 화면 공용): 읽는 중이면 Skeleton, 타일을 못 읽으면 칸 그림. */
export function HereMapArea({ here, focus, onPick, compact = false }: {
  here: HereMap;
  focus: { x: number; y: number; n: number } | null;
  onPick: (eventId: number) => void;
  compact?: boolean;
}) {
  const { live, checklist, tilesState, tiles, current, listed, numbers, route, selected } = here;
  if (!live || !checklist) return null;
  const player = { x: live.x, y: live.y };
  return (
    <>
      {tilesState.status === "loading" && <Skeleton className={compact ? "h-full w-full" : "h-[min(60vh,32rem)] w-full"} />}
      {tiles && (
        <MapCanvas
          tiles={tiles}
          events={current}
          listed={listed}
          numbers={numbers}
          player={player}
          route={route}
          selected={selected}
          focus={focus}
          onPick={onPick}
          compact={compact}
          story={here.story}
          avoidEnemies={here.avoidEnemies}
          onAvoidEnemiesChange={here.setAvoidEnemies}
        />
      )}
      {tilesState.status === "failed" && (
        <div className={compact ? "h-full overflow-auto" : undefined}>
          <MapGrid width={checklist.width} height={checklist.height} events={mapMarkers(listed, false)} player={player} numbers={numbers} onPick={onPick} />
        </div>
      )}
    </>
  );
}
