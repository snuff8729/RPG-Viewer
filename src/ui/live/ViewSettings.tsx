import { useState, type ReactNode } from "react";
import { Settings2, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toggleVoiceMute, useVoiceVolume } from "./voiceVolume";

/** 보기 설정 한 줄: 이름 왼쪽, 스위치 오른쪽(children은 스위치 앞에) */
export function SettingRow({ id, label, description, checked, onChange, disabled, children }: {
  id: string; label: string; description?: string; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean; children?: ReactNode;
}) {
  return (
    <div className="flex min-h-9 items-center gap-3">
      {description ? (
        <div className="min-w-0 flex-1 space-y-0.5">
          <Label htmlFor={id}>{label}</Label>
          <p id={`${id}-description`} className="text-xs text-muted-foreground">{description}</p>
        </div>
      ) : (
        <Label htmlFor={id} className="min-w-0 flex-1">{label}</Label>
      )}
      {children}
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} aria-describedby={description ? `${id}-description` : undefined} />
    </div>
  );
}

/** 보기 설정의 `음성 소리`: 이 브라우저 전체에 하나(다시 듣기·자동 재생 모두). */
export function VoiceVolumeRow() {
  const [v, setV] = useVoiceVolume();
  const silent = v.muted || v.volume === 0;
  const muteLabel = silent ? "소리 켜기" : "음소거";
  return (
    <div className="flex min-h-9 items-center gap-3">
      <Label id="reader-voice-volume-label" className="shrink-0">음성 소리</Label>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={muteLabel} aria-pressed={silent} onClick={() => setV(toggleVoiceMute(v))}>
            {silent ? <VolumeX /> : <Volume2 />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{muteLabel}</TooltipContent>
      </Tooltip>
      <Slider
        aria-labelledby="reader-voice-volume-label"
        data-vaul-no-drag
        className="min-w-0 flex-1 py-2"
        min={0} max={100} step={1}
        value={[silent ? 0 : v.volume]}
        onValueChange={([n]) => setV({ volume: n, muted: false })}
      />
      <span className="w-10 shrink-0 text-right text-sm text-muted-foreground tabular-nums">{silent ? 0 : v.volume}%</span>
    </div>
  );
}

const TITLE = "보기 설정";

/** 읽기 모듈의 `보기 설정` 단추 하나: PC는 Popover, 휴대폰은 Drawer(같은 단추, 같은 내용). */
export function ViewSettingsButton({ mobile, description, children }: { mobile: boolean; description: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const trigger = (
    <Button variant="outline" size="icon-sm" aria-label={TITLE} title={TITLE}>
      <Settings2 />
    </Button>
  );
  if (mobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{TITLE}</DrawerTitle>
            <DrawerDescription>{description}</DrawerDescription>
          </DrawerHeader>
          <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-6">{children}</div>
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <PopoverHeader>
          <PopoverTitle>{TITLE}</PopoverTitle>
          <PopoverDescription>{description}</PopoverDescription>
        </PopoverHeader>
        {children}
      </PopoverContent>
    </Popover>
  );
}
