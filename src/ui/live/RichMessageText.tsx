import { useEffect, useMemo, useState } from "react";
import { useGame } from "@/app/GameProvider";
import { useLiveData } from "@/app/LiveProvider";
import { DEFAULT_TEXT_PALETTE, loadTextPalette } from "@/core/assets/textPalette";
import type { AssetStore } from "@/core/assets/assets";
import { formatRich, type RichSegment } from "@/core/text/escape";
import type { GameData } from "@/core/types";
import type { ReaderItem } from "@/core/live/reader";

function useTextPalette(): readonly string[] {
  const { assets } = useGame();
  const [state, setState] = useState<{ assets: AssetStore; palette: readonly string[] }>();
  useEffect(() => {
    if (!assets) return;
    let cancelled = false;
    loadTextPalette(assets).then(palette => { if (!cancelled) setState({ assets, palette }); });
    return () => { cancelled = true; };
  }, [assets]);
  return state && state.assets === assets ? state.palette : DEFAULT_TEXT_PALETTE;
}

function Spans({ segments, colorsOnly = false }: { segments: RichSegment[]; colorsOnly?: boolean }) {
  return segments.map((segment, i) => (
    <span key={i} style={{ color: segment.color, fontSize: !colorsOnly && segment.size !== undefined ? `${segment.size}em` : undefined }}>{segment.text}</span>
  ));
}

/** Inline spans for the timeline. Every invocation is a fresh message/style state. */
export function RichText({ text, data, colorsOnly = false }: { text: string; data: GameData; colorsOnly?: boolean }) {
  const palette = useTextPalette();
  const segments = useMemo(() => formatRich(text, data, { palette }), [text, data, palette]);
  return <Spans segments={segments} colorsOnly={colorsOnly} />;
}

/** Keep the reader's existing paragraphs, including empty lines, without resetting styles at newlines. */
function MessageParagraphs({ raw, lines, data, palette }: { raw?: string; lines: string[]; data?: GameData; palette: readonly string[] }) {
  const richLines = useMemo(() => {
    if (raw === undefined || !data) return lines.map(text => text ? [{ text }] : []);
    const out: RichSegment[][] = [[]];
    for (const segment of formatRich(raw, data, { palette })) {
      segment.text.split("\n").forEach((text, i) => {
        if (i > 0) out.push([]);
        if (text) out[out.length - 1].push({ ...segment, text });
      });
    }
    return out;
  }, [raw, lines, data, palette]);
  return richLines.map((segments, i) => <p key={i} className="whitespace-pre-line break-words">{segments.length > 0 ? <Spans segments={segments} /> : "\u00a0"}</p>);
}

export function ReaderMessageText({ item }: { item: Extract<ReaderItem, { kind: "message" }> }) {
  const data = useLiveData();
  const palette = useTextPalette();
  return (
    <>
      {item.speaker && <p className="whitespace-pre-line text-sm font-medium text-muted-foreground">{data && item.rawSpeaker !== undefined
        ? <Spans segments={formatRich(item.rawSpeaker, data, { palette })} colorsOnly /> : item.speaker}</p>}
      <MessageParagraphs raw={item.rawText} lines={item.lines} data={data} palette={palette} />
    </>
  );
}

export function ReaderScrollText({ item }: { item: Extract<ReaderItem, { kind: "scroll" }> }) {
  const data = useLiveData();
  const palette = useTextPalette();
  return <MessageParagraphs raw={item.rawText} lines={item.lines} data={data} palette={palette} />;
}
