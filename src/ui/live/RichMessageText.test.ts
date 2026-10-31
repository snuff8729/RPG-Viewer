import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadGame } from "@/core/loader/loadGame";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import type { GameData } from "@/core/types";
import type { ReaderItem } from "@/core/live/reader";
import { DEFAULT_TEXT_PALETTE } from "@/core/assets/textPalette";
import { ReaderMessageText, ReaderScrollText, RichText } from "./RichMessageText";

let data: GameData;
vi.mock("@/app/GameProvider", () => ({ useGame: () => ({}) }));
vi.mock("@/app/LiveProvider", () => ({ useLiveData: () => data }));

beforeAll(async () => {
  const result = await loadGame(loadFixtureFolder("sample-mz"));
  if (!result.ok) throw new Error("load failed");
  data = { ...result.data, system: { ...result.data.system, advanced: { fontSize: 26 } } };
});

const message = (patch: Partial<Extract<ReaderItem, { kind: "message" }>> = {}): Extract<ReaderItem, { kind: "message" }> => ({
  kind: "message", key: "r1", seq: 1, speaker: "", face: "", faceIndex: 0, src: null, cmd: null, lines: [], ...patch,
});

describe("rich message rendering", () => {
  it("renders inline colour and relative size in the timeline, with index 0 inheriting the theme", () => {
    const html = renderToStaticMarkup(createElement(RichText, { text: "\\C[2]\\FS[52]big\\C[0]default", data }));
    expect(html).toBe(`<span style="color:${DEFAULT_TEXT_PALETTE[2]};font-size:2em">big</span><span style="font-size:2em">default</span>`);
  });

  it("renders speaker colours without font sizes", () => {
    const html = renderToStaticMarkup(createElement(RichText, { text: "\\FS[52]\\C[#abc]speaker", data, colorsOnly: true }));
    expect(html).toBe('<span style="color:#abc">speaker</span>');
  });

  it("carries reader styles over newlines and preserves empty paragraphs", () => {
    const item = message({
      speaker: "Speaker", rawSpeaker: "\\C[#abc]\\FS[80]Speaker",
      rawText: "\\C[2]\\FS[52]first\n\nsecond\\C[0]default", lines: ["first", "", "seconddefault"],
    });
    const html = renderToStaticMarkup(createElement(ReaderMessageText, { item }));
    const paragraphs = [...html.matchAll(/<p[^>]*>(.*?)<\/p>/g)].map(match => match[1]);
    expect(paragraphs).toEqual([
      '<span style="color:#abc">Speaker</span>',
      `<span style="color:${DEFAULT_TEXT_PALETTE[2]};font-size:2em">first</span>`,
      "\u00a0",
      `<span style="color:${DEFAULT_TEXT_PALETTE[2]};font-size:2em">second</span><span style="font-size:2em">default</span>`,
    ]);
    expect(html).toContain("whitespace-pre-line");
  });

  it("renders scrolling messages with the same inline styles", () => {
    const item: Extract<ReaderItem, { kind: "scroll" }> = { kind: "scroll", key: "r1", seq: 1, lines: ["text"], rawText: "\\C[#def]text" };
    expect(renderToStaticMarkup(createElement(ReaderScrollText, { item }))).toContain('<span style="color:#def">text</span>');
  });

  it("keeps plain-only reader items literal, including inferred speaker names", () => {
    const item = message({ speaker: "\\C[2]literal", lines: ["\\C[2]literal", ""] });
    const html = renderToStaticMarkup(createElement(ReaderMessageText, { item }));
    expect(html).not.toContain("style=");
    expect(html).toContain("\\C[2]literal");
    expect(html).toContain("\u00a0");
  });
});
