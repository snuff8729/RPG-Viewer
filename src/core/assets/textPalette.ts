/** The standard MV/MZ Window skin's 32 text colours. Index 0 is rendered using the app foreground. */
export const DEFAULT_TEXT_PALETTE: readonly string[] = [
  "#ffffff", "#20a0d6", "#ff784c", "#66cc40", "#99ccff", "#ccc0ff", "#ffffa0", "#808080",
  "#c0c0c0", "#2080cc", "#ff3810", "#00a010", "#3e9ade", "#a098ff", "#ffcc20", "#000000",
  "#84aaff", "#ffff40", "#ff2020", "#202040", "#e08040", "#f0c040", "#4080c0", "#40c0f0",
  "#80ff80", "#c08080", "#8080ff", "#ff80ff", "#00a040", "#00e060", "#a060e0", "#c080ff",
];

/** Sample the centres of the 8 × 4 colour cells from an unscaled, RGBA Window skin. */
export function textPaletteFromPixels(pixels: Uint8ClampedArray, width: number, height: number): string[] | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 187 || height < 187 || pixels.length < width * height * 4) return null;
  return Array.from({ length: 32 }, (_, index) => {
    const x = 96 + (index % 8) * 12 + 6;
    const y = 144 + Math.floor(index / 8) * 12 + 6;
    const at = (y * width + x) * 4;
    return `#${[pixels[at], pixels[at + 1], pixels[at + 2]].map(n => n.toString(16).padStart(2, "0")).join("")}`;
  });
}

interface PaletteSource { load(kind: "system", name: string): Promise<Blob | null> }
const palettes = new WeakMap<PaletteSource, Promise<readonly string[]>>();

/** One decode per game's asset store, including failures. The source handles image decryption. */
export function loadTextPalette(source: PaletteSource): Promise<readonly string[]> {
  const cached = palettes.get(source);
  if (cached) return cached;
  const promise = readTextPalette(source);
  palettes.set(source, promise);
  return promise;
}

async function readTextPalette(source: PaletteSource): Promise<readonly string[]> {
  let bitmap: ImageBitmap | null = null;
  try {
    const blob = await source.load("system", "Window");
    if (!blob || typeof createImageBitmap !== "function") return DEFAULT_TEXT_PALETTE;
    bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return DEFAULT_TEXT_PALETTE;
    ctx.drawImage(bitmap, 0, 0);
    return textPaletteFromPixels(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height) ?? DEFAULT_TEXT_PALETTE;
  } catch {
    return DEFAULT_TEXT_PALETTE;
  } finally {
    bitmap?.close();
  }
}
