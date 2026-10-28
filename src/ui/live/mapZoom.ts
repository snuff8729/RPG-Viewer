/** 맵 화면 확대 범위(화면 px/칸) */
export const MIN_ZOOM = 2;
export const MAX_ZOOM = 96;

/**
 * 맵 전체(w×h칸)가 보이는 영역(cw×ch px)에 다 들어가는 확대 크기(`맞춤`).
 * 영역이 아직 0 크기(레이아웃 전·숨김)거나 맵 크기가 이상하면 null.
 */
export function fitZoom(cw: number, ch: number, w: number, h: number): number | null {
  if (!(cw > 0 && ch > 0 && w > 0 && h > 0)) return null;
  // 1/64 단위로 내림: 맞춘 맵이 영역보다 조금이라도 커져 스크롤 막대가 생겼다 없어지며 떨리지 않게
  const z = Math.floor(Math.min(cw / w, ch / h) * FIT_STEPS) / FIT_STEPS;
  return Math.min(MAX_ZOOM, Math.max(1, z));
}
const FIT_STEPS = 64;

/**
 * 스크롤을 (left, top)으로 옮길 때 실제로 바꿀 값(정수 px). 지금과 1px 안쪽이면 null(같은 입력이 반복돼도 움직이지 않게).
 */
export function scrollChange(curLeft: number, curTop: number, left: number, top: number): { left: number; top: number } | null {
  const l = Math.round(left), t = Math.round(top);
  if (!Number.isFinite(l) || !Number.isFinite(t)) return null;
  return Math.abs(l - curLeft) < 1 && Math.abs(t - curTop) < 1 ? null : { left: l, top: t };
}

/** 보이는 영역이 이만큼(px) 넘게 바뀌어야 다시 맞춘다(반올림·하위 픽셀 차이로 계속 다시 맞추지 않게) */
export const RESIZE_SLACK = 2;

/**
 * 보이는 영역 크기가 last(마지막으로 맞춘 크기)에서 (w, h)로 바뀌었을 때 다시 맞출지.
 * 처음(last 없음)이면 맞춘다. 0 크기는 맞추지 않는다.
 */
export function shouldRefit(last: { w: number; h: number } | null, w: number, h: number): boolean {
  if (!(w > 0 && h > 0)) return false;
  if (!last) return true;
  return Math.abs(w - last.w) >= RESIZE_SLACK || Math.abs(h - last.h) >= RESIZE_SLACK;
}

/**
 * 내 위치 따라가기(작은 맵): 내 위치(cx, cy px)가 보이는 영역 안쪽 여백 밖으로 나갔으면 새 스크롤(정수 px), 아니면 null.
 * 여백은 영역의 1/4과 2칸 중 작은 것. 스크롤할 곳이 없으면 null.
 */
export function followScroll(
  cx: number, cy: number, view: { left: number; top: number; width: number; height: number; scrollWidth: number; scrollHeight: number }, zoom: number,
): { left: number; top: number } | null {
  const scrollable = view.scrollWidth > view.width || view.scrollHeight > view.height;
  if (!scrollable) return null;
  const mx = Math.min(view.width / 4, 2 * zoom), my = Math.min(view.height / 4, 2 * zoom);
  const inside = cx >= view.left + mx && cx <= view.left + view.width - mx && cy >= view.top + my && cy <= view.top + view.height - my;
  if (inside) return null;
  return {
    left: Math.round(clampScroll(cx - view.width / 2, view.scrollWidth, view.width)),
    top: Math.round(clampScroll(cy - view.height / 2, view.scrollHeight, view.height)),
  };
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
