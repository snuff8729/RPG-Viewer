import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { Badge } from "@/components/ui/badge";
import { useMapChecklist } from "./useMapChecklist";

/** 위 줄의 지금 맵 이름 + 남은 것(게임이 연결됐을 때만). PC 플레이 화면·따로 띄운 맵 창 머리가 같이 쓴다. */
export function PlayTopBarMapName({ remaining = true }: { remaining?: boolean }) {
  const { data } = useGame();
  const { live, connection } = useLive();
  const checklist = useMapChecklist();
  const mapName = connection === "connected" && live && data ? (data.mapInfos[live.mapId]?.name || `#${live.mapId}`) : null;
  if (!mapName) return null;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 truncate text-sm font-medium">{mapName}</span>
      {remaining && checklist && <Badge variant={checklist.remaining > 0 ? "default" : "secondary"}>남은 것 {checklist.remaining}</Badge>}
    </span>
  );
}
