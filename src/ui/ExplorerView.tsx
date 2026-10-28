import { useMemo, type ReactNode } from "react";
import { ChevronRight, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { mapNewCounts } from "@/core/live/interactable";
import { buildExplorerTree, filterExplorerTree, firstPage, type EventItem, type MapNode } from "./explorerTree";
import { mapKey, type ExplorerState } from "./useExplorerState";
import { useConditionsLive } from "./live/useConditionsLive";
import { openPage } from "./navigation";


function Group({ open, onOpenChange, title, children }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; children: ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="rounded-md border">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left text-sm">
        <ChevronRight className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
        {title}
      </CollapsibleTrigger>
      {/* 접힌 그룹은 CollapsibleContent가 내용을 렌더하지 않는다 */}
      <CollapsibleContent className="grid gap-1 border-t p-2 sm:grid-cols-2 lg:grid-cols-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function Events({ items }: { items: EventItem[] }) {
  return items.map((it) => (
    <Button key={it.key} variant="ghost" size="sm" className="justify-start" onClick={() => openPage(firstPage(it.first))}>
      <span className="truncate">{it.title}</span>
    </Button>
  ));
}

function MapTitle({ m, current, isTemplate, newCount }: { m: MapNode; current: boolean; isTemplate: boolean; newCount: number }) {
  return (
    <>
      <span className="min-w-0 truncate">
        {m.parents.length > 0 && <span className="text-muted-foreground">{m.parents.join(" › ")} › </span>}
        <span className="font-medium">{m.info.name}</span>
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{m.events.length}</span>
      {current && <Badge className="shrink-0">지금 이 맵</Badge>}
      {isTemplate && <Badge variant="outline" className="shrink-0 text-muted-foreground">템플릿</Badge>}
      {newCount > 0 && <Badge variant="outline" className="shrink-0">새 {newCount}</Badge>}
      {m.errors.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} role="img" aria-label="오류" className="shrink-0">
              <TriangleAlert className="size-4 text-destructive" />
            </span>
          </TooltipTrigger>
          <TooltipContent className="whitespace-pre-line">{m.errors.join("\n")}</TooltipContent>
        </Tooltip>
      )}
    </>
  );
}

/** 찾아보기: 모든 맵·공통 이벤트·전투의 이벤트 목록 */
export function ExplorerView({ state, onStateChange }: {
  state: ExplorerState; onStateChange: (f: (s: ExplorerState) => ExplorerState) => void;
}) {
  const { data, index } = useGame();
  const { live, connection, coverage } = useLive();
  const connected = connection === "connected";

  // 위치만 바뀐 스냅샷으로는 다시 세지 않는다(출현 조건 필드가 바뀔 때만)
  const condLive = useConditionsLive(live);
  const newCounts = useMemo(
    () => (data && index && condLive && connected ? mapNewCounts(data, index, coverage, condLive) : new Map<number, number>()),
    [data, index, coverage, condLive, connected],
  );
  const tree = useMemo(
    () => (data && index ? buildExplorerTree(index.pages, data.mapInfos, data.errors, state.showEmpty) : null),
    [data, index, state.showEmpty],
  );
  const shown = useMemo(() => (tree ? filterExplorerTree(tree, state.query) : null), [tree, state.query]);
  if (!data || !shown) return null;

  const filtering = state.query.trim() !== "";
  const isOpen = (k: string) => filtering || state.open.has(k);
  const setOpen = (k: string) => (o: boolean) =>
    onStateChange((s) => { const open = new Set(s.open); if (o) open.add(k); else open.delete(k); return { ...s, open }; });
  const empty = shown.maps.length === 0 && shown.common.length === 0 && shown.troops.length === 0;

  return (
    <div className="space-y-4 p-1">
      <div className="flex flex-wrap items-center gap-4">
        <Input
          className="h-8 max-w-xs"
          placeholder="이벤트 이름으로 찾기"
          value={state.query}
          onChange={(e) => { const query = e.target.value; onStateChange((s) => ({ ...s, query })); }}
        />
        <div className="flex items-center gap-2">
          <Switch
            id="show-empty"
            checked={state.showEmpty}
            onCheckedChange={(showEmpty) => onStateChange((s) => ({ ...s, showEmpty }))}
          />
          <Label htmlFor="show-empty">빈 이벤트도 보기</Label>
        </div>
      </div>
      {empty && <p className="text-sm text-muted-foreground">찾는 이벤트가 없어요</p>}
      {shown.maps.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">맵</h2>
          {shown.maps.map((m) => (
            <Group
              key={m.info.id}
              open={isOpen(mapKey(m.info.id))}
              onOpenChange={setOpen(mapKey(m.info.id))}
              title={(
                <MapTitle
                  m={m}
                  current={connected && live?.mapId === m.info.id}
                  isTemplate={m.info.id === data.templateMapId}
                  newCount={newCounts.get(m.info.id) ?? 0}
                />
              )}
            >
              <Events items={m.events} />
            </Group>
          ))}
        </section>
      )}
      {(shown.common.length > 0 || shown.troops.length > 0) && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">그 밖의 이벤트</h2>
          {shown.common.length > 0 && (
            <Group
              open={isOpen("common")}
              onOpenChange={setOpen("common")}
              title={<><span className="font-medium">공통 이벤트</span><span className="text-xs text-muted-foreground">{shown.common.length}</span></>}
            >
              <Events items={shown.common} />
            </Group>
          )}
          {shown.troops.length > 0 && (
            <Group
              open={isOpen("troop")}
              onOpenChange={setOpen("troop")}
              title={<><span className="font-medium">전투</span><span className="text-xs text-muted-foreground">{shown.troops.length}</span></>}
            >
              <Events items={shown.troops} />
            </Group>
          )}
        </section>
      )}
    </div>
  );
}
