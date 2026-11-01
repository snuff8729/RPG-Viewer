/** 맨 아래로 보는 거리(px) */
export const NEAR_BOTTOM = 80;

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** 지금 위치가 맨 아래 근처인가(높이 0인 숨긴 영역도 맨 아래). */
export function isNearBottom(m: ScrollMetrics): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight <= NEAR_BOTTOM;
}

/**
 * 스크롤 이벤트 뒤에도 맨 아래에 붙어 있는가.
 * 스크롤 이벤트는 다음 프레임에 늦게 오므로, 맨 아래로 붙인 뒤 그 사이 내용이 늘면(그림 로딩·카드가 생김 등)
 * 이벤트 때 재면 맨 아래가 아닌 것처럼 보인다. 사용자가 위로 올리지 않았으면(위치가 줄지 않았으면) 붙은 채로 둔다.
 * prevTop은 직전에 알던 위치(이 이벤트 전에 우리가 맞춘 위치 포함).
 */
export function stillAtBottom(wasAtBottom: boolean, prevTop: number, m: ScrollMetrics): boolean {
  if (isNearBottom(m)) return true;
  return wasAtBottom && m.scrollTop >= prevTop - 1;
}
