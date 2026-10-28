// Deterministic generator for test fixture images. Run: node scripts/make-fixture-images.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures");
const KEY = Buffer.from("0123456789abcdef0123456789abcdef", "hex");
const HEADER = Buffer.from("5250474d560000000003010000000000", "hex");

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** colorAt(x, y) -> [r,g,b,a] */
function png(w, h, colorAt) {
  const raw = Buffer.alloc(h * (1 + w * 4));
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) for (const v of colorAt(x, y)) raw[o++] = v;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function encrypt(pngBuf) {
  const body = Buffer.from(pngBuf);
  for (let i = 0; i < 16; i++) body[i] ^= KEY[i];
  return Buffer.concat([HEADER, body]);
}

const PALETTE = [
  [220, 60, 60, 255], [60, 180, 75, 255], [60, 90, 220, 255], [240, 200, 40, 255],
  [150, 60, 200, 255], [60, 200, 200, 255], [240, 130, 40, 255], [120, 120, 120, 255],
];
// 8 cells: 4 columns x 2 rows of 144x144
const faces = (x, y) => PALETTE[Math.floor(y / 144) * 4 + Math.floor(x / 144)];
const solid = (c) => () => c;

function write(rel, buf) {
  const p = join(ROOT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, buf);
}

write("sample-mz/img/faces/People1.png_", encrypt(png(576, 288, faces)));
write("sample-mz/img/faces/actor1.png", png(576, 288, faces));
write("sample-mz/img/pictures/village_map.png_", encrypt(png(816, 624, solid([90, 160, 90, 255]))));
write("sample-mv/www/img/faces/Actor1.rpgmvp", encrypt(png(576, 288, faces)));
