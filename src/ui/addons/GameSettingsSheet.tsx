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
  const applied = addon.id === "screenPictures" ? live.assist?.capturePictures === true : true;
  return (
    <p className="text-sm text-muted-foreground">
      {applied ? "게임에 적용됐어요. 지금부터 나오는 대사에 그림이 붙어요." : "게임에 적용하는 중이에요…"}
    </p>
  );
}

/** 상단 `게임 설정` Sheet: 이 게임에서만 켜는 부가 기능(애드온) 목록. */
export function GameSettingsSheet() {
  const { isOn, setOn, savedInFolder } = useAddons();
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
                  <CardTitle><Label htmlFor={id}>{a.label}</Label></CardTitle>
                  <CardDescription>{a.description}</CardDescription>
                  <CardAction>
                    <Switch id={id} checked={on} onCheckedChange={(v) => setOn(a.id, v)} />
                  </CardAction>
                </CardHeader>
                {on && <CardContent><AddonStatus addon={a} /></CardContent>}
              </Card>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
