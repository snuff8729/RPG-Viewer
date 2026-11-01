/**
 * 맵 목록의 "다른 맵"에서 찾아보기 › 못 본 것을 그 맵으로 거른 상태로 열 때 넘기는 검색어.
 * 못 본 것 화면이 처음 그려질 때 한 번 읽고 지운다.
 */
let pending = "";

/** 찾아보기 › 못 본 것을 이 검색어(맵 이름)로 연다 */
export function openMissingFor(query: string): void {
  pending = query;
  window.location.hash = "#/browse/missing";
}

/** 넘겨받은 검색어(없으면 빈 글) */
export const peekMissingQuery = (): string => pending;

/** 넘겨받은 검색어를 다 썼다 */
export function clearMissingQuery(): void {
  pending = "";
}
