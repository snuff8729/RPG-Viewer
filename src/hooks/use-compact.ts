import { useSyncExternalStore } from "react";
import { PLAY_BREAKPOINT } from "@/ui/live/playLayout";
const query = `(max-width: ${PLAY_BREAKPOINT - 1}px)`;
const subscribe = (onChange: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};
export function useCompact() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}
