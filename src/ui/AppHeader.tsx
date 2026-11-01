import { Search } from "lucide-react";
import { useDiagnosis } from "@/app/DiagnosisProvider";
import { useLive } from "@/app/LiveProvider";
import { attentionCount } from "@/core/diagnose";
import { type Route } from "@/app/route";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConnectionStatusButton } from "./live/ConnectionStatusButton";
import { PlayTopBarMapName } from "./live/PlayTopBarMapName";
import { GameActions } from "./GameActions";
import { useLoadErrors } from "./useLoadErrors";
import { terms } from "./terms";
import { viewOf } from "./views";

export function AppHeader({ route, onSearch }: { route: Route; onSearch: () => void }) {
  const errors = useLoadErrors();
  const { report } = useDiagnosis();
  const { install } = useLive();
  const attention = errors.length + (report ? attentionCount(report) : 0) + (install?.state === "installed" && install.outdated ? 1 : 0);
  return <header className="flex h-12 min-w-0 shrink-0 items-center gap-2 border-b px-2 min-[900px]:px-4">
    <div className="flex min-w-0 flex-1 items-center gap-1.5"><GameActions menu /><ConnectionStatusButton /><span className="text-muted-foreground">·</span><PlayTopBarMapName remaining={false} /></div>
    <Tabs value={viewOf(route)} className="hidden shrink-0 min-[900px]:flex"><TabsList>
      <TabsTrigger value="play" asChild><a href="#/play">{terms.play}</a></TabsTrigger>
      <TabsTrigger value="browse" asChild><a href="#/browse/events">{terms.browse}</a></TabsTrigger>
      <TabsTrigger value="manage" asChild><a href="#/manage">{terms.manage}{attention > 0 && <Badge variant={errors.length ? "destructive" : "warning"}>{attention}</Badge>}</a></TabsTrigger>
    </TabsList></Tabs>
    <Button variant="ghost" size="icon-sm" className="shrink-0" aria-label="검색 (Ctrl+K)" onClick={onSearch}><Search /></Button>
  </header>;
}
