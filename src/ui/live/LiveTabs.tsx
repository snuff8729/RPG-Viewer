import { useEffect, useRef } from "react";
import { formatRoute, type Route } from "@/app/route";
import { useLive } from "@/app/LiveProvider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type TabValue = "explorer" | "history" | "missing";

function tabOf(route: Route): TabValue {
  return route.kind === "history" || route.kind === "missing" ? route.kind : "explorer";
}

/** 상단 탭(내비게이션). 탐색기 탭은 마지막으로 본 page 라우트(없으면 home)로 돌아간다. */
export function LiveTabs({ route }: { route: Route }) {
  const { missing } = useLive();
  const lastExplorer = useRef<Route>({ kind: "home" });
  useEffect(() => {
    if (route.kind === "page" || route.kind === "home") lastExplorer.current = route;
  }, [route]);

  const go = (v: string) => {
    const next: Route = v === "history" ? { kind: "history" } : v === "missing" ? { kind: "missing" } : lastExplorer.current;
    window.location.hash = formatRoute(next);
  };

  return (
    <Tabs value={tabOf(route)} onValueChange={go}>
      <TabsList>
        <TabsTrigger value="explorer">탐색기</TabsTrigger>
        <TabsTrigger value="history">기록</TabsTrigger>
        <TabsTrigger value="missing">못 본 것 ({missing.length})</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
