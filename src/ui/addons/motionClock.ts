/** 움직임이 끝난 뒤(대사 때 모습) 다시 처음으로 돌아가기 전에 멈춰 보이는 시간(ms) */
export const MOTION_HOLD_MS = 1200;

/** 재생한 시간(elapsed, ms) → 움직임 안의 시각: end까지 가고 MOTION_HOLD_MS 멈췄다가 처음부터 되풀이 */
export function loopTime(elapsed: number, end: number): number {
  if (!Number.isFinite(elapsed) || elapsed < 0 || !Number.isFinite(end) || end <= 0) return Math.max(0, Number.isFinite(end) ? end : 0);
  return Math.min(end, elapsed % (end + MOTION_HOLD_MS));
}
