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

/** 직접 확대·축소할 때의 범위 안으로 */
export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** 이만큼(px) 넘게 움직여야 끌기로 본다(덜 움직이면 누르기 = 표시 고르기) */
export const DRAG_THRESHOLD = 4;

export function isDrag(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD;
}

/**
 * 휠 한 번의 확대 배율. 마우스 휠 한 칸(약 100px) = ×1.15, 위로 굴리면 확대.
 * deltaMode 1(줄)·2(쪽)도 px로 바꾸고, 트랙패드 핀치(ctrlKey)는 delta가 작아 더 민감하게.
 * 한 번에 ×2·÷2를 넘지 않는다.
 */
export function wheelFactor(deltaY: number, deltaMode = 0, pinch = false): number {
  const px = deltaMode === 1 ? deltaY * 33 : deltaMode === 2 ? deltaY * 800 : deltaY;
  const f = Math.pow(1.15, -px / (pinch ? 15 : 100));
  return Math.min(2, Math.max(0.5, f));
}

/**
 * 확대 크기를 바꿀 때 화면의 anchor(보이는 영역 기준 px) 아래 점이 그대로 있도록 새 스크롤 위치(한 축).
 * scroll: 지금 스크롤, from/to: 바꾸기 전·후 확대 크기.
 */
export function anchorScroll(scroll: number, anchor: number, from: number, to: number): number {
  return ((scroll + anchor) / from) * to - anchor;
}

/** 스크롤을 내용(content px)·보이는 영역(view px) 안으로(한 축). 내용이 더 작으면 0. */
export function clampScroll(scroll: number, content: number, view: number): number {
  return Math.max(0, Math.min(Math.max(0, content - view), scroll));
}

/** 두 손가락 벌리기: 시작 확대 크기·손가락 거리에서 지금 거리에 맞는 확대 크기 */
export function pinchZoom(startZoom: number, startDist: number, dist: number): number {
  if (!(startDist > 0 && dist > 0)) return clampZoom(startZoom);
  return clampZoom(startZoom * (dist / startDist));
}
