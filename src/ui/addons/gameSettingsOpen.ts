import { useEffect, useState } from "react";

const EVENT = "rpgv:open-game-settings";

/** 어디서든 `게임 설정` Sheet를 연다(그 화면에 Sheet가 있을 때). */
export function openGameSettings(): void {
  try { window.dispatchEvent(new Event(EVENT)); } catch { /* 없음 */ }
}

/** `게임 설정` Sheet 열림 상태: openGameSettings()로도 열린다. */
export function useGameSettingsOpen(): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return [open, setOpen];
}
