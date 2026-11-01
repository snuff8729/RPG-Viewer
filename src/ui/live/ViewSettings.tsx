import { useState, type ReactNode } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";

/** 보기 설정 한 줄: 이름 왼쪽, 스위치 오른쪽(children은 스위치 앞에) */
export function SettingRow({ id, label, checked, onChange, disabled, children }: {
  id: string; label: string; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean; children?: ReactNode;
}) {
  return (
    <div className="flex min-h-9 items-center gap-3">
      <Label htmlFor={id} className="min-w-0 flex-1">{label}</Label>
      {children}
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
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
