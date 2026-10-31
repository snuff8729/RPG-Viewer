import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { useGame } from "@/app/GameProvider";
import { useLive, useLiveData } from "@/app/LiveProvider";
import { VoicePlayer } from "@/core/assets/voicePlayer";
import { VoiceFallbackCache, VoiceRecordsCache } from "@/core/live/voice";
import { ReaderVoiceContext, type VoiceMessage } from "./readerVoiceContext";
import { VoiceAutoPosition } from "./voiceAuto";

/** 선택 흐름의 수동 재생도 같은 플레이어를 쓴다. 게임·모드·갈래가 바뀌면 정리한다. */
export function ReaderVoiceProvider({ children, auto }: { children: ReactNode; auto: boolean }) {
  const { assets } = useGame();
  const data = useLiveData();
  const { records } = useLive();
  const [cache] = useState(() => new VoiceRecordsCache());
  const voices = useMemo(() => cache.get(records), [cache, records]);
  const player = useMemo(() => assets ? new VoicePlayer(assets) : null, [assets]);
  const [position] = useState(() => new VoiceAutoPosition());
  useEffect(() => () => player?.stop(), [player]);
  useEffect(() => {
    const unlock = () => player?.unlock();
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
    return () => { window.removeEventListener("pointerdown", unlock, true); window.removeEventListener("keydown", unlock, true); };
  }, [player]);
  useLayoutEffect(() => { if (!auto) player?.stop(); }, [auto, player]);
  const fallback = useMemo(() => new VoiceFallbackCache(data), [data]);
  const sounds = useCallback((item: VoiceMessage) => voices.get(item.seq) ?? item.voice ?? fallback.get(item.src, item.cmd), [voices, fallback]);
  const play = useCallback((item: VoiceMessage) => {
    position.markPlayed(); // 수동 재생을 대기하던 자동 재생이 덮어쓰지 않게 한다
    void player?.play(sounds(item));
  }, [player, sounds, position]);
  const stop = useCallback(() => player?.stop(), [player]);
  const value = useMemo(() => ({ sounds, play, stop, position }), [sounds, play, stop, position]);
  return <ReaderVoiceContext.Provider value={value}>{children}</ReaderVoiceContext.Provider>;
}
