import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useGame } from "@/app/GameProvider";
import type { Route } from "@/app/route";
import { locationKey } from "@/core/index/locations";
import type { Location, PageEntry, Ref } from "@/core/types";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { openPage } from "./navigation";
import { RefBadge } from "./RefBadge";
import { ScriptView } from "./script/ScriptView";
import { XrefSheet } from "./XrefSheet";

function sameEvent(a: Location, b: Location): boolean {
  if (a.source === "map" && b.source === "map") return a.mapId === b.mapId && a.eventId === b.eventId;
  if (a.source === "common" && b.source === "common") return a.commonEventId === b.commonEventId;
  if (a.source === "troop" && b.source === "troop") return a.troopId === b.troopId;
  return false;
}

function pageOf(l: Location): number {
  return l.source === "common" ? 0 : l.page;
}

function withPage(l: Location, page: number): Location {
  return l.source === "common" ? l : { ...l, page };
}

function Callers({ id }: { id: number }) {
  const { index } = useGame();
  const callers = index?.callers(id) ?? [];
  return (
    <Collapsible className="mb-4 max-w-3xl rounded-md border">
      <CollapsibleTrigger className="group flex w-full items-center gap-1 px-3 py-1.5 text-sm font-medium">
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        호출하는 곳 {callers.length}곳
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-1 py-1">
        {callers.length === 0 && <p className="px-2 py-1 text-sm text-muted-foreground">호출하는 곳이 없어요</p>}
        {callers.map((c) => (
          <Button key={locationKey(c.location)} variant="ghost" size="sm" className="w-full justify-start" onClick={() => openPage(c.location)}>
            {c.path}
          </Button>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function EventView({ route }: { route: Extract<Route, { kind: "page" }> }) {
  const { index } = useGame();
  const [xrefTarget, setXrefTarget] = useState<Ref | null>(null);
  const loc = route.location;
  const pages: PageEntry[] = (index?.pages ?? [])
    .filter((p) => sameEvent(p.location, loc))
    .sort((a, b) => pageOf(a.location) - pageOf(b.location));
  const current = pages.find((p) => locationKey(p.location) === locationKey(loc));

  if (!current) return <p className="text-sm text-muted-foreground">찾을 수 없는 이벤트예요</p>;

  return (
    <div>
      {loc.source === "common" && <Callers id={loc.commonEventId} />}
      {pages.length >= 2 && (
        <Tabs value={String(pageOf(loc))} onValueChange={(v) => openPage(withPage(loc, Number(v)))} className="mb-4">
          <TabsList>
            {pages.map((p) => (
              <TabsTrigger key={pageOf(p.location)} value={String(pageOf(p.location))}>
                페이지 {pageOf(p.location) + 1}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      <div className="mb-3 flex max-w-3xl flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">나타나는 조건</span>
        {current.conditions.length === 0
          ? <span className="text-sm">항상</span>
          : current.conditions.map((c, i) => <RefBadge key={i} condition={c} onRefClick={setXrefTarget} />)}
      </div>
      <Card className="max-w-3xl">
        <CardContent>
          <ScriptView
            key={locationKey(current.location)} pageKey={locationKey(current.location)}
            nodes={current.nodes} basePath={[]} onRefClick={setXrefTarget}
          />
        </CardContent>
      </Card>
      <XrefSheet refTarget={xrefTarget} onClose={() => setXrefTarget(null)} />
    </div>
  );
}
