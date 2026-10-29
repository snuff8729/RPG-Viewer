import { useMemo } from "react";
import { useAddons } from "@/app/AddonsProvider";
import { useLive, useLiveData } from "@/app/LiveProvider";
import { nextStory, type NextStory } from "@/core/story/nextStep";
import { chooseStoryKey, type StoryKey } from "@/core/story/progress";
import { useConditionsLive } from "./useConditionsLive";

/** 다음 이야기 단계: 진행 기준(직접 고른 것, 없으면 가장 그럴듯한 후보)과 지금 상태로. 연결 안 됐으면 story null. */
export function useNextStory(): { key: StoryKey | null; story: NextStory | null; auto: boolean } {
  const data = useLiveData();
  const { live, connection } = useLive();
  const condLive = useConditionsLive(live);
  const { storyProgress } = useAddons();
  const key = useMemo(() => (data ? chooseStoryKey(data, storyProgress) : null), [data, storyProgress]);
  const connected = connection === "connected";
  const story = useMemo(
    () => (connected && data && condLive && key ? nextStory(data, condLive, key) : null),
    [connected, data, condLive, key],
  );
  return { key, story, auto: !storyProgress };
}
