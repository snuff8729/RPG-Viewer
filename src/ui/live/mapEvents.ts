import type { ChecklistEvent } from "@/core/live/mapChecklist";
import type { EventPage, MapData } from "@/core/types";

/** 지금 맵에 실제로 나와 있는 이벤트(활성 페이지가 있는 것)와 그 페이지. 위치는 맵 데이터의 처음 위치. */
export interface CurrentEvent { id: number; x: number; y: number; page: EventPage }

/** live.events → "id:page,…" (활성 페이지가 바뀔 때만 다시 그리도록 비교용 키). */
export function pagesKey(pages: readonly { eventId: number; page: number }[]): string {
  return pages.map((p) => `${p.eventId}:${p.page}`).join(",");
}

export function currentEvents(map: MapData | undefined, pages: readonly { eventId: number; page: number }[]): CurrentEvent[] {
  if (!map) return [];
  const out: CurrentEvent[] = [];
  for (const { eventId, page } of pages) {
    const ev = map.events[eventId];
    const pg = page >= 0 ? ev?.pages[page] : undefined;
    if (ev && pg) out.push({ id: ev.id, x: ev.x, y: ev.y, page: pg });
  }
  return out;
}

/** 길을 막는 다른 이벤트("x,y"): 활성 페이지가 캐릭터와 같은 우선순위이고 통과가 아닌 것. 대상은 뺀다. */
export function blockersFor(events: readonly CurrentEvent[], targetId: number): Set<string> {
  const out = new Set<string>();
  for (const e of events) {
    if (e.id === targetId) continue;
    if ((e.page.priorityType ?? 1) === 1 && !e.page.through) out.add(`${e.x},${e.y}`);
  }
  return out;
}

/**
 * 길찾기 대상의 우선순위·트리거. 활성 페이지가 있으면 그 페이지, 없으면(잠김) 첫 잠긴 페이지를 쓴다.
 */
export function targetOf(map: MapData | undefined, ev: ChecklistEvent): { x: number; y: number; priorityType: number; trigger: number; through: boolean } {
  const pages = map?.events[ev.eventId]?.pages ?? [];
  const pg = pages[ev.activePage] ?? pages[ev.locked[0]?.page ?? -1];
  return { x: ev.x, y: ev.y, priorityType: pg?.priorityType ?? 1, trigger: pg?.trigger ?? 0, through: pg?.through ?? false };
}
