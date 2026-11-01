import { BookOpen, Ellipsis, Gauge, Map, WandSparkles } from "lucide-react";
import { type Route } from "@/app/route";
import { useLive } from "@/app/LiveProvider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isPlayTab, loadPlayTab, savePlayTab } from "./live/mobilePlay";
import { terms } from "./terms";

/** 휴대폰 아래 탭: 맵·보조·치트(플레이) · 읽기(따로 화면, PC 머리줄의 읽기와 같아요) · 더보기(찾아보기·관리) */
export function BottomNavigation({ route }: { route: Route }) {
  const { live } = useLive();
  const tab =
    route.kind === "play"
      ? isPlayTab(route.module) ? route.module : route.module === "read" ? "read" : loadPlayTab()
      : route.kind === "read" ? "read" : "more";
  return (
    <Tabs value={tab} className="shrink-0 gap-0 border-t pb-[env(safe-area-inset-bottom)] min-[900px]:hidden">
      <TabsList className="h-14 w-full rounded-none group-data-horizontal/tabs:h-14" aria-label="화면 이동">
        {(
          [
            ["map", terms.map, Map, "#/play/map"],
            ["assist", terms.assist, Gauge, "#/play/assist"],
            ["cheat", terms.cheat, WandSparkles, "#/play/cheat"],
            ["read", terms.read, BookOpen, "#/read"],
            ["more", terms.more, Ellipsis, "#/more"],
          ] as const
        ).map(([key, label, Icon, href]) => (
          <TabsTrigger key={key} value={key} className="flex-1 flex-col gap-0.5 text-xs" asChild>
            <a
              href={href}
              onClick={() => {
                if (isPlayTab(key)) savePlayTab(key);
              }}
            >
              <Icon />
              {label}
              {key === "read" && live?.choice && tab !== "read" && (
                <span className="absolute top-1 right-3 size-2 rounded-full bg-info" aria-label="새 선택지가 있어요" />
              )}
            </a>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
