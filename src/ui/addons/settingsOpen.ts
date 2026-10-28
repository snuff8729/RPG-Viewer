import { useSyncExternalStore } from "react";

/** `게임 설정` Sheet가 열려 있는가 — 다른 화면(읽기 안내 등)에서도 열 수 있게 함께 쓴다. */
const listeners = new Set<() => void>();
let open = false;

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
const get = () => open;

export function setGameSettingsOpen(v: boolean): void {
  if (open === v) return;
  open = v;
  listeners.forEach((fn) => fn());
}

export function useGameSettingsOpen(): [boolean, (v: boolean) => void] {
  return [useSyncExternalStore(subscribe, get), setGameSettingsOpen];
}
