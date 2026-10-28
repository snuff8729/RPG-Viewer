import { useEffect, useMemo, useState } from "react";
import { useGame } from "@/app/GameProvider";
import { useAddons } from "@/app/AddonsProvider";
import {
  DEFAULT_SCREEN, hudKeys, pngSize, snapshotCounts, type PicSize, type PictureContext, type ScreenPicture,
} from "@/core/addons/screenPictures";
import type { LogRecord } from "@/core/live/types";

/** 그림 이름 → 크기(PNG 머리에서 읽은 것, 게임 그림 저장소별). null = 읽을 수 없음 */
const sizeCaches = new WeakMap<object, Map<string, PicSize | null>>();

/**
 * 화면 그림 구분에 쓰는 것(화면 크기·직접 고른 구분·화면 장식·그림 크기)을 게임 기록 전체에서 만든다.
 * 크기가 없는 기록(플러그인 1.6.0)의 그림은 그림 파일 머리에서 크기를 읽어 채운다(읽는 동안은 크기 모름).
 * on이 아니면 null.
 */
export function usePictureContext(records: LogRecord[], on: boolean): PictureContext | null {
  const { data, assets } = useGame();
  const { pictureRoles, spriteRoles } = useAddons();
  const screen = data?.screenSize ?? DEFAULT_SCREEN;
  const counts = useMemo(() => (on ? snapshotCounts(records) : null), [on, records]);
  // 크기가 기록에 없는 그림 이름들
  const need = useMemo(() => {
    if (!counts) return "";
    const names = new Set<string>();
    for (const pics of counts.keys()) for (const p of pics as ScreenPicture[]) if (!p.w || !p.h) names.add(p.name);
    return [...names].sort().join("\n");
  }, [counts]);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!assets || !need) return;
    let cache = sizeCaches.get(assets);
    if (!cache) { cache = new Map(); sizeCaches.set(assets, cache); }
    const c = cache;
    const todo = need.split("\n").filter((n) => !c.has(n));
    if (todo.length === 0) return;
    let cancelled = false;
    void Promise.all(todo.map(async (name) => {
      try {
        const blob = await assets.load("pictures", name);
        const head = blob ? new Uint8Array(await blob.slice(0, 24).arrayBuffer()) : null;
        c.set(name, pngSize(head));
      } catch {
        // 읽기 실패는 기억하지 않는다(다음에 다시 읽는다)
      }
    })).then(() => { if (!cancelled) setVersion((v) => v + 1); });
    return () => { cancelled = true; };
  }, [assets, need]);

  return useMemo(() => {
    if (!counts) return null;
    const cache = assets ? sizeCaches.get(assets) : undefined;
    const sizeOf = (name: string) => cache?.get(name) ?? null;
    void version; // 크기를 더 읽으면 다시 만든다
    return { screen, roles: pictureRoles, spriteRoles, sizeOf, hud: hudKeys(counts, screen, sizeOf) };
  }, [counts, assets, screen, pictureRoles, spriteRoles, version]);
}
