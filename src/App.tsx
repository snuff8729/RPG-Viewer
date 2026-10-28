import { useState } from "react";
import { Search } from "lucide-react";
import { GameProvider, useGame } from "@/app/GameProvider";
import { useRoute } from "@/app/route";
import { locationKey } from "@/core/index/locations";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StartScreen } from "@/ui/StartScreen";
import { AppSidebar } from "@/ui/AppSidebar";
import { ErrorsBadge } from "@/ui/ErrorsBadge";

function Shell() {
  const { status, data, index } = useGame();
  const [route] = useRoute();
  const [showEmpty, setShowEmpty] = useState(false);

  if (status !== "ready" || !data || !index) return <StartScreen />;

  const entry = route.kind === "page"
    ? index.pages.find((p) => locationKey(p.location) === locationKey(route.location))
    : undefined;
  const crumbs = entry ? entry.path.split(" › ") : [];

  return (
    <SidebarProvider>
      <AppSidebar route={route} showEmpty={showEmpty} onShowEmptyChange={setShowEmpty} />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              {crumbs.map((c, i) => (
                <BreadcrumbItem key={i}>
                  {i > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbPage className={i === crumbs.length - 1 ? undefined : "font-normal text-muted-foreground"}>{c}</BreadcrumbPage>
                </BreadcrumbItem>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm">{data.system.gameTitle}</span>
            <Badge variant="secondary">{data.engine}</Badge>
            <ErrorsBadge />
            <Button variant="outline" size="sm"><Search />검색</Button>
          </div>
        </header>
        <main className="flex-1 p-4">
          {route.kind === "home" && <p className="text-sm text-muted-foreground">왼쪽에서 이벤트를 선택하세요</p>}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

export default function App() {
  return (
    <TooltipProvider>
      <GameProvider>
        <Shell />
      </GameProvider>
    </TooltipProvider>
  );
}
