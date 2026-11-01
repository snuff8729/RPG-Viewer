import { useCallback, useSyncExternalStore } from "react";
import type { ChecklistEvent, Section } from "@/core/live/mapChecklist";
import { UNKNOWN_SPAWN_TITLE } from "@/core/live/spawned";

/**
 * 맵 범례 항목: 구역 8개, 이야기·자동 진행(목록만, storyEvents), 내 위치, 다음 스토리 표시, 알 수 없는 생성 이벤트, 적 나오는 구역.
 * 범례에서 끄면 맵 표시와 이 맵·플레이 화면 목록의 같은 줄이 숨는다.
 */
export type LegendKey = Section | "storyEvents" | "player" | "story" | "spawn" | "regions";
export const LEGEND_KEYS: readonly LegendKey[] = [
  "now", "item", "repeat", "exit", "enemy", "talk", "done", "locked", "storyEvents", "player", "story", "spawn", "regions",
];
/** 처음에 꺼져 있는 것(잠김은 예전 `잠긴 것도 표시` 스위치처럼 기본 꺼짐) */
const DEFAULT_HIDDEN: readonly LegendKey[] = ["locked"];
const isLegendKey = (v: unknown): v is LegendKey => typeof v === "string" && (LEGEND_KEYS as readonly string[]).includes(v);

/** 이벤트가 속한 범례 항목. 이야기·자동 진행(맵에 그리지 않는다)은 null. */
export function legendKeyOf(e: Pick<ChecklistEvent, "section" | "story" | "title">): LegendKey | null {
  if (!e || e.story) return null;
  if (e.title === UNKNOWN_SPAWN_TITLE) return "spawn";
  return e.section;
}

/** 범례에서 끈 항목의 이벤트를 뺀다(이야기·자동 진행은 storyEvents를 끄면 뺀다). 같으면 같은 배열. */
export function visibleByLegend<T extends Pick<ChecklistEvent, "section" | "story" | "title">>(events: readonly T[], hidden: ReadonlySet<LegendKey>): T[] {
  const list = Array.isArray(events) ? events : [];
  if (hidden.size === 0) return list as T[];
  const out = list.filter((e) => {
    const k = legendKeyOf(e);
    return k === null ? !(e?.story && hidden.has("storyEvents")) : !hidden.has(k);
  });
  return out.length === list.length ? (list as T[]) : out;
}

/** 저장된 글 → 끈 항목. 없거나 깨졌으면 기본값. */
export function parseLegendHidden(text: string | null | undefined): Set<LegendKey> {
  if (typeof text !== "string") return new Set(DEFAULT_HIDDEN);
  try {
    const v: unknown = JSON.parse(text);
    if (!Array.isArray(v)) return new Set(DEFAULT_HIDDEN);
    return new Set(v.filter(isLegendKey));
  } catch {
    return new Set(DEFAULT_HIDDEN);
  }
}

const storageKey = (gameKey: string) => `rpgv.mapLegend.${gameKey}`;
const listeners = new Set<() => void>();
const cache = new Map<string, Set<LegendKey>>();

function load(gameKey: string): Set<LegendKey> {
  let text: string | null = null;
  try { text = localStorage.getItem(storageKey(gameKey)); } catch { /* 저장소 사용 불가 */ }
  return parseLegendHidden(text);
}
function get(gameKey: string): Set<LegendKey> {
  let v = cache.get(gameKey);
  if (!v) { v = load(gameKey); cache.set(gameKey, v); }
  return v;
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * 게임별 범례에서 끈 항목(브라우저에 기억, 맵·목록이 함께 쓴다).
 * 돌려주는 setShown(key, on)은 클릭 핸들러에서 부른다.
 */
export function useMapLegend(gameKey: string): [ReadonlySet<LegendKey>, (key: LegendKey, on: boolean) => void, (visible: LegendKey[]) => void] {
  const hidden = useSyncExternalStore(subscribe, () => get(gameKey));
  const save = useCallback((next: Set<LegendKey>) => {
    cache.set(gameKey, next);
    try { localStorage.setItem(storageKey(gameKey), JSON.stringify([...next])); } catch { /* 저장소 사용 불가 */ }
    listeners.forEach((fn) => fn());
  }, [gameKey]);
  const setShown = useCallback((key: LegendKey, on: boolean) => {
    const next = new Set(get(gameKey));
    if (on) next.delete(key); else next.add(key);
    save(next);
  }, [gameKey, save]);
  /** 보이는 항목 목록으로 정한다(목록에 없는 것은 끈다) */
  const setVisible = useCallback((visible: LegendKey[]) => {
    const on = new Set(visible);
    save(new Set(LEGEND_KEYS.filter((k) => !on.has(k))));
  }, [save]);
  return [hidden, setShown, setVisible];
}
