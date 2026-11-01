import { Skeleton } from "@/components/ui/skeleton";
import { MapCanvas } from "./MapCanvas";
import { MapGrid } from "./MapGrid";
import type { HereMap } from "./useHereMap";

/** 지금 맵 그림(맵 모듈): 칸을 채운다. 읽는 중이면 Skeleton, 타일을 못 읽으면 칸 그림. */
export function HereMapArea({ here, focus, onPick, showWalls }: {
  here: HereMap;
  focus: { x: number; y: number; n: number } | null;
  onPick: (eventId: number) => void;
  showWalls: boolean;
}) {
  const { live, checklist, tilesState, tiles, current, listed, numbers, route, selected } = here;
  if (!live || !checklist) return null;
  const player = { x: live.x, y: live.y };
  return (
    <>
      {tilesState.status === "loading" && <Skeleton className="h-full w-full" />}
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
          compact
          showWalls={showWalls}
          story={here.story}
        />
      )}
      {tilesState.status === "failed" && (
        <div className="h-full overflow-auto">
          <MapGrid width={checklist.width} height={checklist.height} events={listed} player={player} numbers={numbers} onPick={onPick} />
        </div>
      )}
    </>
  );
}
