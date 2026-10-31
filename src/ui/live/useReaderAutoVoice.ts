import { useEffect, useMemo, type RefObject } from "react";
import type { ReaderItem } from "@/core/live/reader";
import { readerNodeAtTop } from "./readPosition";
import { useReaderVoice, type VoiceMessage } from "./readerVoiceContext";
import { shouldAutoPlayVoice, VOICE_SETTLE_MS } from "./voiceAuto";

/** 화면 맨 위의 실제 줄을 읽기 위치로 삼는다. 빠른 스크롤은 타이머를 계속 미룬다. */
export function useReaderAutoVoice(scroller: RefObject<HTMLDivElement | null>, items: readonly ReaderItem[], enabled: boolean, hidden: (it: ReaderItem) => boolean): void {
  const voice = useReaderVoice();
  const stop = voice.stop;
  const messages = useMemo(() => {
    const out = new Map<string, VoiceMessage>();
    const visit = (list: readonly ReaderItem[]) => {
      for (const item of list) {
        if (item.kind === "hidden" || hidden(item)) continue;
        if (item.kind === "battle") visit(item.items);
        if (item.kind === "message") {
          if (item.repeat === undefined) out.set(item.key, item);
          else if (item.occurrences) item.occurrences.forEach(visit);
        }
      }
    };
    visit(items);
    return out;
  }, [items, hidden]);
  // 기록만 더 붙었으면 같은 줄을 다시 재생하지 않는다. 늦게 도착한 음성은 아직 안 틀었을 때만.
  useEffect(() => () => stop(), [stop]);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    const settle = () => {
      const node = readerNodeAtTop(el, "[data-reader-line]");
      const key = node?.dataset.readerLine ?? null;
      if (voice.position.observe(key)) { voice.stop(); schedule(); return; }
      const item = key ? messages.get(key) : undefined;
      if (shouldAutoPlayVoice({ enabled, key, lastPlayed: voice.position.lastPlayed(), hidden: !item, hasVoice: !!item && voice.sounds(item).length > 0,
        now: Date.now(), settledSince: voice.position.settledSince() })) voice.play(item!);
    };
    const schedule = (scrolling = false) => {
      clearTimeout(timer);
      const key = readerNodeAtTop(el, "[data-reader-line]")?.dataset.readerLine ?? null;
      if (voice.position.observe(key, Date.now(), scrolling) || !key || !messages.has(key)) voice.stop();
      timer = setTimeout(settle, Math.max(0, VOICE_SETTLE_MS - (Date.now() - voice.position.settledSince())));
    };
    schedule();
    const onScroll = () => schedule(true);
    el.addEventListener("scroll", onScroll, { passive: true });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => schedule());
    resize?.observe(el);
    if (el.firstElementChild) resize?.observe(el.firstElementChild);
    const mutation = new MutationObserver(() => schedule());
    mutation.observe(el, { childList: true, subtree: true });
    return () => { clearTimeout(timer); el.removeEventListener("scroll", onScroll); resize?.disconnect(); mutation.disconnect(); };
  }, [scroller, messages, enabled, voice]);
}
