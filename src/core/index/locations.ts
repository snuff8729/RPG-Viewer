import type { Location } from "../types";

export function locationKey(loc: Location): string {
  switch (loc.source) {
    case "map": return `map:${loc.mapId}:${loc.eventId}:${loc.page}`;
    case "common": return `common:${loc.commonEventId}`;
    case "troop": return `troop:${loc.troopId}:${loc.page}`;
  }
}
