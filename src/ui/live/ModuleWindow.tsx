import { useEffect, type ReactNode } from "react";
import { useGame } from "@/app/GameProvider";
import { POPOUT_LABEL, type ModuleWindowParams, type PopoutModule } from "@/app/popout";
import { StartScreen } from "@/ui/StartScreen";
import { AssistTab } from "./AssistTab";
import { CheatContent } from "./cheat/CheatSheet";
import { ConnectionBadge } from "./ConnectionBadge";
import { MapColumn } from "./PlayMapColumn";
import { ReaderFill } from "./PlayTools";
import { PlayTopBarMapName } from "./PlayTopBarMapName";
import { useModuleWindow } from "./popouts";

function ModuleBody({ module }: { module: PopoutModule }): ReactNode {
  switch (module) {
    case "map": return <MapColumn layoutId="rpgv.popout.map.layout" />;
    case "cheat": return <div className="h-full overflow-y-auto"><CheatContent className="p-3" /></div>;
    case "assist": return <div className="h-full overflow-y-auto"><AssistTab className="mx-auto max-w-xl p-3" /></div>;
    case "reader": return <ReaderFill />;
  }
}

/**
 * 따로 띄운 모듈 창(주소 `?module=<m>&game=<key>`): 그 모듈만 창 가득히, 위에 얇은 머리(연결 상태·모듈 이름).
 * 원래 창에 "여기 있어요"를 알리고 창 위치·크기를 기억한다(useModuleWindow). 게임을 아직 못 열었으면 시작 화면.
 */
export function ModuleWindow({ module, game }: ModuleWindowParams) {
  useModuleWindow(module, game);
  const { status, data, index } = useGame();
  useEffect(() => {
    const prev = document.title;
    document.title = `${POPOUT_LABEL[module]} · ${prev}`;
    return () => { document.title = prev; };
  }, [module]);
  if (status !== "ready" || !data || !index) return <StartScreen />;
  return (
    <div className="flex h-svh min-h-0 flex-col">
      <header className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1">
        <ConnectionBadge />
        <span className="text-sm font-semibold">{POPOUT_LABEL[module]}</span>
        {module === "map" && <PlayTopBarMapName />}
      </header>
      <div className="min-h-0 flex-1">
        <ModuleBody module={module} />
      </div>
    </div>
  );
}
