const HEADER_LEN = 16;

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
