import { BookOpen, Ellipsis, Gauge, Map, WandSparkles } from "lucide-react";
import { type Route } from "@/app/route";
import { useLive } from "@/app/LiveProvider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { loadPlayTab, savePlayTab } from "./live/mobilePlay";
import { terms } from "./terms";

export function BottomNavigation({ route }: { route: Route }) {
  const { live } = useLive();
  const tab = route.kind === "play" ? (route.module ?? loadPlayTab()) : "more";
  return (
    <Tabs value={tab} className="shrink-0 gap-0 border-t pb-[env(safe-area-inset-bottom)] min-[900px]:hidden">
      <TabsList className="h-14 w-full rounded-none group-data-horizontal/tabs:h-14" aria-label="화면 이동">
        {(
          [
            ["map", terms.map, Map],
            ["assist", terms.assist, Gauge],
            ["cheat", terms.cheat, WandSparkles],
            ["read", terms.read, BookOpen],
            ["more", terms.more, Ellipsis],
          ] as const
        ).map(([key, label, Icon]) => (
          <TabsTrigger key={key} value={key} className="flex-1 flex-col gap-0.5 text-xs" asChild>
            <a
              href={key === "more" ? "#/more" : `#/play/${key}`}
              onClick={() => {
                if (key !== "more") savePlayTab(key);
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
