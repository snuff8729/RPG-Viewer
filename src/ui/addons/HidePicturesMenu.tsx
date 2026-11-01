import { useMemo } from "react";
import { EyeOff } from "lucide-react";
import { useAddons } from "@/app/AddonsProvider";
import { hiddenImageMatcher, matchesHiddenPattern, similarPattern, withHidden } from "@/core/addons/hiddenImages";
import type { ScreenShot } from "@/core/addons/screenPictures";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** 그림 항목의 겹들: 이름(처음 나온 순서)과 구분 */
function layersOf(shot: ScreenShot): { name: string; role: "cg" | "stand" }[] {
  const out: { name: string; role: "cg" | "stand" }[] = [];
  const seen = new Set<string>();
  for (const p of shot.pictures) {
    if (!p?.name || seen.has(p.name)) continue;
    seen.add(p.name);
    out.push({ name: p.name, role: shot.kind === "cg" && shot.cg?.includes(p) ? "cg" : "stand" });
  }
  return out;
}

/**
 * 읽기 그림 항목의 `그림 숨기기` 메뉴: 이 항목의 겹마다 `읽기에서 숨기기`, 비슷한 이름(끝 번호를 뺀 `앞부분*`)을 모두 숨기기.
 * 바로 적용된다(숨긴 것은 게임 설정 › 숨긴 그림에서 되돌린다).
 */
export function HidePicturesMenu({ shot }: { shot: ScreenShot }) {
  const { hiddenImages, setHiddenImages } = useAddons();
  const layers = useMemo(() => layersOf(shot), [shot]);
  const isHidden = useMemo(() => hiddenImageMatcher(hiddenImages), [hiddenImages]);
  const similar = useMemo(() => [...new Set(layers.map((l) => similarPattern(l.name)).filter((p) => p.endsWith("*")))], [layers]);
  if (layers.length === 0) return null;
  const toggle = (name: string, hide: boolean) => {
    if (hide) setHiddenImages(withHidden(hiddenImages, name));
    else setHiddenImages(hiddenImages.filter((x) => !matchesHiddenPattern(name, x)));
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" className="shrink-0 text-muted-foreground" aria-label="그림 숨기기" title="그림 숨기기">
          <EyeOff />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>읽기에서 숨기기</DropdownMenuLabel>
        <DropdownMenuGroup>
          {layers.map((l) => (
            <DropdownMenuCheckboxItem
              key={l.name}
              checked={isHidden?.(l.name) ?? false}
              onCheckedChange={(v) => toggle(l.name, v === true)}
              onSelect={(e) => e.preventDefault()}
            >
              <span className="min-w-0 flex-1 truncate" title={l.name}>{l.name}</span>
              <Badge variant="secondary">{l.role === "cg" ? "이벤트 그림" : "스탠딩"}</Badge>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        {similar.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>비슷한 이름 모두 숨기기</DropdownMenuLabel>
            <DropdownMenuGroup>
              {similar.map((p) => (
                <DropdownMenuItem key={p} onSelect={() => setHiddenImages(withHidden(hiddenImages, p))}>
                  <span className="min-w-0 flex-1 truncate font-mono" title={p}>{p}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-xs text-muted-foreground">관리 › 게임 맞춤 설정 › 숨긴 그림에서 되돌릴 수 있어요.</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
