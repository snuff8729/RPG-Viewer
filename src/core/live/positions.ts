// live.json events의 지금 위치(플러그인 1.4.0+). 예외를 던지지 않는다.

export interface LivePos { x: number; y: number; /** 바라보는 방향(2·4·6·8), 없으면 undefined */ d?: number }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
const int = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** eventId → 지금 위치. x·y가 정수가 아닌 항목(구버전 플러그인 등)은 뺀다. */
export function livePositions(events: unknown): Map<number, LivePos> {
  const out = new Map<number, LivePos>();
  try {
    if (!Array.isArray(events)) return out;
    for (const e of events) {
      if (!isObj(e) || typeof e.eventId !== "number" || !int(e.x) || !int(e.y)) continue;
      const pos: LivePos = { x: e.x, y: e.y };
      if (e.d === 2 || e.d === 4 || e.d === 6 || e.d === 8) pos.d = e.d;
      out.set(e.eventId, pos);
    }
  } catch { /* 지금까지 */ }
  return out;
}

/** 목록 항목의 x·y를 지금 위치로 바꾼 새 배열(바뀐 것만 새 객체). */
export function withLivePositions<T extends { eventId: number; x: number; y: number }>(items: readonly T[], pos: Map<number, LivePos>): T[] {
  return items.map((e) => {
    const p = pos.get(e.eventId);
    return p && (p.x !== e.x || p.y !== e.y) ? { ...e, x: p.x, y: p.y } : e;
  });
}
