/** Synthetic Ogg pages: no game audio needed. The first serial is deliberately nonzero. */
export function oggFixture(): Uint8Array {
  const page = (sequence: number, payload: number[]) => {
    const b = new Uint8Array(28 + payload.length);
    b.set([79, 103, 103, 83, 0, sequence === 0 ? 2 : 4]);
    const v = new DataView(b.buffer);
    v.setUint32(14, 0x1234abcd, true);
    v.setUint32(18, sequence, true);
    b[26] = 1; b[27] = payload.length; b.set(payload, 28);
    let crc = 0;
    for (const byte of b) {
      crc ^= byte << 24;
      for (let j = 0; j < 8; j++) crc = (crc << 1) ^ (crc & 0x80000000 ? 0x04c11db7 : 0);
    }
    v.setUint32(22, crc >>> 0, true);
    return b;
  };
  const first = page(0, [1, 118, 111, 114, 98, 105, 115, ...Array<number>(23).fill(0)]);
  const second = page(1, [3, 118, 111, 114, 98, 105, 115]);
  const all = new Uint8Array(first.length + second.length);
  all.set(first); all.set(second, first.length);
  return all;
}
export const AUDIO_KEY = "0123456789abcdef0123456789abcdef";
export function encryptedAudio(bytes: Uint8Array, key = AUDIO_KEY): Uint8Array {
  const out = new Uint8Array(16 + bytes.length);
  out.set([82, 80, 71, 77, 86]); out.set(bytes, 16);
  for (let i = 0; i < Math.min(16, bytes.length); i++) out[16 + i] ^= parseInt(key.slice(i * 2, i * 2 + 2), 16);
  return out;
}
export const m4aFixture = () => new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 77, 52, 65, 32, 0, 0, 0, 0]);
