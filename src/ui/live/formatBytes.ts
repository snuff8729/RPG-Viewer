/** 기록 파일 크기 표시: KB(반올림해 1024.0KB가 되면 MB), 한 자리 소수. */
export function formatBytes(bytes: number): string {
  const b = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  const kb = (b / 1024).toFixed(1);
  if (Number(kb) < 1024) return `${kb}KB`;
  return `${(b / (1024 * 1024)).toFixed(1)}MB`;
}
