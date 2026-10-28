import { useEffect, useMemo, useState } from "react";
import { useGame } from "@/app/GameProvider";
import { useAddons } from "@/app/AddonsProvider";
import {
  DEFAULT_SCREEN, hudKeys, snapshotCounts, type AlphaStats, type PicSize, type PictureContext, type ScreenPicture,
} from "@/core/addons/screenPictures";
import { hiddenImageMatcher } from "@/core/addons/hiddenImages";
import { pictureInfo } from "./imageStats";
import type { LogRecord } from "@/core/live/types";

/** 그림 이름 → 크기(PNG 머리에서 읽은 것, 게임 그림 저장소별). null = 읽을 수 없음 */
const sizeCaches = new WeakMap<object, Map<string, PicSize | null>>();
/** 그림 이름 → 투명도 통계(줄여 읽은 것, 게임 그림 저장소별). null = 읽을 수 없음 */
const statsCaches = new WeakMap<object, Map<string, AlphaStats | null>>();
/** 지금 읽는 중인 그림 이름(게임 그림 저장소별) */
const inflight = new WeakMap<object, Set<string>>();

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
  const { pictureRoles, spriteRoles, defaultRole, hiddenImages } = useAddons();
  const hidden = useMemo(() => hiddenImageMatcher(hiddenImages), [hiddenImages]);
  const screen = data?.screenSize ?? DEFAULT_SCREEN;
  const counts = useMemo(() => (on ? snapshotCounts(records) : null), [on, records]);
  // 보일 수 있는 그림 이름들(크기·투명도 통계를 읽는다)
  const need = useMemo(() => {
    const names = compose ? commandPictureNames(records) : new Set<string>();
    if (counts) for (const pics of counts.keys()) for (const p of pics as ScreenPicture[]) names.add(p.name);
    return [...names].sort().join("\n");
  }, [counts, compose, records]);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!assets || !need) return;
    let sizes = sizeCaches.get(assets);
    if (!sizes) { sizes = new Map(); sizeCaches.set(assets, sizes); }
    let stats = statsCaches.get(assets);
    if (!stats) { stats = new Map(); statsCaches.set(assets, stats); }
    const c = sizes, st = stats;
    let busy = inflight.get(assets);
    if (!busy) { busy = new Set(); inflight.set(assets, busy); }
    const running = busy;
    const todo = need.split("\n").filter((n) => !st.has(n) && !running.has(n));
    if (todo.length === 0) return;
    for (const n of todo) running.add(n);
    // 기록이 늘어 다시 불려도 읽던 것은 끝까지 읽는다(읽는 중인 이름은 다시 읽지 않는다). 한꺼번에 디코드하지 않게 몇 개씩.
    const queue = [...todo];
    const worker = async () => {
      for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
        try {
          // 그림 저장소에서(암호화된 그림은 풀어서) 크기·투명도 통계를 읽는다
          const info = await pictureInfo(assets, name, c.has(name) ? c.get(name) ?? null : undefined);
          c.set(name, info?.size ?? null);
          st.set(name, info?.stats ?? null);
        } catch {
          // 읽기 실패는 기억하지 않는다(다음에 다시 읽는다)
        } finally {
          running.delete(name);
        }
      }
    };
    void Promise.all([worker(), worker(), worker(), worker()]).then(() => setVersion((v) => v + 1));
  }, [assets, need]);

  return useMemo(() => {
    if (!counts && !compose) return null;
    const cache = assets ? sizeCaches.get(assets) : undefined;
    const stats = assets ? statsCaches.get(assets) : undefined;
    const sizeOf = (name: string) => cache?.get(name) ?? null;
    const statsOf = (name: string) => stats?.get(name) ?? null;
    void version; // 크기·통계를 더 읽으면 다시 만든다
    return { screen, roles: pictureRoles, spriteRoles, sizeOf, statsOf, hud: counts ? hudKeys(counts, screen, sizeOf) : null, defaultRole, hidden };
  }, [counts, compose, assets, screen, pictureRoles, spriteRoles, version, defaultRole, hidden]);
}
