// 가린 사본의 토큰: 원래 글 조각의 53비트 해시(cyrb53) → `T_` + 16진수 14자리.
// 저장하는 사전이 없다 — 같은 글이면 어디서나 같은 토큰이고, 되돌릴 때는 원래 게임에서 다시 계산한다.

/** cyrb53 (공개 도메인 해시). 브라우저·Node 모두 동기로 돈다. */
export function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export const TOKEN_HEX_LENGTH = 14;
/** 글 속 토큰(전역 검색용) */
export const TOKEN_PATTERN = /T_[0-9a-f]{14}/g;

/** 글 조각 → 토큰 */
export function tokenOf(text: string): string {
  return "T_" + cyrb53(text).toString(16).padStart(TOKEN_HEX_LENGTH, "0");
}

export function isToken(s: string): boolean {
  return /^T_[0-9a-f]{14}$/.test(s);
}
