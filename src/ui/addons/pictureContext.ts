import { useEffect, useMemo, useState } from "react";
import { useGame } from "@/app/GameProvider";
import { useAddons } from "@/app/AddonsProvider";
import { useLive } from "@/app/LiveProvider";
import {
  DEFAULT_SCREEN, hudKeysOfTally, latestKnownScreen, liveScreenSize, type AlphaStats, type PicSize, type PictureContext,
} from "@/core/addons/screenPictures";
import { CommandNamesScan, ScreenSizeMarksScan, SnapshotScan } from "@/core/addons/pictureScans";
import { hiddenImageMatcher } from "@/core/addons/hiddenImages";
import { pictureInfo } from "./imageStats";
import type { LogRecord } from "@/core/live/types";

/** 그림 이름 → 크기(PNG 머리에서 읽은 것, 게임 그림 저장소별). null = 읽을 수 없음 */
const sizeCaches = new WeakMap<object, Map<string, PicSize | null>>();
/** 그림 이름 → 투명도 통계(줄여 읽은 것, 게임 그림 저장소별). null = 읽을 수 없음 */
const statsCaches = new WeakMap<object, Map<string, AlphaStats | null>>();
/** 지금 읽는 중인 그림 이름(게임 그림 저장소별) */
const inflight = new WeakMap<object, Set<string>>();

/**
 * 1.18.2: 게임의 실제 화면 크기 — 기록마다(sw·sh) 그때 것(sizes), 모르면 live.json의 것(liveScreen), 그것도 모르면
 * 게임 설정에서 짐작한 크기. screen = 기록에 크기가 없을 때 쓰는 것(live.json → 짐작).
 */
export function useScreenSizes(records: LogRecord[]): Pick<PictureContext, "screen" | "sizes" | "liveScreen"> {
  const { data } = useGame();
  const { live } = useLive();
  const ls = liveScreenSize(live);
  const liveW = ls?.width ?? 0, liveH = ls?.height ?? 0;
  const liveScreen = useMemo(() => (liveW > 0 && liveH > 0 ? { width: liveW, height: liveH } : null), [liveW, liveH]);
  const guessed = data?.screenSize ?? DEFAULT_SCREEN;
  const [marksScan] = useState(() => new ScreenSizeMarksScan());
  const marks = useMemo(() => marksScan.get(records), [marksScan, records]);
  // 기록이 늘어도 크기 표시가 그대로면 같은 배열(그림 구분 문맥이 기록마다 바뀌지 않게 — 읽기 이어 만들기)
  const sizes = useSameByKey(marks, useMemo(() => JSON.stringify(marks), [marks]));
  return useMemo(() => ({ screen: liveScreen ?? guessed, sizes, liveScreen }), [liveScreen, guessed, sizes]);
}

/** 내용 열쇠가 앞과 같으면 앞의 값(같은 객체)을 그대로 돌려준다. */
function useSameByKey<T>(value: T, key: string): T {
  const [kept, setKept] = useState({ key, value });
  if (kept.key !== key) {
    setKept({ key, value });
    return value;
  }
  return kept.value;
}

/**
 * 화면 그림 구분에 쓰는 것(화면 크기·직접 고른 구분·화면 장식·그림 크기)을 게임 기록 전체에서 만든다.
 * 크기가 없는 기록(플러그인 1.6.0)의 그림은 그림 파일 머리에서 크기를 읽어 채운다(읽는 동안은 크기 모름).
 * compose: 화면 그림 따라 그리기가 꺼져 있어도 그림 명령 기록으로 다시 쌓은 화면(pictureStack)용으로 만든다(화면 장식 판정 없음).
 * on도 compose도 아니면 null.
 */
export function usePictureContext(records: LogRecord[], on: boolean, compose = false): PictureContext | null {
  const { assets } = useGame();
  const { pictureRoles, spriteRoles, defaultRole, hiddenImages } = useAddons();
  const hidden = useMemo(() => hiddenImageMatcher(hiddenImages), [hiddenImages]);
  const { screen, sizes, liveScreen } = useScreenSizes(records);
  // 기록 전체를 훑는 것은 새로 붙은 기록만으로 이어 모은다(core/addons/pictureScans)
  const [scans] = useState(() => ({ snapshots: new SnapshotScan(), commands: new CommandNamesScan() }));
  const counts = useMemo(() => (on ? scans.snapshots.get(records) : null), [scans, on, records]);
  const commandNames = useMemo(() => (compose ? scans.commands.get(records) : null), [scans, compose, records]);
  // 보일 수 있는 그림 이름들(크기·투명도 통계를 읽는다)
  const need = useMemo(() => {
    const names = new Set<string>(commandNames ?? []);
    if (counts) for (const n of counts.names) names.add(n);
    return [...names].sort().join("\n");
  }, [counts, commandNames]);
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

  const lookups = useMemo(() => {
    const cache = assets ? sizeCaches.get(assets) : undefined;
    const stats = assets ? statsCaches.get(assets) : undefined;
    void version; // 크기·통계를 더 읽으면 다시 만든다
    return {
      sizeOf: (name: string) => cache?.get(name) ?? null,
      statsOf: (name: string) => stats?.get(name) ?? null,
    };
  }, [assets, version]);
  const hudScreen = latestKnownScreen({ sizes, liveScreen }) ?? screen;
  const hudNow = useMemo(() => (counts ? hudKeysOfTally(counts.tally, counts.total, hudScreen, lookups.sizeOf) : null), [counts, hudScreen, lookups]);
  // 화면 장식 판정이 그대로면 같은 집합(기록이 늘 때마다 문맥이 바뀌지 않게)
  const hud = useSameByKey(hudNow, useMemo(() => (hudNow ? [...hudNow].sort().join("\n") : "-"), [hudNow]));
  const active = !!counts || compose;

  return useMemo(() => {
    if (!active) return null;
    return {
      screen, sizes, liveScreen, roles: pictureRoles, spriteRoles, sizeOf: lookups.sizeOf, statsOf: lookups.statsOf,
      hud, defaultRole, hidden,
    };
  }, [active, screen, sizes, liveScreen, pictureRoles, spriteRoles, lookups, hud, defaultRole, hidden]);
}
