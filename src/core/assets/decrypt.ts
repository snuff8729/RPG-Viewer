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

const OGG = [0x4f, 0x67, 0x67, 0x53];

/** 오디오도 확장자가 아니라 내용으로 판단한다. */
export function audioType(b: Uint8Array): string | null {
  if (b.length >= 27 && startsWith(b, OGG) && b[4] === 0) return "audio/ogg";
  if (b.length >= 16 && startsWith(b, [0x66, 0x74, 0x79, 0x70], 4)) return "audio/mp4";
  return null;
}

/** Ogg 첫 페이지 CRC. 체크섬 필드는 계산할 때 0으로 본다. https://xiph.org/ogg/doc/framing.html */
function oggCrc(b: Uint8Array, end: number): number {
  let crc = 0;
  for (let i = 0; i < end; i++) {
    crc ^= (i >= 22 && i < 26 ? 0 : b[i]) << 24;
    for (let bit = 0; bit < 8; bit++) crc = (crc << 1) ^ (crc & 0x80000000 ? 0x04c11db7 : 0);
  }
  return crc >>> 0;
}

/**
 * 키 없는 Vorbis: 고정된 BOS 머리(14바이트)와 다음 페이지의 스트림 번호로 복원한다.
 * serial의 앞 2바이트는 고정값이 아니다. 다음 페이지가 없거나 CRC가 안 맞으면 조용히 포기한다.
 */
function restoreOgg(b: Uint8Array): ArrayBuffer | null {
  if (b.length < 28 || b.length < 27 + b[26]) return null;
  let next = 27 + b[26];
  for (let i = 27; i < 27 + b[26]; i++) next += b[i];
  if (next + 27 > b.length || !startsWith(b, OGG, next) || b[next + 4] !== 0) return null;
  if (b[16] !== b[next + 16] || b[17] !== b[next + 17]) return null;
  const out = b.slice();
  out.fill(0, 0, 14);
  out.set(OGG);
  out[5] = 2;
  out[14] = b[next + 14]; out[15] = b[next + 15];
  const expected = new DataView(out.buffer).getUint32(22, true);
  return oggCrc(out, next) === expected ? out.buffer : null;
}

/** RPGMV 머리 제거 + 앞 16바이트 XOR. 키가 없거나 틀리면 복구 가능한 OGG만 쓴다. */
export function decodeAudio(buf: ArrayBuffer, keyHex?: string): { bytes: ArrayBuffer; type: string } | null {
  const src = new Uint8Array(buf);
  if (!startsWith(src, RPGMV)) {
    const type = audioType(src);
    return type ? { bytes: buf, type } : null;
  }
  if (src.length < HEADER_LEN + 16) return null;
  if (keyHex && /^[\da-f]{32}$/i.test(keyHex)) {
    const bytes = decryptImage(buf, keyHex);
    const type = audioType(new Uint8Array(bytes));
    if (type) return { bytes, type };
  }
  const restored = restoreOgg(src.slice(HEADER_LEN));
  return restored ? { bytes: restored, type: "audio/ogg" } : null;
}
