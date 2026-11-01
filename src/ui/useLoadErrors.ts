import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
export function useLoadErrors() {
  const { data } = useGame();
  const { badLines } = useLive();
  return [...(data?.errors ?? []), ...(badLines > 0 ? [{ file: "rpg-viewer/log.jsonl", message: `깨진 줄이 ${badLines}개 있어요` }] : [])];
}
