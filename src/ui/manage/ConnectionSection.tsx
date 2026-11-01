import { useGame } from "@/app/GameProvider";
import { Separator } from "@/components/ui/separator";
import { InstallSection } from "@/ui/live/InstallSection";
import { GamePathForm } from "@/ui/live/GamePathDialog";
import { LaunchButton } from "@/ui/live/LaunchButton";
import { useGamePath, useLauncherAvailable } from "@/ui/live/useGamePath";
import { gameKeyOf } from "@/ui/live/readPosition";

export function ConnectionSection() {
  const { data } = useGame();
  const { path, save, fromServer } = useGamePath(data ? gameKeyOf(data) : null);
  const available = useLauncherAvailable();
  return <div className="space-y-6">
    <InstallSection />
    <Separator />
    <div className="space-y-3">
      <h3 className="font-medium">게임 폴더 위치</h3>
      <p className="text-sm text-muted-foreground">실행·세이브 백업·휴대폰 보기·AI에게 맡기기에서 함께 써요.</p>
      {fromServer ? <p className="break-all text-sm">{path}</p> : available && data ? <GamePathForm key={path} inline open onOpenChange={() => {}} initialPath={path ?? ""} initialError={null} openedTitle={data.system.gameTitle} confirmLabel="위치 저장" onConfirm={async p => { save(p); return null; }} /> : <p className="text-sm text-muted-foreground">뷰어 서버에서 게임 폴더 위치를 지정할 수 있어요.</p>}
    </div>
    <div className="flex flex-wrap items-center gap-2"><LaunchButton /></div>
  </div>;
}
