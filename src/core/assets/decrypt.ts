const HEADER_LEN = 16;

/** RPG Maker MV/MZ 암호화 파일 머리("RPGMV"). */
const RPGMV = [0x52, 0x50, 0x47, 0x4d, 0x56];

/**
 * PNG 파일의 앞 16바이트(시그니처 8바이트 + IHDR 길이·이름)는 언제나 같다.
 * 암호화는 이 16바이트만 키와 XOR 하므로, 키 없이도 이 값으로 되돌릴 수 있다.
 */
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52];

function startsWith(b: Uint8Array, sig: readonly number[], at = 0): boolean {
  if (b.length < at + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (b[at + i] !== sig[i]) return false;
  return true;
}

/** RPG Maker MV/MZ 암호화 이미지 복호화: 앞 16바이트 헤더 제거, 다음 16바이트를 키와 XOR. */
export function decryptImage(buf: ArrayBuffer, keyHex: string): ArrayBuffer {
  const src = new Uint8Array(buf);
  const out = src.slice(HEADER_LEN);
  const key: number[] = [];
  for (let i = 0; i + 1 < keyHex.length; i += 2) {
    const v = parseInt(keyHex.slice(i, i + 2), 16);
    if (!Number.isNaN(v)) key.push(v);
  }
  const n = Math.min(HEADER_LEN, key.length, out.length);
  for (let i = 0; i < n; i++) out[i] ^= key[i];
  return out.buffer;
}

/** 이미지 형식(브라우저가 그릴 수 있는 것만). 모르면 null. */
export function imageType(b: Uint8Array): string | null {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(b, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (startsWith(b, [0x42, 0x4d])) return "image/bmp";
  return null;
}

/**
 * 파일 바이트를 그릴 수 있는 이미지로. 확장자가 아니라 내용으로 판단한다.
 * - "RPGMV" 머리면 암호화 파일: 머리를 떼고 앞 16바이트를 PNG 고정 머리로 되돌린다
 *   (System.json의 키가 없거나 다르거나, 파일마다 다른 키로 암호화돼 있어도 된다).
 *   PNG가 아니게 풀리면(다른 형식을 암호화한 경우) 키로 한 번 더 풀어 본다.
 * - 아니면 이미 이미지인지 확인한다(.png가 아닌 확장자에 평문이 든 경우 포함).
 * 이미지가 아니면 null.
 */
export function decodeImage(buf: ArrayBuffer, keyHex?: string): { bytes: ArrayBuffer; type: string } | null {
  const src = new Uint8Array(buf);
  if (startsWith(src, RPGMV)) {
    if (src.length <= HEADER_LEN + PNG_HEAD.length) return null;
    if (keyHex) {
      const byKey = new Uint8Array(decryptImage(buf, keyHex));
      const t = imageType(byKey);
      if (t && t !== "image/png") return { bytes: byKey.buffer, type: t };
    }
    const out = src.slice(HEADER_LEN);
    out.set(PNG_HEAD, 0);
    return { bytes: out.buffer, type: "image/png" };
  }
  const t = imageType(src);
  return t ? { bytes: buf, type: t } : null;
}
