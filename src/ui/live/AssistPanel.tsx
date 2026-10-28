import { Gauge } from "lucide-react";
import { useAssist, useLive } from "@/app/LiveProvider";
import { AUTO_SPEEDS, isAutoSpeed, isSpeed, SPEEDS } from "@/core/live/assist";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/** 상단 `게임 보조` Popover: 배속·본 대사 자동 넘기기·자동 배속·전투 조작. */
export function AssistPanel() {
  const { settings, setSettings, sendCommand, supported } = useAssist();
  const { live } = useLive();
  const inBattle = supported && live?.inBattle === true;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm"><Gauge />게임 보조</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <PopoverHeader>
          <PopoverTitle>게임 보조</PopoverTitle>
          {!supported && <PopoverDescription>플러그인을 1.1.0으로 업데이트하면 쓸 수 있어요</PopoverDescription>}
        </PopoverHeader>
        <div className="flex flex-col gap-2">
          <Label>배속</Label>
          <ToggleGroup
            type="single" variant="outline" size="sm" disabled={!supported}
            value={String(settings.speed)}
            onValueChange={(v) => { const n = Number(v); if (isSpeed(n)) setSettings({ ...settings, speed: n }); }}
          >
            {SPEEDS.map((s) => <ToggleGroupItem key={s} value={String(s)}>×{s}</ToggleGroupItem>)}
          </ToggleGroup>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="assist-skip-seen">본 대사 자동 넘기기</Label>
          <Switch
            id="assist-skip-seen" disabled={!supported} checked={settings.skipSeen}
            onCheckedChange={(c) => setSettings({ ...settings, skipSeen: c })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="assist-auto-fast">본 이벤트 자동 배속</Label>
            <Switch
              id="assist-auto-fast" disabled={!supported} checked={settings.autoFast}
              onCheckedChange={(c) => setSettings({ ...settings, autoFast: c })}
            />
          </div>
          <ToggleGroup
            type="single" variant="outline" size="sm" disabled={!supported || !settings.autoFast}
            value={String(settings.autoSpeed)}
            onValueChange={(v) => { const n = Number(v); if (isAutoSpeed(n)) setSettings({ ...settings, autoSpeed: n }); }}
          >
            {AUTO_SPEEDS.map((s) => <ToggleGroupItem key={s} value={String(s)}>×{s}</ToggleGroupItem>)}
          </ToggleGroup>
        </div>
        {inBattle && (
          <>
            <Separator />
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => sendCommand("win")}>이기기</Button>
                <Button variant="outline" size="sm" onClick={() => sendCommand("lose")}>지기</Button>
                <Button variant="outline" size="sm" onClick={() => sendCommand("escape")}>도망</Button>
              </div>
              <p className="text-xs text-muted-foreground">패배 장면이 있는 전투면 그 장면이 나와요</p>
            </div>
          </>
        )}
        <Separator />
        <p className="text-xs text-muted-foreground">게임 창 단축키: F6 배속, F7 본 대사 넘기기, 전투 중 F10 이기기 · F11 지기</p>
      </PopoverContent>
    </Popover>
  );
}
