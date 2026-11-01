import { useMemo, useState } from "react";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { livePositions, withLivePositions } from "@/core/live/positions";
import { enemyTiles } from "@/core/live/enemies";
import { withSpawnedEvents } from "@/core/live/spawned";
import { routeAvoiding, routeTo, standTiles } from "@/core/map/route";
import type { ChecklistEvent } from "@/core/live/mapChecklist";
import { blockersFor, currentEvents, mapNumbers, pagesKey, targetOf, type LiveEventEntry } from "./mapEvents";
import { useMapChecklist } from "./useMapChecklist";
import { useMapTiles } from "./useMapTiles";
import { useNextStory } from "./useNextStory";
import { storyMark } from "@/core/story/format";

/**
 * 지금 있는 맵 그림과 체크리스트(이 맵·플레이 화면 공용): 맵 타일, 지금 이벤트 그림, 지금 위치의 체크리스트 이벤트,
 * 고른 이벤트와 그곳까지 가는 길.
 */
export function useHereMap() {
  const { live } = useLive();
  const checklist = useMapChecklist();
  const { data } = useGame();
  const mapId = checklist?.mapId ?? null;
  const tilesState = useMapTiles(mapId);
  const tiles = tilesState.status === "ready" ? tilesState.tiles : null;
  // 게임이 실행 중에 만든 이벤트(EventReSpawn 등)도 원본을 복사해 넣는다(구성이 같으면 같은 객체)
  const withSpawned = data && live && live.mapId === mapId ? withSpawnedEvents(data, live) : data;
  const mapData = mapId != null ? withSpawned?.maps.get(mapId) : undefined;
  // 활성 페이지·이벤트 위치가 바뀔 때만 이벤트 그림·길막음을 다시 계산한다
  const livePages = live && live.mapId === mapId ? live.events : null;
  const pk = livePages ? pagesKey(livePages) : "";
  const [pagesFor, setPagesFor] = useState<{ pk: string; pages: LiveEventEntry[] }>({ pk: "", pages: [] });
  if (pagesFor.pk !== pk) setPagesFor({ pk, pages: livePages ?? [] });
  const current = useMemo(() => currentEvents(mapData, pagesFor.pages), [mapData, pagesFor]);
  /** 체크리스트 이벤트를 지금 위치(돌아다니는 NPC)로 */
  const listed = useMemo(
    () => (checklist ? withLivePositions(checklist.events, livePositions(pagesFor.pages)) : []),
    [checklist, pagesFor],
  );
  // 맵 데이터로 정한 고정 번호(확인해도 안 바뀐다). 맵 점과 카드·줄 제목이 같이 쓴다
  const numbers = useMemo(() => mapNumbers(listed), [listed]);
  /** 맵에서 고른 이벤트(맵이 바뀌면 풀린다) */
  const [sel, setSel] = useState<{ mapId: number; id: number } | null>(null);
  const selected = sel && sel.mapId === mapId ? sel.id : null;
  const selectedEv: ChecklistEvent | undefined = selected != null ? listed.find((e) => e.eventId === selected) : undefined;
  const px = live?.x ?? 0, py = live?.y ?? 0;
  /** 적(지금 위치)을 피해서 길 찾기 */
  const [avoidEnemies, setAvoidEnemies] = useState(true);
  const enemies = useMemo(
    () => listed.filter((e) => e.section === "enemy" && !e.story).map((e) => ({ eventId: e.eventId, x: e.x, y: e.y, chase: !!e.enemy?.chase })),
    [listed],
  );
  const found = useMemo(() => {
    if (!tiles || !selectedEv) return null;
    const stands = standTiles(targetOf(mapData, selectedEv), tiles.map, tiles.tileset);
    const blockers = blockersFor(current, selectedEv.eventId);
    const from = { x: px, y: py };
    if (!avoidEnemies) return { route: routeTo(tiles.map, tiles.tileset, from, stands, blockers), throughAvoid: false };
    return routeAvoiding(
      tiles.map, tiles.tileset, from, stands, blockers,
      enemyTiles(enemies, selectedEv.eventId, true), enemyTiles(enemies, selectedEv.eventId, false),
    );
  }, [tiles, selectedEv, mapData, current, px, py, avoidEnemies, enemies]);
  const route = found?.route ?? null;
  const select = (id: number) => { if (mapId != null) setSel({ mapId, id }); };
  /** 고른 이벤트의 길 설명: 타일을 못 읽으면 보여주지 않는다(undefined), 길이 없으면 null */
  const routeText: string | null | undefined = tiles
    ? (route ? `${route.text}${found?.throughAvoid ? " · 적을 지나가야 해요" : ""}` : null)
    : undefined;

  // 다음 스토리: 이 맵에 갈 곳이 있으면 별, 아니면 그쪽 출구(이쪽으로)와 그곳까지 가는 길
  const next = useNextStory();
  const nextStory = next.story;
  const mark = mapId != null ? storyMark(nextStory?.steps[0], mapId) : null;
  const markKey = mark ? `${mark.kind}:${mark.eventId}:${mark.x},${mark.y}` : "";
  const storyRoute = useMemo(() => {
    if (!tiles || !mark) return null;
    const cur = current.find((e) => e.id === mark.eventId);
    const pg = cur?.page ?? mapData?.events.find((e) => e?.id === mark.eventId)?.pages[0];
    const target = {
      x: cur?.x ?? mark.x, y: cur?.y ?? mark.y,
      priorityType: pg?.priorityType ?? 1, trigger: pg?.trigger ?? 0, through: pg?.through ?? false,
    };
    return routeTo(tiles.map, tiles.tileset, { x: px, y: py }, standTiles(target, tiles.map, tiles.tileset), blockersFor(current, mark.eventId));
    // mark는 markKey로 비교한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles, markKey, current, mapData, px, py]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const story = useMemo(() => (mark ? { ...mark, route: storyRoute } : null), [markKey, storyRoute]);

  return {
    live, checklist, tilesState, tiles, current, listed, numbers, selected, select, route, routeText,
    avoidEnemies, setAvoidEnemies, story, next,
  };
}

export type HereMap = ReturnType<typeof useHereMap>;
