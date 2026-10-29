import { useMemo } from "react";
import { useAddons } from "@/app/AddonsProvider";
import { useLive, useLiveData } from "@/app/LiveProvider";
import { nextStory, type NextStory } from "@/core/story/nextStep";
import { chooseStoryKey, keyText, sideCandidates, type StoryCandidate, type StoryKey } from "@/core/story/progress";
import { gameKeyOf } from "./readPosition";
import { useConditionsLive } from "./useConditionsLive";
import { useStoryFollow } from "./storyFollow";

export interface NextStoryState {
  key: StoryKey | null;
  story: NextStory | null;
  auto: boolean;
  /** 본편을 따라가는지, 고른 서브 미션을 따라가는지 */
  mode: "main" | "side";
  /** 고를 수 있는 서브 미션(본편 기준은 뺀다) */
  sides: StoryCandidate[];
  /** 따라가는 서브 미션 keyText(본편이면 null) */
  follow: string | null;
  setFollow: (t: string | null) => void;
}

const NONE: StoryCandidate[] = [];

/** 다음 이야기 단계: 고른 서브 미션, 없으면 진행 기준(직접 고른 것, 없으면 가장 그럴듯한 후보)과 지금 상태로. 연결 안 됐으면 story null. */
export function useNextStory(): NextStoryState {
  const data = useLiveData();
  const { live, connection } = useLive();
  const condLive = useConditionsLive(live);
  const { storyProgress } = useAddons();
  const mainKey = useMemo(() => (data ? chooseStoryKey(data, storyProgress) : null), [data, storyProgress]);
  const sides = useMemo(() => {
    if (!data) return NONE;
    const main = mainKey ? keyText(mainKey) : null;
    return sideCandidates(data).filter((c) => keyText(c.key) !== main);
  }, [data, mainKey]);
  const [picked, setFollow] = useStoryFollow(data ? gameKeyOf(data) : null);
  const side = picked ? sides.find((c) => keyText(c.key) === picked) ?? null : null;
  const key = side ? side.key : mainKey;
  const connected = connection === "connected";
  const story = useMemo(
    () => (connected && data && condLive && key ? nextStory(data, condLive, key) : null),
    [connected, data, condLive, key],
  );
  return { key, story, auto: !storyProgress, mode: side ? "side" : "main", sides, follow: side ? picked : null, setFollow };
}
