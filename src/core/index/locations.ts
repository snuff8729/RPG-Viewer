import type { Location } from "../types";

export function locationKey(loc: Location): string {
  switch (loc.source) {
    case "map": return `map:${loc.mapId}:${loc.eventId}:${loc.page}${typeof loc.origin === "number" ? `:o${loc.origin}` : ""}`;
    case "common": return `common:${loc.commonEventId}`;
    case "troop": return `troop:${loc.troopId}:${loc.page}`;
  }
}

/** 색인 페이지 항목의 위치: 원래 페이지 실행 위치(origin)면 그것을 불러 실행한 템플릿 페이지, 아니면 그대로. */
export function pageLocation(loc: Location): Location {
  if (loc && loc.source === "map" && typeof loc.origin === "number") {
    return { source: "map", mapId: loc.mapId, eventId: loc.eventId, page: loc.page };
  }
  return loc;
}
