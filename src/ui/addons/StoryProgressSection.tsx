import { useMemo } from "react";
import { useAddons } from "@/app/AddonsProvider";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { keyText, parseKeyText, storyCandidates, storyKeyLabel, storyValue, type StoryKey } from "@/core/story/progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const AUTO = "auto";

/** `게임 설정`의 스토리 진행 기준: 다음 스토리를 찾을 때 쓰는 변수(또는 클리어 스위치 묶음). */
export function StoryProgressSection() {
  const { data } = useGame();
  const { live } = useLive();
  const { storyProgress, setStoryProgress } = useAddons();
  const candidates = useMemo(() => (data ? storyCandidates(data) : []), [data]);
  if (!data) return null;
  const keys: StoryKey[] = candidates.map((c) => c.key);
  if (storyProgress && !keys.some((k) => keyText(k) === keyText(storyProgress))) keys.push(storyProgress);
  const describe = (k: StoryKey) => {
    const name = storyKeyLabel(data, k);
    const kind = k.kind === "variable" ? `변수 #${k.id}` : "스위치 묶음";
    return live ? `${name} (${kind}) = ${storyValue(k, live)}` : `${name} (${kind})`;
  };
  const best = candidates[0];
  return (
    <Card>
      <CardHeader>
        <CardTitle><Label htmlFor="story-progress">스토리 진행 기준</Label></CardTitle>
        <CardDescription>
          다음 스토리를 찾을 때 이 값이 커지는 쪽을 따라가요. 보통은 자동으로 고른 것이 맞지만, 틀리면 직접 골라 주세요.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Select
          value={storyProgress ? keyText(storyProgress) : AUTO}
          onValueChange={(v) => setStoryProgress(v === AUTO ? null : parseKeyText(v))}
        >
          <SelectTrigger id="story-progress" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTO}>자동{best ? ` (${storyKeyLabel(data, best.key)})` : ""}</SelectItem>
            {keys.map((k) => <SelectItem key={keyText(k)} value={keyText(k)}>{describe(k)}</SelectItem>)}
          </SelectContent>
        </Select>
        {candidates.length === 0 && <p className="text-sm text-muted-foreground">진행 변수로 보이는 것을 찾지 못했어요.</p>}
        {best && !storyProgress && best.reasons.length > 0 && (
          <p className="text-sm text-muted-foreground">자동으로 고른 이유: {best.reasons.join(" · ")}</p>
        )}
      </CardContent>
    </Card>
  );
}
