import { viewGroups, type MissingGroup } from "@/core/live/missingGroups";
import type { ChecklistEvent, MapChecklist } from "@/core/live/mapChecklist";
import type { Location } from "@/core/types";

export type NowItem = ChecklistEvent & { location: Location };

/** 지금 해 볼 것: 안 본 내용·아이템·반복하면 달라짐, 그리고 안 본 대사·선택지가 남은 다른 곳으로 이동. 이야기·자동 진행은 뺀다. */
export function isActionable(e: ChecklistEvent): boolean {
  if (e.story) return false;
  if (e.section === "exit" || e.section === "enemy") return e.unseen > 0 || e.unpicked > 0;
  return e.section === "now" || e.section === "item" || e.section === "repeat";
}

const ACTION_ORDER: ChecklistEvent["section"][] = ["now", "item", "repeat", "exit", "enemy"];

/** 지금 해 볼 것만 안 본 내용 → 아이템 → 반복 → 이동 순으로(같은 구역 안에서는 받은 순서 그대로). */
export function actionableItems<T extends ChecklistEvent>(events: readonly T[]): T[] {
  const out: T[] = [];
  for (const s of ACTION_ORDER) for (const e of events) if (e.section === s && isActionable(e)) out.push(e);
  return out;
}

/** 사이드바 "지금": 이 맵 체크리스트에서 안 본 내용 → 아이템 → 반복 순으로, 열 수 있는 것만 최대 limit개. */
export function nowItems(checklist: MapChecklist | null, limit = 6): NowItem[] {
  if (!checklist) return [];
  return actionableItems(checklist.events).filter((e): e is NowItem => e.location !== null).slice(0, limit);
}

/** 사이드바 "가 볼 만한 곳": 지금 갈 수 있는 못 본 것이 있는 다른 맵, 최대 limit개. */
export function placesToGo(groups: MissingGroup[], limit = 5): { mapId: number; name: string; count: number }[] {
  return viewGroups(groups, "reachable", "")
    .filter((g) => !g.current && g.mapId !== undefined)
    .slice(0, limit)
    .map((g) => ({ mapId: g.mapId as number, name: g.name, count: g.events.length }));
}
