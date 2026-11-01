import { terms } from "@/ui/terms";
import { useRoute } from "@/app/route";
import { ReadModule } from "./ReadModule";
import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Gauge, PanelRightClose, PanelRightOpen, WandSparkles, type LucideIcon } from "lucide-react";
import type { PopoutModule } from "@/app/popout";
import { LiveFreeze } from "@/app/LiveProvider";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AssistTab } from "./AssistTab";
import { CheatContent, onOpenCheatRequest } from "./cheat/CheatContent";
import { useCheatSession } from "./cheat/useCheatSession";
import { isToolTab, loadToolTab, saveToolTab, type ToolTab } from "./playLayout";
import { focusPopout } from "./popouts";
import { PopoutButton, PoppedOutNotice, useModulePoppedOut } from "./PopoutControls";
import { useAssistSession } from "./useAssistSession";

const MODULE_OF: Record<ToolTab, PopoutModule> = { cheat: "cheat", assist: "assist", read: "reader" };
const TOOL_ICON: Record<ToolTab, LucideIcon> = { assist: Gauge, cheat: WandSparkles, read: BookOpen };
const TOOL_LABEL: Record<ToolTab, string> = { assist: terms.assist, cheat: terms.cheat, read: terms.read };

/** 읽기 모듈을 칸 높이에 맞춰 채워요(따로 창·도구 칸). */
export function ReaderFill() {
  return (
    <div className="flex h-full min-h-0 flex-col px-3 pt-2 pb-3">
      <ReadModule />
    </div>
  );
}

/** 접은 도구 칸: 펼치기 단추와 탭 아이콘(누르면 그 탭으로 펼쳐요). */
export function CollapsedTools({ onExpand }: { onExpand: () => void }) {
  return (
    <div className="flex h-full flex-col items-center gap-1 py-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="도구 칸 펼치기" onClick={onExpand}><PanelRightOpen /></Button>
        </TooltipTrigger>
        <TooltipContent side="left">도구 칸 펼치기</TooltipContent>
      </Tooltip>
      {(["assist", "cheat", "read"] as const).map((t) => {
        const Icon = TOOL_ICON[t];
        return (
          <Tooltip key={t}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost" size="icon-sm" aria-label={TOOL_LABEL[t]}
                onClick={() => { saveToolTab(t); window.location.hash = `#/play/${t}`; onExpand(); }}
              >
                <Icon />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">{TOOL_LABEL[t]}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

/**
 * PC 플레이 화면 도구 칸: 탭 `보조 | 치트 | 읽기`(마지막 탭 기억). 치트·보조는 칸 안에 그대로(덮개 없이) 그린다.
 * 탭을 바꿔도 남아야 하는 것(치트 기록·보조 응답 글)은 여기서 가진다. 읽기는 늘 살려 두고 숨기기만 한다(읽은 위치 유지).
 * 숨긴 동안은 기록·게임 상태를 멈춰 두어(LiveFreeze) 새 기록마다 긴 기록 전체로 읽기 항목을 다시 만들지 않는다.
 * 떼어 낸 탭은 "따로 창에서 보는 중"만 보인다(치트를 두 곳에서 동시에 켜지 않는다).
 * 다른 곳에서 치트를 열어 달라고 하면(openCheatSheet) 치트 탭으로 바꾼다(떼어 냈으면 그 창을 앞으로).
 */
export function ToolsColumn({ onCollapse }: { onCollapse?: () => void }) {
  const [route] = useRoute();
  const [savedTab, setTabState] = useState<ToolTab>(loadToolTab);
  const tab = route.kind === "play" && route.module && route.module !== "map" ? route.module : savedTab;
  const setTab = (t: ToolTab) => { setTabState(t); saveToolTab(t); window.location.hash = `#/play/${t}`; };
  const cheatSession = useCheatSession();
  const assistSession = useAssistSession();
  const cheatOut = useModulePoppedOut("cheat");
  const assistOut = useModulePoppedOut("assist");
  const readerOut = useModulePoppedOut("reader");
  // 같은 요소를 계속 넘겨 이 칸이 다시 그려져도 읽기는 LiveFreeze가 정할 때만 다시 그린다
  const reader = useMemo(() => <ReaderFill />, []);

  const cheatOutRef = useRef(cheatOut);
  useEffect(() => { cheatOutRef.current = cheatOut; });
  useEffect(() => onOpenCheatRequest(() => {
    if (cheatOutRef.current && focusPopout("cheat")) return;
    setTabState("cheat");
    saveToolTab("cheat");
    window.location.hash = "#/play/cheat";
  }), []);

  return (
    <Tabs value={tab} onValueChange={(v) => { if (isToolTab(v)) setTab(v); }} className="h-full min-h-0 gap-0">
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
        <TabsList>
          {(["assist", "cheat", "read"] as const).map((t) => {
            const Icon = TOOL_ICON[t];
            return <TabsTrigger key={t} value={t}><Icon />{TOOL_LABEL[t]}</TabsTrigger>;
          })}
        </TabsList>
        <PopoutButton module={MODULE_OF[tab]} className="ml-auto" />
        {onCollapse && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="도구 칸 접기" onClick={onCollapse}><PanelRightClose /></Button>
            </TooltipTrigger>
            <TooltipContent>도구 칸 접기</TooltipContent>
          </Tooltip>
        )}
      </div>
      <TabsContent value="cheat" className="min-h-0 overflow-y-auto">
        {cheatOut ? <PoppedOutNotice module="cheat" /> : <CheatContent session={cheatSession} active={tab === "cheat"} className="p-3" />}
      </TabsContent>
      <TabsContent value="assist" className="min-h-0 overflow-y-auto">
        {assistOut ? <PoppedOutNotice module="assist" /> : <AssistTab session={assistSession} active={tab === "assist"} className="mx-auto max-w-xl p-3" />}
      </TabsContent>
      <TabsContent value="read" forceMount className="min-h-0 data-[state=inactive]:hidden">
        {readerOut ? <PoppedOutNotice module="reader" /> : <LiveFreeze active={tab === "read"}>{reader}</LiveFreeze>}
      </TabsContent>
    </Tabs>
  );
}
