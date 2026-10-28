import { Settings2 } from "lucide-react";
import { useAddons } from "@/app/AddonsProvider";
import { useLive } from "@/app/LiveProvider";
import { ADDONS, type AddonDef } from "@/core/addons/registry";
import { versionAtLeast } from "@/core/live/assist";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { PictureRolesSection } from "./PictureRolesSection";
import { NoticeHooksSection } from "./NoticeHooksSection";
import { useGame } from "@/app/GameProvider";
import { Badge } from "@/components/ui/badge";
import type { GameData } from "@/core/types";

/** 켜진 애드온의 지금 상태 안내(게임이 실행 중인지, 플러그인 버전이 맞는지). */
function AddonStatus({ addon }: { addon: AddonDef }) {
  const { connection, live } = useLive();
  if (connection !== "connected" || !live) {
    return <p className="text-sm text-muted-foreground">게임을 실행하면 적용돼요. {addon.note}</p>;
  }
  if (addon.minPluginVersion && !versionAtLeast(live.pluginVersion, addon.minPluginVersion)) {
    return (
      <Alert>
        <AlertDescription>
          게임의 기록 플러그인({live.pluginVersion || "?"})이 {addon.minPluginVersion}보다 낮아요. 플러그인을 업데이트하고 게임을 다시 실행해 주세요.
        </AlertDescription>
      </Alert>
    );
  }
  if (addon.id === "notices") {
    if (live.assist?.captureNotices !== true) return <p className="text-sm text-muted-foreground">게임에 적용하는 중이에요…</p>;
    const found = Array.isArray(live.assist.notices) ? live.assist.notices.filter((s) => typeof s === "string") : [];
    return (
      <p className="text-sm text-muted-foreground">
        {found.length > 0
          ? `게임에 적용됐어요. 지금부터 나오는 알림 문구를 기록해요. (찾은 함수: ${found.join(", ")})`
          : "게임에 적용됐어요. 아직 알림 함수를 찾지 못했어요. 맵이나 전투 화면에 들어가면 다시 찾아요."}
      </p>
    );
  }
  const applied = addon.id === "screenPictures" ? live.assist?.capturePictures === true : true;
  return (
    <p className="text-sm text-muted-foreground">
      {applied ? "게임에 적용됐어요. 지금부터 나오는 대사에 그림이 붙어요." : "게임에 적용하는 중이에요…"}
    </p>
  );
}

/** 이 게임에서 쓸 수 있다는 표시를 붙일까(알림 문구: plugins.js에 아는 플러그인이 켜져 있음) */
function availableHere(addon: AddonDef, data: GameData | null | undefined): boolean {
  if (!addon.hint) return false;
  if (addon.id === "notices") return (data?.noticePlugins?.length ?? 0) > 0;
  return false;
}

/** 상단 `게임 설정` Sheet: 이 게임에서만 켜는 부가 기능(애드온) 목록. */
export function GameSettingsSheet() {
  const { isOn, setOn, savedInFolder } = useAddons();
  const { data } = useGame();
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm"><Settings2 />게임 설정</Button>
      </SheetTrigger>
      <SheetContent side="right" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>게임 설정</SheetTitle>
          <SheetDescription>
            이 게임에만 적용되는 부가 기능이에요.{savedInFolder ? " 설정은 게임 폴더(rpg-viewer/addons.json)에 저장돼요." : " 설정은 이 브라우저에 저장돼요."}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-4">
          {ADDONS.map((a) => {
            const id = `addon-${a.id}`;
            const on = isOn(a.id);
            return (
              <Card key={a.id}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    <Label htmlFor={id}>{a.label}</Label>
                    {availableHere(a, data) && (
                      <Badge variant="secondary" title={a.id === "notices" ? data?.noticePlugins?.join(", ") : undefined}>{a.hint}</Badge>
                    )}
                  </CardTitle>
                  <CardDescription>{a.description}</CardDescription>
                  <CardAction>
                    <Switch id={id} checked={on} onCheckedChange={(v) => setOn(a.id, v)} />
                  </CardAction>
                </CardHeader>
                {on && (
                  <CardContent className="flex flex-col gap-4">
                    <AddonStatus addon={a} />
                    {a.id === "screenPictures" && <PictureRolesSection />}
                    {a.id === "notices" && <NoticeHooksSection />}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
