/** MV/MZ 얼굴 한 칸은 원본 크기 144×144이고, index 칸은 그림 왼쪽 위부터 (index%4, floor(index/4))에 있다(늘리지 않음). */
export const FACE_CELL = 144;

/**
 * 얼굴 칸을 size×size 상자에 그리는 CSS 배경 값. 그림을 통째로 size/144배 줄여서,
 * 4×2 시트(576×288)든 얼굴 하나짜리 파일(144×144)이든 엔진과 같은 칸이 보인다.
 */
export function faceBackground(index: number, naturalWidth: number, naturalHeight: number, size = 40): { backgroundSize: string; backgroundPosition: string } {
  const i = Number.isFinite(index) && index > 0 ? Math.floor(index) : 0;
  // 한 칸(144px)이 size px이 되도록 줄인다
  return {
    backgroundSize: `${(naturalWidth * size) / FACE_CELL}px ${(naturalHeight * size) / FACE_CELL}px`,
    backgroundPosition: `${-(i % 4) * size}px ${-Math.floor(i / 4) * size}px`,
  };
}
