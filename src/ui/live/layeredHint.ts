/** 읽기의 `그림을 겹쳐 그리는 게임` 안내를 닫았는지(게임별, 브라우저에 기억). */
const keyOf = (gameKey: string) => `rpgv.hint.layeredPictures.${gameKey}`;

export function layeredHintDismissed(gameKey: string): boolean {
  try { return localStorage.getItem(keyOf(gameKey)) === "1"; } catch { return false; }
}

export function dismissLayeredHint(gameKey: string): void {
  try { localStorage.setItem(keyOf(gameKey), "1"); } catch { /* 저장소 사용 불가 */ }
}
