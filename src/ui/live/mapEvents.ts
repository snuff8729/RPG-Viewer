import type { ChecklistEvent } from "@/core/live/mapChecklist";
import type { EventPage, MapData } from "@/core/types";
import { legendKeyOf, type LegendKey } from "./mapLegendState";

/**
 * 지금 맵에 실제로 나와 있는 이벤트(활성 페이지가 있는 것)와 그 페이지.
 * 위치는 live.json의 지금 위치(플러그인 1.4.0+), 없으면 맵 데이터의 처음 위치. d: 지금 바라보는 방향(있으면).
 * mobile: 돌아다니거나(자율 이동 무작위·다가옴·사용자 정의) 처음 위치에서 옮겨진 것 — 바탕 그림이 아니라 위 캔버스에 그린다.
 */
export interface CurrentEvent { id: number; x: number; y: number; d?: number; mobile: boolean; page: EventPage }
export interface LiveEventEntry { eventId: number; page: number; x?: number; y?: number; d?: number }

const posOk = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** live.events → "id:page@x,y,d,…" (활성 페이지·위치가 바뀔 때만 다시 계산하도록 비교용 키). */
export function pagesKey(pages: readonly LiveEventEntry[]): string {
  return pages.map((p) => `${p.eventId}:${p.page}${posOk(p.x) && posOk(p.y) ? `@${p.x},${p.y},${p.d ?? ""}` : ""}`).join(",");
}

export function currentEvents(map: MapData | undefined, pages: readonly LiveEventEntry[]): CurrentEvent[] {
  if (!map) return [];
  const out: CurrentEvent[] = [];
  for (const { eventId, page, x, y, d } of pages) {
    const ev = map.events[eventId];
    const pg = page >= 0 ? ev?.pages[page] : undefined;
    if (!ev || !pg) continue;
    const live = posOk(x) && posOk(y);
    const cx = live ? x : ev.x, cy = live ? y : ev.y;
    const mt = pg.moveType ?? 0;
    const item: CurrentEvent = { id: ev.id, x: cx, y: cy, mobile: mt === 1 || mt === 2 || mt === 3 || cx !== ev.x || cy !== ev.y, page: pg };
    if (d === 2 || d === 4 || d === 6 || d === 8) item.d = d;
    out.push(item);
  }
  return out;
}

/** 바탕 캔버스에 그릴(움직이지 않는) 이벤트를 다시 그릴지 판단하는 키 */
export function staticKey(events: readonly CurrentEvent[]): string {
  return events.filter((e) => !e.mobile).map((e) => `${e.id}:${e.x},${e.y}`).join(",")
    + "|" + events.filter((e) => e.mobile).map((e) => e.id).join(",");
}

/** 길을 막는 다른 이벤트("x,y", 지금 위치): 활성 페이지가 캐릭터와 같은 우선순위이고 통과가 아닌 것. 대상은 뺀다. */
export function blockersFor(events: readonly CurrentEvent[], targetId: number): Set<string> {
  const out = new Set<string>();
  for (const e of events) {
    if (e.id === targetId) continue;
    if ((e.page.priorityType ?? 1) === 1 && !e.page.through) out.add(`${e.x},${e.y}`);
  }
  return out;
}

/**
 * 길찾기 대상의 위치·우선순위·트리거. 위치는 ev.x·y(목록을 지금 위치로 바꿔 넘기면 지금 위치).
 * 활성 페이지가 있으면 그 페이지, 없으면(잠김) 첫 잠긴 페이지를 쓴다.
 */
export function targetOf(map: MapData | undefined, ev: ChecklistEvent): { x: number; y: number; priorityType: number; trigger: number; through: boolean } {
  const pages = map?.events[ev.eventId]?.pages ?? [];
  const pg = pages[ev.activePage] ?? pages[ev.locked[0]?.page ?? -1];
  return { x: ev.x, y: ev.y, priorityType: pg?.priorityType ?? 1, trigger: pg?.trigger ?? 0, through: pg?.through ?? false };
}

/**
 * 맵에 표시를 그릴 이벤트: 안 본 내용·아이템·반복·출구·다 봄 (다시 가능)·다 봄(흐리게), 그리고 showLocked일 때 잠김.
 * 이야기·자동 진행은 그리지 않는다.
 */
export function mapMarkers(listed: readonly ChecklistEvent[], show: boolean | ReadonlySet<LegendKey>): ChecklistEvent[] {
  if (typeof show === "boolean") return listed.filter((e) => !e.story && (e.section !== "locked" || show));
  // 범례에서 끈 항목(잠김은 기본 꺼짐)은 그리지 않는다
  return listed.filter((e) => { const k = legendKeyOf(e); return k !== null && !show.has(k); });
}

/** eventId → 맵 번호(core가 맵 데이터로 정한 고정 번호, 이야기·자동 진행 제외) */
export function mapNumbers(listed: readonly ChecklistEvent[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const e of listed) if (!e.story && e.number != null) out.set(e.eventId, e.number);
  return out;
}

/** 이벤트 그림의 불투명도(0~255)·합성 방법(0 보통, 1 더하기, 2 곱하기, 3 스크린). */
export interface SpriteEffect { opacity: number; blendMode: number }

/**
 * 활성 페이지가 자기 자신에게 거는 이동 경로의 불투명도 변경(42)·합성 방법 변경(43).
 * 페이지 자율 이동 경로 → 페이지 명령의 이동 경로 설정(205, 대상 0 = 이 이벤트 또는 자기 id) 순으로, 뒤의 것이 이긴다.
 * 대상 -1은 플레이어라 쓰지 않는다. 데이터에 없으면 기본값(255, 0).
 */
export function spriteEffect(page: EventPage, eventId: number): SpriteEffect {
  const out: SpriteEffect = { opacity: 255, blendMode: 0 };
  const apply = (route: unknown) => {
    const list = route && typeof route === "object" ? (route as { list?: unknown }).list : undefined;
    if (!Array.isArray(list)) return;
    for (const cmd of list as ({ code?: unknown; parameters?: unknown[] } | null)[]) {
      const v = cmd?.parameters?.[0];
      if (!cmd || typeof v !== "number" || !Number.isFinite(v)) continue;
      if (cmd.code === 42) out.opacity = Math.min(255, Math.max(0, v));
      else if (cmd.code === 43 && v >= 0 && v <= 3) out.blendMode = Math.floor(v);
    }
  };
  apply(page.moveRoute);
  for (const cmd of Array.isArray(page.list) ? page.list : []) {
    if (cmd?.code !== 205) continue;
    const target = cmd.parameters?.[0];
    if (target === 0 || target === eventId) apply(cmd.parameters?.[1]);
  }
  return out;
}
