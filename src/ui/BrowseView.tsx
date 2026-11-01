import { ArrowLeft } from "lucide-react";
import { type Route } from "@/app/route";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ExplorerView } from "./ExplorerView";
import { EventView } from "./EventView";
import { MissingView } from "./live/MissingView";
import { type ExplorerState } from "./useExplorerState";
import { terms } from "./terms";
export function BrowseView({ route, state, onStateChange }: { route: Route; state: ExplorerState; onStateChange: (f: (s: ExplorerState) => ExplorerState) => void }) {
  const tab = route.kind === "browse" ? route.tab ?? "events" : "events";
  return <div className="flex-1 space-y-4 p-4">
    <ToggleGroup type="single" variant="outline" value={tab} onValueChange={v => { if (v) window.location.hash = `#/browse/${v}`; }} aria-label="찾아보기 종류"><ToggleGroupItem value="events">{terms.events}</ToggleGroupItem><ToggleGroupItem value="missing">{terms.missing}</ToggleGroupItem></ToggleGroup>
    {tab === "missing" ? <MissingView /> : route.kind === "page" ? <><Button variant="ghost" size="sm" asChild><a href="#/browse/events"><ArrowLeft />이벤트 목록으로</a></Button><EventView route={route} /></> : <ExplorerView state={state} onStateChange={onStateChange} />}
  </div>;
}
