import { viewGroups, type MissingGroup } from "@/core/live/missingGroups";
import type { ChecklistEvent, MapChecklist } from "@/core/live/mapChecklist";
import type { Location } from "@/core/types";

export type NowItem = ChecklistEvent & { location: Location };

/** 사이드바 "지금": 이 맵 체크리스트에서 안 본 내용 → 아이템 → 반복 순으로, 열 수 있는 것만 최대 limit개. */
export function nowItems(checklist: MapChecklist | null, limit = 6): NowItem[] {
  if (!checklist) return [];
  const pick = (s: ChecklistEvent["section"]) =>
    checklist.events.filter((e): e is NowItem => e.section === s && !e.story && e.location !== null);
  const exits = pick("exit").filter((e) => e.unseen > 0 || e.unpicked > 0);
  return [...pick("now"), ...pick("item"), ...pick("repeat"), ...exits].slice(0, limit);
}

/** 사이드바 "가 볼 만한 곳": 지금 갈 수 있는 못 본 것이 있는 다른 맵, 최대 limit개. */
export function placesToGo(groups: MissingGroup[], limit = 5): { mapId: number; name: string; count: number }[] {
  return viewGroups(groups, "reachable", "")
    .filter((g) => !g.current && g.mapId !== undefined)
    .slice(0, limit)
    .map((g) => ({ mapId: g.mapId as number, name: g.name, count: g.events.length }));
}
