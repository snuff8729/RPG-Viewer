import { decodeImage } from "./decrypt";

/** 크기를 알아내는 데 필요한 파일 앞부분 바이트 수(암호화 머리 16 + PNG 머리·IHDR 24, 넉넉히) */
export const IMAGE_HEAD_BYTES = 64;

/**
 * 파일 앞부분만으로 PNG 그림 크기를 읽는다(평문 .png와 암호화 .rpgmvp/.png_ 모두). 픽셀은 읽지 않는다.
 * PNG가 아니거나 머리가 모자라면 null. 던지지 않는다.
 */
export function pngHeaderSize(head: Uint8Array): { width: number; height: number } | null {
  try {
    const copy = head.slice(0, Math.min(head.length, IMAGE_HEAD_BYTES));
    const decoded = decodeImage(copy.buffer);
    if (!decoded || decoded.type !== "image/png") return null;
    const b = new Uint8Array(decoded.bytes);
    if (b.length < 24) return null;
    // IHDR 이름(12..15)이 맞는지 확인
    if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null;
    const dv = new DataView(decoded.bytes);
    const width = dv.getUint32(16), height = dv.getUint32(20);
    return width > 0 && height > 0 ? { width, height } : null;
  } catch {
    return null;
  }
}
