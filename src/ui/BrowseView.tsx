import { Fragment } from "react";
import { ArrowLeft, MousePointerClick } from "lucide-react";
import { useDefaultLayout } from "react-resizable-panels";
import { useGame } from "@/app/GameProvider";
import { type Route } from "@/app/route";
import { locationKey } from "@/core/index/locations";
import type { Location } from "@/core/types";
import { useCompact } from "@/hooks/use-compact";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ExplorerView } from "./ExplorerView";
import { EventView } from "./EventView";
import { MissingView } from "./live/MissingView";
import { safeStore } from "./live/playLayout";
import { type ExplorerState } from "./useExplorerState";
import { terms } from "./terms";

const layoutStore = safeStore();

/** 이벤트 위치(찾아보기 › 맵 › 이벤트 › 페이지). 맵 이름을 자르지 않고 줄바꿈해요. */
function EventBreadcrumb({ location }: { location: Location }) {
  const { index } = useGame();
  const key = locationKey(location);
  const entry = index?.pages.find((p) => locationKey(p.location) === key);
  const crumbs = entry ? entry.path.split(" › ") : [];
  return (
    <Breadcrumb>
      <BreadcrumbList className="wrap-anywhere">
        <BreadcrumbItem>
          <BreadcrumbLink href="#/browse/events">{terms.browse}</BreadcrumbLink>
        </BreadcrumbItem>
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              {i === crumbs.length - 1
                ? <BreadcrumbPage>{c}</BreadcrumbPage>
                : <span>{c}</span>}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function EventPane({ route }: { route: Extract<Route, { kind: "page" }> }) {
  return (
    <div className="space-y-4">
      <EventBreadcrumb location={route.location} />
      <EventView route={route} />
    </div>
  );
}

function NoEventPicked() {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon"><MousePointerClick /></EmptyMedia>
        <EmptyTitle>이벤트를 골라 주세요</EmptyTitle>
        <EmptyDescription>왼쪽 목록에서 이벤트를 누르면 대사와 조건이 여기에 보여요.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

type ExplorerProps = { state: ExplorerState; onStateChange: (f: (s: ExplorerState) => ExplorerState) => void };

/** PC(900px 이상): 왼쪽 목록 · 오른쪽 이벤트 두 칸(크기 기억) */
function EventsTwoPane({ route, state, onStateChange }: ExplorerProps & { route: Route }) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: "rpgv.browse.events", storage: layoutStore });
  const active = route.kind === "page" ? route.location : undefined;
  return (
    <ResizablePanelGroup orientation="horizontal" defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged} className="min-h-0 flex-1">
      <ResizablePanel id="tree" defaultSize="36%" minSize={240}>
        <div className="h-full overflow-y-auto p-3">
          <ExplorerView state={state} onStateChange={onStateChange} pane active={active} />
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel id="event" minSize={360}>
        <div className="h-full overflow-y-auto p-4">
          {route.kind === "page" ? <EventPane route={route} /> : <NoEventPicked />}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

/** 휴대폰·좁은 창: 목록 → 이벤트(뒤로) 두 단계 */
function EventsSteps({ route, state, onStateChange }: ExplorerProps & { route: Route }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      {route.kind === "page" ? (
        <div className="space-y-3">
          <Button variant="ghost" size="sm" asChild>
            <a href="#/browse/events"><ArrowLeft />이벤트 목록으로</a>
          </Button>
          <EventPane route={route} />
        </div>
      ) : (
        <ExplorerView state={state} onStateChange={onStateChange} />
      )}
    </div>
  );
}

export function BrowseView({ route, state, onStateChange }: ExplorerProps & { route: Route }) {
  const compact = useCompact();
  const tab = route.kind === "browse" ? (route.tab ?? "events") : "events";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b px-3 py-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={tab}
          onValueChange={(v) => {
            if (v) window.location.hash = `#/browse/${v}`;
          }}
          aria-label="찾아보기 종류"
        >
          <ToggleGroupItem value="events">{terms.events}</ToggleGroupItem>
          <ToggleGroupItem value="missing">{terms.missing}</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {tab === "missing" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <MissingView />
        </div>
      ) : compact ? (
        <EventsSteps route={route} state={state} onStateChange={onStateChange} />
      ) : (
        <EventsTwoPane route={route} state={state} onStateChange={onStateChange} />
      )}
    </div>
  );
}
