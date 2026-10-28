import { useEffect, useMemo, useState } from "react";
import { useGame } from "@/app/GameProvider";
import { useAddons } from "@/app/AddonsProvider";
import {
  DEFAULT_SCREEN, hudKeys, pngSize, snapshotCounts, type PicSize, type PictureContext, type ScreenPicture,
} from "@/core/addons/screenPictures";
import type { LogRecord } from "@/core/live/types";

/** 그림 이름 → 크기(PNG 머리에서 읽은 것, 게임 그림 저장소별). null = 읽을 수 없음 */
const sizeCaches = new WeakMap<object, Map<string, PicSize | null>>();

/** 기록의 그림 표시(231) 이름들(그림 명령으로 다시 쌓는 화면용) */
function commandPictureNames(records: LogRecord[]): Set<string> {
  const names = new Set<string>();
  for (const r of records) if (r?.type === "picture" && r.op === undefined && typeof r.name === "string" && r.name) names.add(r.name);
  return names;
}

/**
 * 화면 그림 구분에 쓰는 것(화면 크기·직접 고른 구분·화면 장식·그림 크기)을 게임 기록 전체에서 만든다.
 * 크기가 없는 기록(플러그인 1.6.0)의 그림은 그림 파일 머리에서 크기를 읽어 채운다(읽는 동안은 크기 모름).
 * compose: 화면 그림 따라 그리기가 꺼져 있어도 그림 명령 기록으로 다시 쌓은 화면(pictureStack)용으로 만든다(화면 장식 판정 없음).
 * on도 compose도 아니면 null.
 */
export function usePictureContext(records: LogRecord[], on: boolean, compose = false): PictureContext | null {
  const { data, assets } = useGame();
  const { pictureRoles, spriteRoles, defaultRole } = useAddons();
  const screen = data?.screenSize ?? DEFAULT_SCREEN;
  const counts = useMemo(() => (on ? snapshotCounts(records) : null), [on, records]);
  // 크기가 기록에 없는 그림 이름들
  const need = useMemo(() => {
    const names = compose ? commandPictureNames(records) : new Set<string>();
    if (counts) for (const pics of counts.keys()) for (const p of pics as ScreenPicture[]) if (!p.w || !p.h) names.add(p.name);
    return [...names].sort().join("\n");
  }, [counts, compose, records]);
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
    if (!counts && !compose) return null;
    const cache = assets ? sizeCaches.get(assets) : undefined;
    const sizeOf = (name: string) => cache?.get(name) ?? null;
    void version; // 크기를 더 읽으면 다시 만든다
    return { screen, roles: pictureRoles, spriteRoles, sizeOf, hud: counts ? hudKeys(counts, screen, sizeOf) : null, defaultRole };
  }, [counts, compose, assets, screen, pictureRoles, spriteRoles, version, defaultRole]);
}
