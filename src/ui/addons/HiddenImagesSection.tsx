import { SettingsDescription } from "./SettingsDescription";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { useAddons } from "@/app/AddonsProvider";
import { cleanHiddenPattern, HIDDEN_IMAGES_MAX, withHidden } from "@/core/addons/hiddenImages";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** 새로 적은 이름·패턴의 문제(없으면 null) */
function problemOf(text: string, list: string[]): string | null {
  if (!text) return null;
  const p = cleanHiddenPattern(text);
  if (!p) return "그림 이름을 그대로 적거나, 끝에 *를 붙여 그 이름으로 시작하는 그림을 모두 숨길 수 있어요.";
  if (list.some((x) => x.toLowerCase() === p.toLowerCase())) return "이미 추가했어요.";
  if (list.length >= HIDDEN_IMAGES_MAX) return `최대 ${HIDDEN_IMAGES_MAX}개까지 추가할 수 있어요.`;
  return null;
}

/** 게임 설정 › 숨긴 그림: 읽기에서 그리지 않을 그림 이름·패턴(`Guage*`) 목록 */
export function HiddenImagesSection() {
  const { hiddenImages, setHiddenImages } = useAddons();
  const [draft, setDraft] = useState("");
  const text = draft.trim();
  const problem = problemOf(text, hiddenImages);
  const add = () => {
    if (!text || problem) return;
    setHiddenImages(withHidden(hiddenImages, text));
    setDraft("");
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>숨긴 그림</CardTitle>
        <SettingsDescription summary="읽기에서 표시하지 않을 그림을 골라요." detail="이 그림만 바뀐 곳은 새 그림으로 보이지 않아요. 끝에 *를 붙이면 그 이름으로 시작하는 그림을 모두 숨겨요(예: Guage*)." />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {hiddenImages.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {hiddenImages.map((h) => (
              <li key={h} className="flex items-center gap-2">
                <Input value={h} readOnly className="font-mono" aria-label="숨긴 그림" />
                <Button variant="ghost" size="icon" aria-label={`${h} 다시 보이기`} onClick={() => setHiddenImages(hiddenImages.filter((x) => x !== h))}>
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">숨긴 그림이 없어요. 읽기의 그림 옆 숨기기 단추로도 고를 수 있어요.</p>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="hidden-image-new">그림 추가</Label>
          <div className="flex items-center gap-2">
            <Input
              id="hidden-image-new"
              value={draft}
              placeholder="예: Guage*"
              className="font-mono"
              aria-invalid={problem ? true : undefined}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            />
            <Button variant="outline" size="sm" disabled={!text || problem !== null} onClick={add}><Plus />추가</Button>
          </div>
          {problem && <p className="text-sm text-destructive">{problem}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
