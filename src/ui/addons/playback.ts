/** 그림 움직임 재생 판단(순수 함수). 화면 컴포넌트(MotionCanvas·컷인 장면 넘기기)가 같이 쓴다. */

/** 그림 하나에서 사용자가 직접 고른 것. null = 고르지 않음(보기 설정 `그림 움직임`을 따른다) */
export type PlayChoice = "play" | "pause" | null;

/** 재생 상태(단추 모양): 직접 고른 것이 있으면 그것, 없으면 설정. 화면 밖으로 나갔다 와도 바뀌지 않는다. */
export function wantsPlay(motionOn: boolean, choice: PlayChoice): boolean {
  return choice === null ? motionOn : choice === "play";
}

/** 지금 실제로 화면에 보이는가: 스크롤 영역 안에서 보이고, 창(탭)이 숨겨지지 않았을 때 */
export function onScreenNow(intersecting: boolean, pageVisible: boolean): boolean {
  return intersecting && pageVisible;
}

/** 실제로 움직임 루프(rAF·interval)를 돌릴지: 재생 상태이고, 화면에 보이고, 그림을 다 읽었을 때 */
export function shouldAnimate({ wants, onScreen, ready = true }: { wants: boolean; onScreen: boolean; ready?: boolean }): boolean {
  return wants && onScreen && ready;
}

/** `그림 움직임` 설정값: 저장된 값이 있으면 그대로, 처음이면 기기의 `동작 줄이기`가 꺼져 있을 때만 켬 */
export function motionSetting(stored: string | null, reducedMotion: boolean): boolean {
  if (stored === "0") return false;
  if (stored === "1") return true;
  return !reducedMotion;
}
