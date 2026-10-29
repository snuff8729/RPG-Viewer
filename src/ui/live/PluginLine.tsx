import { Info, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePluginOverrides } from "./pluginDisplay";

/** 이 명령(name) 보이기 설정: 자동 / 항상 보이기 / 항상 숨기기 (게임별 저장) */
export function PluginRowMenu({ name }: { name: string }) {
  const { overrides, setOverride } = usePluginOverrides();
  if (!name) return null;
  const value = Object.prototype.hasOwnProperty.call(overrides, name) ? overrides[name] : "auto";
  return (
    // 메뉴 클릭이 줄 클릭(이벤트로 이동)으로 번지지 않게
    <span className="shrink-0" onClick={e => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={`플러그인 명령(${name}) 보이기 설정`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="break-all">이 명령({name})</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={value} onValueChange={v => setOverride(name, v === "show" || v === "hide" ? v : null)}>
            <DropdownMenuRadioItem value="show">항상 보이기</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="hide">항상 숨기기</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="auto">자동</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

/** 플러그인 명령 한 줄: 글이면 글만(Info 아이콘), 기술 명령이면 `플러그인: 원문`. 숨김 여부는 부르는 쪽이 정한다. menu = 명령별 보이기 설정 메뉴(기록 화면) */
export function PluginLine({ text, raw, name, tech, menu = true }: { text: string; raw: string; name: string; tech: boolean; menu?: boolean }) {
  return (
    <div className="flex items-start gap-2 text-sm text-muted-foreground">
      {tech
        ? <span className="min-w-0 flex-1 break-words">플러그인: {raw}</span>
        : (
          <>
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{text}</span>
          </>
        )}
      {menu && <PluginRowMenu name={name} />}
    </div>
  );
}
