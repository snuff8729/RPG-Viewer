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

/**
 * 맵에 번호 표시를 그릴 이벤트: 새 대화·아이템·반복·조사 가능, 그리고 showLocked일 때 잠김(이야기 진행 조건 제외).
 * 다 본 것은 그리지 않는다.
 */
export function mapMarkers(listed: readonly ChecklistEvent[], showLocked: boolean): ChecklistEvent[] {
  return listed.filter((e) => e.section === "now" || e.section === "item" || e.section === "repeat" || e.section === "talk"
    || (showLocked && e.section === "locked" && !e.story));
}

/** 이벤트 그림의 불투명도(0~255)·합성 방법(0 보통, 1 더하기, 2 곱하기, 3 스크린). */
export interface SpriteEffect { opacity: number; blendMode: number }

/**
 * 활성 페이지가 자기 자신에게 거는 이동 경로의 불투명도 변경(42)·합성 방법 변경(43).
 * 페이지 자율 이동 경로 → 페이지 명령의 이동 경로 설정(205, 대상 0 = 이 이벤트 또는 자기 id) 순으로, 뒤의 것이 이긴다.
 * 대상 -1은 플레이어라 쓰지 않는다. 데이터에 없으면 기본값(255, 0).
 */
export function spriteEffect(page: EventPage, eventId: number): SpriteEffect {
  const out: SpriteEffect = { opacity: 255, blendMode: 0 };
  const apply = (route: unknown) => {
    const list = route && typeof route === "object" ? (route as { list?: unknown }).list : undefined;
    if (!Array.isArray(list)) return;
    for (const cmd of list as ({ code?: unknown; parameters?: unknown[] } | null)[]) {
      const v = cmd?.parameters?.[0];
      if (!cmd || typeof v !== "number" || !Number.isFinite(v)) continue;
      if (cmd.code === 42) out.opacity = Math.min(255, Math.max(0, v));
      else if (cmd.code === 43 && v >= 0 && v <= 3) out.blendMode = Math.floor(v);
    }
  };
  apply(page.moveRoute);
  for (const cmd of Array.isArray(page.list) ? page.list : []) {
    if (cmd?.code !== 205) continue;
    const target = cmd.parameters?.[0];
    if (target === 0 || target === eventId) apply(cmd.parameters?.[1]);
  }
  return out;
}
