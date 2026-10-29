import { useEffect, useRef, useState } from "react";
import { BookOpen, Gauge, WandSparkles } from "lucide-react";
import type { PopoutModule } from "@/app/popout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AssistTab } from "./AssistTab";
import { CheatContent, onOpenCheatRequest } from "./cheat/CheatSheet";
import { useCheatSession } from "./cheat/useCheatSession";
import { isToolTab, loadToolTab, saveToolTab, type ToolTab } from "./playLayout";
import { focusPopout } from "./popouts";
import { PopoutButton, PoppedOutNotice, useModulePoppedOut } from "./PopoutControls";
import { ReaderView } from "./ReaderView";
import { useAssistSession } from "./useAssistSession";

const MODULE_OF: Record<ToolTab, PopoutModule> = { cheat: "cheat", assist: "assist", read: "reader" };

/** 읽기 화면은 자기 높이를 창 높이로 정한다 — 칸 높이에 맞춘다 */
export function ReaderFill() {
  return (
    <div className="flex h-full min-h-0 flex-col px-3 pt-2 pb-3 *:h-full! *:min-h-0">
      <ReaderView />
    </div>
  );
}

/**
 * PC 플레이 화면 도구 칸: 탭 `치트 | 보조 | 읽기`(마지막 탭 기억). 치트·보조는 칸 안에 그대로(덮개 없이) 그린다.
 * 탭을 바꿔도 남아야 하는 것(치트 기록·보조 응답 글)은 여기서 가진다. 읽기는 늘 살려 두고 숨기기만 한다(읽은 위치 유지).
 * 떼어 낸 탭은 "따로 창에서 보는 중"만 보인다(치트를 두 곳에서 동시에 켜지 않는다).
 * 다른 곳에서 치트를 열어 달라고 하면(openCheatSheet) 치트 탭으로 바꾼다(떼어 냈으면 그 창을 앞으로).
 */
export function ToolsColumn() {
  const [tab, setTabState] = useState<ToolTab>(loadToolTab);
  const setTab = (t: ToolTab) => { setTabState(t); saveToolTab(t); };
  const cheatSession = useCheatSession();
  const assistSession = useAssistSession();
  const cheatOut = useModulePoppedOut("cheat");
  const assistOut = useModulePoppedOut("assist");
  const readerOut = useModulePoppedOut("reader");

  const cheatOutRef = useRef(cheatOut);
  useEffect(() => { cheatOutRef.current = cheatOut; });
  useEffect(() => onOpenCheatRequest(() => {
    if (cheatOutRef.current && focusPopout("cheat")) return;
    setTabState("cheat");
    saveToolTab("cheat");
  }), []);

  return (
    <Tabs value={tab} onValueChange={(v) => { if (isToolTab(v)) setTab(v); }} className="h-full min-h-0 gap-0">
      <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1.5">
        <TabsList>
          <TabsTrigger value="cheat"><WandSparkles />치트</TabsTrigger>
          <TabsTrigger value="assist"><Gauge />보조</TabsTrigger>
          <TabsTrigger value="read"><BookOpen />읽기</TabsTrigger>
        </TabsList>
        <PopoutButton module={MODULE_OF[tab]} className="ml-auto" />
      </div>
      <TabsContent value="cheat" className="min-h-0 overflow-y-auto">
        {cheatOut ? <PoppedOutNotice module="cheat" /> : <CheatContent session={cheatSession} active={tab === "cheat"} className="p-3" />}
      </TabsContent>
      <TabsContent value="assist" className="min-h-0 overflow-y-auto">
        {assistOut ? <PoppedOutNotice module="assist" /> : <AssistTab session={assistSession} active={tab === "assist"} className="max-w-xl p-3" />}
      </TabsContent>
      <TabsContent value="read" forceMount className="min-h-0 data-[state=inactive]:hidden">
        {readerOut ? <PoppedOutNotice module="reader" /> : <ReaderFill />}
      </TabsContent>
    </Tabs>
  );
}
