import { useEffect, useMemo, useRef } from "react";
import { formatRoute, type Route } from "@/app/route";
import { useLive } from "@/app/LiveProvider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { reachableCount } from "@/core/live/missingGroups";
import { useMapChecklist } from "./useMapChecklist";
import { useMissingGroups } from "./useMissingGroups";

type TabValue = "explorer" | "read" | "here" | "history" | "missing";

function tabOf(route: Route): TabValue {
  return route.kind === "history" || route.kind === "read" || route.kind === "here" || route.kind === "missing" ? route.kind : "explorer";
}

/** 상단 탭(내비게이션). 탐색기 탭은 마지막으로 본 page 라우트(없으면 home)로 돌아간다. */
export function LiveTabs({ route }: { route: Route }) {
  const { connection } = useLive();
  const groups = useMissingGroups();
  const connected = connection === "connected";
  const checklist = useMapChecklist();
  // 연결 중이면 지금 갈 수 있는 이벤트 수, 아니면 전체 이벤트 그룹 수
  const missingCount = useMemo(
    () => (connected ? reachableCount(groups) : groups.reduce((s, g) => s + g.events.length, 0)),
    [connected, groups],
  );
  const lastExplorer = useRef<Route>({ kind: "home" });
  useEffect(() => {
    if (route.kind === "page" || route.kind === "home") lastExplorer.current = route;
  }, [route]);

  const go = (v: string) => {
    const next: Route = v === "history" ? { kind: "history" } : v === "read" ? { kind: "read" } : v === "here" ? { kind: "here" } : v === "missing" ? { kind: "missing" } : lastExplorer.current;
    window.location.hash = formatRoute(next);
  };

  return (
    <Tabs value={tabOf(route)} onValueChange={go}>
      <TabsList>
        <TabsTrigger value="explorer">탐색기</TabsTrigger>
        <TabsTrigger value="read">읽기</TabsTrigger>
        <TabsTrigger value="here">{checklist ? `이 맵 (${checklist.remaining})` : "이 맵"}</TabsTrigger>
        <TabsTrigger value="history">기록</TabsTrigger>
        <TabsTrigger value="missing">못 본 것 ({missingCount})</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
