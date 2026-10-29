/**
 * 플레이 화면 전체를 따로 띄운 작은 창(예전 방식). 주소의 `?popup=<최근 게임 key>`로 알아보고, 그 게임을 자동으로 다시 연다.
 * PC는 이제 기능 하나씩 떼어 낸다(popout.ts `?module=`). 이 주소는 예전 링크·휴대폰 너비 메뉴를 위해 그대로 둔다.
 */

/** window.open 창 이름(같은 창을 다시 쓴다) */
export const PLAY_WINDOW_NAME = "rpgv-play";
/** 게임 창 옆에 둘 만한 크기 */
export const PLAY_WINDOW_FEATURES = "popup,width=560,height=900";

/** 따로 띄운 창이면 다시 열 게임 key(모르면 ""), 아니면 null. */
export function popupGameKey(search: string): string | null {
  return new URLSearchParams(search).get("popup");
}

/** 플레이 화면만 띄울 주소 */
export function playPopupUrl(pathname: string, gameKey: string | undefined): string {
  return `${pathname}?${new URLSearchParams({ popup: gameKey ?? "" }).toString()}#/play`;
}
