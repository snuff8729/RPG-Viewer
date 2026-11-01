import { useState } from "react";
import { TriangleAlert, X } from "lucide-react";
import type { Route } from "@/app/route";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useCompact } from "@/hooks/use-compact";
import { bannerText, needsPluginBanner } from "./connectionGuide";
import { ConnectionActionButton, useConnectionAction } from "./ConnectionAction";

/** 이번에 연 동안만 닫아 둬요(다시 열면 또 보여요) */
let dismissedThisLoad = false;

/** 이 화면에 이미 설치·업데이트 버튼이 있는지(플레이 안내, 관리 › 연결·실행) */
function routeHasOwnGuide(route: Route, compact: boolean): boolean {
  if (route.kind === "play") return true;
  if (route.kind === "manage") return route.section === "connection" || (!route.section && !compact);
  return false;
}

/** 머리줄 아래 알림 줄: 기록 플러그인 설치·업데이트가 필요할 때만 한 문장 + 버튼 하나. */
export function PluginBanner({ route }: { route: Route }) {
  const ctl = useConnectionAction();
  const compact = useCompact();
  const [dismissed, setDismissed] = useState(dismissedThisLoad);
  const state = ctl.status.state;
  if (dismissed || !needsPluginBanner(state) || routeHasOwnGuide(route, compact)) return null;
  const action = ctl.guide?.action ?? null;
  return (
    <Alert className="flex shrink-0 items-center gap-2 rounded-none border-x-0 border-t-0 border-warning/50 bg-warning/10 px-3 py-1.5 min-[900px]:px-4">
      <span aria-hidden className="text-warning">
        <TriangleAlert className="size-4" />
      </span>
      <AlertDescription className="min-w-0 flex-1 text-foreground">{bannerText(state, ctl.status.remote)}</AlertDescription>
      {action && <ConnectionActionButton action={action} ctl={ctl} size="sm" />}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="알림 닫기"
        onClick={() => {
          dismissedThisLoad = true;
          setDismissed(true);
        }}
      >
        <X />
      </Button>
      {ctl.dialog}
    </Alert>
  );
}
