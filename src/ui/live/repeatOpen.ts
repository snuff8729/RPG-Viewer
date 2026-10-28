/**
 * 펼친 `↻ 같은 대화 다시 봄` 묶음(항목 key = 처음 접힌 대화의 첫 대사 seq). 새 기록이 와서 항목이 다시 만들어지거나
 * 읽기 구간 밖으로 나갔다 돌아와도 펼친 채로 둔다(이 창에서만, 저장하지 않는다).
 */
const open = new Set<string>();

export function isRepeatOpen(key: string): boolean {
  return open.has(key);
}

export function setRepeatOpen(key: string, on: boolean): void {
  if (on) open.add(key);
  else open.delete(key);
}
