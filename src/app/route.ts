import { useCallback, useEffect, useState } from "react";
import type { Location } from "@/core/types";

export type Route = { kind: "home" } | { kind: "page"; location: Location } | { kind: "history" } | { kind: "missing" };

const HOME: Route = { kind: "home" };

function num(s: string | undefined): number | null {
  return s !== undefined && /^\d+$/.test(s) ? Number(s) : null;
}

/** 표기상 page는 1부터, 내부는 0부터 */
function pageIdx(s: string | undefined): number | null {
  const n = num(s);
  return n !== null && n >= 1 ? n - 1 : null;
}

export function parseRoute(hash: string): Route {
  const p = hash.replace(/^#\/?/, "").split("/");
  if ((p[0] === "history" || p[0] === "missing") && p.length === 1) return { kind: p[0] };
  if (p[0] === "map" && p[2] === "event" && p[4] === "page" && p.length === 6) {
    const mapId = num(p[1]), eventId = num(p[3]), page = pageIdx(p[5]);
    if (mapId !== null && eventId !== null && page !== null) return { kind: "page", location: { source: "map", mapId, eventId, page } };
  } else if (p[0] === "common" && p.length === 2) {
    const commonEventId = num(p[1]);
    if (commonEventId !== null) return { kind: "page", location: { source: "common", commonEventId } };
  } else if (p[0] === "troop" && p[2] === "page" && p.length === 4) {
    const troopId = num(p[1]), page = pageIdx(p[3]);
    if (troopId !== null && page !== null) return { kind: "page", location: { source: "troop", troopId, page } };
  }
  return HOME;
}

export function formatRoute(r: Route): string {
  if (r.kind === "home") return "#/";
  if (r.kind === "history") return "#/history";
  if (r.kind === "missing") return "#/missing";
  const l = r.location;
  switch (l.source) {
    case "map": return `#/map/${l.mapId}/event/${l.eventId}/page/${l.page + 1}`;
    case "common": return `#/common/${l.commonEventId}`;
    case "troop": return `#/troop/${l.troopId}/page/${l.page + 1}`;
  }
}

export function useRoute(): [Route, (r: Route) => void] {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const set = useCallback((r: Route) => { window.location.hash = formatRoute(r); }, []);
  return [parseRoute(hash), set];
}
