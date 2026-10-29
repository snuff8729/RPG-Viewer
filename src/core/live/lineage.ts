/**
 * 덧붙이기만 하는 배열의 줄기 표시. 같은 줄기 표시가 붙은 두 배열은 짧은 쪽이 긴 쪽의 앞부분이다(만든 쪽이 약속한다).
 * 이어 계산(새로 붙은 것만 처리)하는 캐시가 앞부분 전체를 비교하지 않고 이것으로 판단한다.
 * 배열을 붙잡지 않는다(WeakMap). 예외를 던지지 않는다.
 */
const tags = new WeakMap<object, number>();
let nextId = 1;

/** 새 줄기 번호(앞의 배열과 이어지지 않는 새 시작) */
export function newLineage(): number {
  return nextId++;
}

/** arr에 줄기 표시를 붙여 그대로 돌려준다. 같은 줄기의 앞 배열들은 모두 arr의 앞부분이어야 한다. */
export function tagLineage<T extends readonly unknown[]>(arr: T, id: number): T {
  try { if (Array.isArray(arr)) tags.set(arr, id); } catch { /* 표시 없음 = 이어 쓰지 않음 */ }
  return arr;
}

/** next가 prev에 덧붙이기만 한 배열인가(같은 배열 포함). 모르면 false(처음부터 계산하면 된다). */
export function extendsArray(prev: readonly unknown[] | null | undefined, next: readonly unknown[] | null | undefined): boolean {
  if (!prev || !next) return false;
  if (prev === next) return true;
  try {
    const a = tags.get(prev);
    return a !== undefined && a === tags.get(next) && prev.length <= next.length;
  } catch {
    return false;
  }
}
