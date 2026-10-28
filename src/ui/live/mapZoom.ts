/** 맵 화면 확대 범위(화면 px/칸) */
export const MIN_ZOOM = 2;
export const MAX_ZOOM = 96;

/**
 * 맵 전체(w×h칸)가 보이는 영역(cw×ch px)에 다 들어가는 확대 크기(`맞춤`).
 * 영역이 아직 0 크기(레이아웃 전·숨김)거나 맵 크기가 이상하면 null.
 */
export function fitZoom(cw: number, ch: number, w: number, h: number): number | null {
  if (!(cw > 0 && ch > 0 && w > 0 && h > 0)) return null;
  return Math.min(MAX_ZOOM, Math.max(1, Math.min(cw / w, ch / h)));
}
