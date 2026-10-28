// 플러그인 명령 줄 보이기 설정(읽기·기록·체크리스트 공용): `플러그인 명령 모두 보기`와 게임별 명령 설정(항상 보이기·숨기기).
// 저장소 오류로 예외를 던지지 않는다.
import { useCallback, useSyncExternalStore } from "react";
import { useGame } from "@/app/GameProvider";
import type { PluginOverride, PluginOverrides } from "@/core/live/pluginText";
import { gameKeyOf } from "./readPosition";

export interface DisplayStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function defaultStore(): DisplayStore | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

const SHOW_ALL_KEY = "rpgv.pluginShowAll";
export const overridesKey = (gameKey: string): string => `rpgv.pluginOverrides.${gameKey}`;

export function loadShowAll(store: DisplayStore | null = defaultStore()): boolean {
  try { return store?.getItem(SHOW_ALL_KEY) === "1"; } catch { return false; }
}

export function saveShowAll(on: boolean, store: DisplayStore | null = defaultStore()): void {
  try { store?.setItem(SHOW_ALL_KEY, on ? "1" : "0"); } catch { /* 저장소 사용 불가 */ }
}

export function loadOverrides(gameKey: string, store: DisplayStore | null = defaultStore()): PluginOverrides {
  try {
    const raw = store?.getItem(overridesKey(gameKey));
    if (!raw) return {};
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, PluginOverride> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (x === "show" || x === "hide") out[k] = x;
    return out;
  } catch { return {}; }
}

/** value null = 자동(설정 지움). 새 설정을 돌려준다. */
export function saveOverride(
  gameKey: string, name: string, value: PluginOverride | null, store: DisplayStore | null = defaultStore(),
): PluginOverrides {
  const next: Record<string, PluginOverride> = { ...loadOverrides(gameKey, store) };
  if (value === null) delete next[name];
  else next[name] = value;
  try { store?.setItem(overridesKey(gameKey), JSON.stringify(next)); } catch { /* 저장소 사용 불가 */ }
  return next;
}

// ── 화면 사이 공유(같은 값을 여러 화면이 함께 본다) ─────────────
const listeners = new Set<() => void>();
let showAll: boolean | null = null;
const overridesByGame = new Map<string, PluginOverrides>();
const EMPTY: PluginOverrides = {};

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
const notify = () => listeners.forEach(fn => fn());

function getShowAll(): boolean {
  if (showAll === null) showAll = loadShowAll();
  return showAll;
}

function getOverrides(gameKey: string | null): PluginOverrides {
  if (gameKey === null) return EMPTY;
  let v = overridesByGame.get(gameKey);
  if (!v) { v = loadOverrides(gameKey); overridesByGame.set(gameKey, v); }
  return v;
}

/** 지금 게임의 플러그인 명령 설정 */
export function usePluginOverrides(): {
  overrides: PluginOverrides; setOverride(name: string, value: PluginOverride | null): void;
} {
  const { data } = useGame();
  const gameKey = data ? gameKeyOf(data) : null;
  const overrides = useSyncExternalStore(subscribe, () => getOverrides(gameKey));
  const setOverride = useCallback((name: string, value: PluginOverride | null) => {
    if (gameKey === null || !name) return;
    overridesByGame.set(gameKey, saveOverride(gameKey, name, value));
    notify();
  }, [gameKey]);
  return { overrides, setOverride };
}

/** `플러그인 명령 모두 보기` */
export function usePluginShowAll(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, getShowAll);
  const set = useCallback((v: boolean) => {
    showAll = v;
    saveShowAll(v);
    notify();
  }, []);
  return [on, set];
}
