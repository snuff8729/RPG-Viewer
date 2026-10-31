import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TEXT_PALETTE, loadTextPalette, textPaletteFromPixels } from "./textPalette";

function skin(width = 192, height = 192) {
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  const colors = Array.from({ length: 32 }, (_, n) => {
    const at = ((144 + Math.floor(n / 8) * 12 + 6) * width + 96 + (n % 8) * 12 + 6) * 4;
    pixels.set([n, 128 + n, 255 - n, 255], at);
    return `#${[n, 128 + n, 255 - n].map(v => v.toString(16).padStart(2, "0")).join("")}`;
  });
  return { pixels, colors };
}

describe("textPaletteFromPixels", () => {
  it.each([192, 256])("samples all 32 cell centres with the correct row stride (%i pixels)", width => {
    const { pixels, colors } = skin(width);
    expect(textPaletteFromPixels(pixels, width, 192)).toEqual(colors);
  });

  it("rejects undersized skins and incomplete pixel buffers", () => {
    expect(textPaletteFromPixels(new Uint8ClampedArray(192 * 192 * 4), 186, 192)).toBeNull();
    expect(textPaletteFromPixels(new Uint8ClampedArray(192 * 192 * 4), 192, 186)).toBeNull();
    expect(textPaletteFromPixels(new Uint8ClampedArray(10), 192, 192)).toBeNull();
    expect(textPaletteFromPixels(new Uint8ClampedArray(192 * 192 * 4), 192.5, 192)).toBeNull();
  });

  it("provides a complete fallback palette", () => {
    expect(DEFAULT_TEXT_PALETTE).toHaveLength(32);
    expect(DEFAULT_TEXT_PALETTE.every(color => /^#[\da-f]{6}$/i.test(color))).toBe(true);
  });
});

describe("loadTextPalette", () => {
  afterEach(() => vi.unstubAllGlobals());

  function browser() {
    const { pixels, colors } = skin();
    const bitmap = { width: 192, height: 192, close: vi.fn() };
    const context = { drawImage: vi.fn(), getImageData: vi.fn(() => ({ data: pixels })) };
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => context) };
    const createBitmap = vi.fn(async () => bitmap);
    vi.stubGlobal("createImageBitmap", createBitmap);
    vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
    return { colors, bitmap, context, createBitmap };
  }

  it("loads Window through the asset layer, decodes once per game and releases the bitmap", async () => {
    const b = browser();
    const blob = new Blob();
    const source = { load: vi.fn(async () => blob) };
    const promise = loadTextPalette(source);
    expect(loadTextPalette(source)).toBe(promise);
    expect(await promise).toEqual(b.colors);
    expect(source.load).toHaveBeenCalledExactlyOnceWith("system", "Window");
    expect(b.createBitmap).toHaveBeenCalledExactlyOnceWith(blob);
    expect(b.context.drawImage).toHaveBeenCalledWith(b.bitmap, 0, 0);
    expect(b.bitmap.close).toHaveBeenCalledOnce();
    expect(await loadTextPalette(source)).toEqual(b.colors);
    expect(b.createBitmap).toHaveBeenCalledOnce();
    await loadTextPalette({ load: vi.fn(async () => blob) });
    expect(b.createBitmap).toHaveBeenCalledTimes(2);
  });

  it("caches fallback for missing or unreadable images", async () => {
    const missing = { load: vi.fn(async () => null) };
    expect(await loadTextPalette(missing)).toBe(DEFAULT_TEXT_PALETTE);
    expect(await loadTextPalette(missing)).toBe(DEFAULT_TEXT_PALETTE);
    expect(missing.load).toHaveBeenCalledOnce();
    expect(await loadTextPalette({ load: async () => { throw new Error("read failed"); } })).toBe(DEFAULT_TEXT_PALETTE);
    vi.stubGlobal("createImageBitmap", vi.fn(async () => { throw new Error("invalid PNG"); }));
    expect(await loadTextPalette({ load: async () => new Blob() })).toBe(DEFAULT_TEXT_PALETTE);
  });

  it("falls back if bitmap decoding is unavailable", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    expect(await loadTextPalette({ load: async () => new Blob() })).toBe(DEFAULT_TEXT_PALETTE);
  });

  it("falls back and releases the bitmap if canvas pixel reads fail", async () => {
    const b = browser();
    b.context.getImageData.mockImplementation(() => { throw new Error("canvas unavailable"); });
    expect(await loadTextPalette({ load: async () => new Blob() })).toBe(DEFAULT_TEXT_PALETTE);
    expect(b.bitmap.close).toHaveBeenCalledOnce();
  });
});
