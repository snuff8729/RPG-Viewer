import type { GameData } from "../types";
import { actorName, variableName } from "./names";
import { DEFAULT_TEXT_PALETTE } from "../assets/textPalette";

// \\ | \CODE[arg] / \CODE<arg> / \CODE | \symbol. [arg] allows one level of nested [...].
const TOKEN = /\\(?:(\\)|([A-Za-z]+)(?:\[((?:[^[\]]|\[[^\]]*\])*)\]|<[^>]*>)?|[{}.|!><^$]|$)/g;

export function formatText(raw: string, data: GameData): string {
  return raw.replace(TOKEN, (_m, backslash?: string, code?: string, arg?: string) => tokenText(data, backslash, code, arg));
}

/** Keep substitutions identical for plain and styled text, including nested arguments. */
function tokenText(data: GameData, backslash?: string, code?: string, arg?: string): string {
  if (backslash) return "\\";
  if (!code) return "";
  const c = code.toUpperCase();
  const isNum = arg !== undefined && /^\s*\d+\s*$/.test(arg);
  switch (c) {
    case "N":
      if (arg === undefined) return "";
      return isNum ? actorName(data, Number(arg)) : formatText(arg, data);
    case "V":
      if (arg === undefined) return "";
      return isNum ? `[변수: ${variableName(data, Number(arg))}]` : formatText(arg, data);
    case "P":
      return isNum ? `[파티원 ${Number(arg)}]` : "";
    case "G":
      return data.system?.currencyUnit ?? "";
    default:
      return "";
  }
}

export interface RichSegment { text: string; color?: string; size?: number }
export interface RichOptions { palette?: readonly string[] }

function defaultFontSize(data: GameData): number {
  if (data.engine === "MV") return 28;
  const advanced = data.system?.advanced;
  const size = advanced && typeof advanced === "object" && "fontSize" in advanced ? advanced.fontSize : undefined;
  return typeof size === "number" && Number.isFinite(size) && size > 0 ? size : 26;
}

/** One message: styles carry over newlines, but never into the next call. */
export function formatRich(raw: string, data: GameData, opts: RichOptions = {}): RichSegment[] {
  const palette = opts.palette ?? DEFAULT_TEXT_PALETTE;
  const defaultPx = defaultFontSize(data);
  let px = defaultPx;
  let color: string | undefined;
  let end = 0;
  const segments: RichSegment[] = [];
  const append = (text: string) => {
    if (!text) return;
    const scale = Math.min(2.5, Math.max(0.6, px / defaultPx));
    const size = scale === 1 ? undefined : scale;
    const last = segments[segments.length - 1];
    if (last && last.color === color && last.size === size) last.text += text;
    else segments.push({ text, ...(color === undefined ? {} : { color }), ...(size === undefined ? {} : { size }) });
  };

  for (const match of raw.matchAll(TOKEN)) {
    append(raw.slice(end, match.index));
    end = match.index + match[0].length;
    const [, backslash, code, arg] = match;
    const c = code?.toUpperCase();
    if (c === "C" || c === "HC") {
      const value = arg?.trim() ?? "";
      const hex = c === "HC" ? value.replace(/^#/, "") : value.startsWith("#") ? value.slice(1) : "";
      if (/^(?:[\da-f]{3}|[\da-f]{6})$/i.test(hex)) color = `#${hex}`;
      else if (c === "C" && /^\d+$/.test(value)) {
        const index = Number(value);
        if (index === 0) color = undefined;
        else if (index < 32 && palette[index]) color = palette[index];
      }
    } else if (match[0] === "\\{") {
      if (px <= 96) px += 12;
    } else if (match[0] === "\\}") {
      if (px >= 24) px -= 12;
    } else if (c === "FS") {
      if (arg !== undefined && /^\s*\d+\s*$/.test(arg) && Number.isFinite(Number(arg))) px = Number(arg);
    } else append(tokenText(data, backslash, code, arg));
  }
  append(raw.slice(end));
  return segments;
}
