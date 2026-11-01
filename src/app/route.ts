import { useCallback, useEffect, useState } from "react";
import type { Location } from "@/core/types";

export const MANAGE_SECTIONS = [
  "connection",
  "backups",
  "share",
  "settings",
  "diagnose",
  "appearance",
  "games",
] as const;
export type ManageSection = (typeof MANAGE_SECTIONS)[number];
export type PlayModule = "map" | "assist" | "cheat" | "read";
export type ReadMode = "story" | "history";
export type Route =
  | { kind: "play"; module?: PlayModule }
  | { kind: "read"; mode?: ReadMode }
  | { kind: "browse"; tab?: "events" | "missing" }
  | { kind: "manage"; section?: ManageSection }
  | { kind: "more" }
  | { kind: "page"; location: Location };

const HOME: Route = { kind: "play" };

function num(s: string | undefined): number | null {
  return s !== undefined && /^\d+$/.test(s) ? Number(s) : null;
}

/** 표기상 page는 1부터, 내부는 0부터 */
function pageIdx(s: string | undefined): number | null {
  const n = num(s);
  return n !== null && n >= 1 ? n - 1 : null;
}

export function parseRoute(hash: string): Route {
  const p = hash.replace(/^#\/?/, "").replace(/\/$/, "").split("/");
  if (p.length === 1) {
    if (p[0] === "here") return { kind: "play", module: "map" };
    if (p[0] === "read") return { kind: "read" };
    if (p[0] === "history") return { kind: "read", mode: "history" };
    if (p[0] === "missing") return { kind: "browse", tab: "missing" };
    if (p[0] === "diagnose") return { kind: "manage", section: "diagnose" };
    if (p[0] === "more") return { kind: "more" };
  }
  // 읽기: #/read(이야기)·#/read/history(모든 기록). 예전 주소 #/play/read/story·history도 받아요.
  const readMode = (m: string | undefined): Route | null =>
    m === "history" ? { kind: "read", mode: "history" } : m === "story" ? { kind: "read" } : null;
  if (p[0] === "read" && p.length === 2) {
    const r = readMode(p[1]);
    if (r) return r;
  }
  if (p[0] === "play") {
    if (p.length === 1) return { kind: "play" };
    if (p.length === 2 && ["map", "assist", "cheat", "read"].includes(p[1])) return { kind: "play", module: p[1] as PlayModule };
    if (p.length === 3 && p[1] === "read") {
      const r = readMode(p[2]);
      if (r) return r;
    }
  }
  if (p[0] === "browse" && p.length <= 2 && (!p[1] || p[1] === "events" || p[1] === "missing"))
    return { kind: "browse", tab: p[1] === "missing" ? "missing" : "events" };
  if (p[0] === "manage" && p.length <= 2 && (!p[1] || (MANAGE_SECTIONS as readonly string[]).includes(p[1])))
    return { kind: "manage", ...(p[1] ? { section: p[1] as ManageSection } : {}) };
  if (p[0] === "map" && p[2] === "event" && p[4] === "page" && p.length === 6) {
    const mapId = num(p[1]),
      eventId = num(p[3]),
      page = pageIdx(p[5]);
    if (mapId !== null && eventId !== null && page !== null)
      return { kind: "page", location: { source: "map", mapId, eventId, page } };
  } else if (p[0] === "common" && p.length === 2) {
    const commonEventId = num(p[1]);
    if (commonEventId !== null) return { kind: "page", location: { source: "common", commonEventId } };
  } else if (p[0] === "troop" && p[2] === "page" && p.length === 4) {
    const troopId = num(p[1]),
      page = pageIdx(p[3]);
    if (troopId !== null && page !== null) return { kind: "page", location: { source: "troop", troopId, page } };
  }
  return HOME;
}

export function formatRoute(r: Route): string {
  if (r.kind === "play") return `#/play${r.module ? "/" + r.module : ""}`;
  if (r.kind === "read") return r.mode === "history" ? "#/read/history" : "#/read";
  if (r.kind === "browse") return `#/browse/${r.tab ?? "events"}`;
  if (r.kind === "manage") return `#/manage${r.section ? "/" + r.section : ""}`;
  if (r.kind === "more") return "#/more";
  const l = r.location;
  switch (l.source) {
    case "map":
      return `#/map/${l.mapId}/event/${l.eventId}/page/${l.page + 1}`;
    case "common":
      return `#/common/${l.commonEventId}`;
    case "troop":
      return `#/troop/${l.troopId}/page/${l.page + 1}`;
  }
}

export function useRoute(): [Route, (r: Route) => void] {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  useEffect(() => {
    const canonical = formatRoute(parseRoute(hash));
    if (hash && hash !== "#" && hash !== "#/" && hash !== canonical) window.history.replaceState(null, "", canonical);
  }, [hash]);
  const set = useCallback((r: Route) => {
    window.location.hash = formatRoute(r);
  }, []);
  return [parseRoute(hash), set];
}
