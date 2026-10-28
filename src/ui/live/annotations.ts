import type { EvalStatus, LiveSnapshot } from "@/core/live/types";
import type { GameData, GameIndex, Location } from "@/core/types";
import { locationKey } from "@/core/index/locations";

export interface NowEvent {
  eventId: number; page: number; title: string; mark: "talk" | "auto" | "none"; location: Location;
}

/** live.events 중 page >= 0인 것을 맵의 이벤트 페이지로 풀어낸다. 예외를 던지지 않는다. */
export function nowEvents(data: GameData, index: GameIndex, live: LiveSnapshot | null): NowEvent[] {
  const out: NowEvent[] = [];
  try {
    if (!live || !Array.isArray(live.events)) return out;
    const byKey = new Map(index.pages.map((p) => [locationKey(p.location), p]));
    for (const e of live.events) {
      if (!e || e.page < 0) continue;
      const location: Location = { source: "map", mapId: live.mapId, eventId: e.eventId, page: e.page };
      const entry = byKey.get(locationKey(location));
      if (!entry) continue;
      const trigger = data.maps?.get(live.mapId)?.events?.[e.eventId]?.pages?.[e.page]?.trigger;
      const mark = entry.hasDialogue && typeof trigger === "number"
        ? (trigger <= 2 ? "talk" : trigger <= 4 ? "auto" : "none")
        : "none";
      out.push({ eventId: e.eventId, page: e.page, title: entry.title, mark, location });
    }
  } catch {
    /* 빈 결과 */
  }
  return out;
}

export function conditionIcon(status: EvalStatus): "✓" | "✗" | "?" {
  return status === "met" ? "✓" : status === "unmet" ? "✗" : "?";
}
