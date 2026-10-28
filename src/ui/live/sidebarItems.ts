import { viewGroups, type MissingGroup } from "@/core/live/missingGroups";
import type { ChecklistEvent, MapChecklist } from "@/core/live/mapChecklist";
import type { Location } from "@/core/types";

export type NowItem = ChecklistEvent & { location: Location };

/** 사이드바 "지금": 이 맵 체크리스트에서 새 대화 → 아이템 → 반복 순으로, 열 수 있는 것만 최대 limit개. */
export function nowItems(checklist: MapChecklist | null, limit = 6): NowItem[] {
  if (!checklist) return [];
  const pick = (s: ChecklistEvent["section"]) =>
    checklist.events.filter((e): e is NowItem => e.section === s && e.location !== null);
  return [...pick("now"), ...pick("item"), ...pick("repeat")].slice(0, limit);
}

/** 사이드바 "가 볼 만한 곳": 지금 갈 수 있는 못 본 것이 있는 다른 맵, 최대 limit개. */
export function placesToGo(groups: MissingGroup[], limit = 5): { mapId: number; name: string; count: number }[] {
  return viewGroups(groups, "reachable", "")
    .filter((g) => !g.current && g.mapId !== undefined)
    .slice(0, limit)
    .map((g) => ({ mapId: g.mapId as number, name: g.name, count: g.events.length }));
}
