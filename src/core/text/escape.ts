import type { GameData } from "../types";
import { actorName, variableName } from "./names";

// \\ | \CODE[arg] / \CODE<arg> / \CODE | \symbol. [arg] allows one level of nested [...].
const TOKEN = /\\(?:(\\)|([A-Za-z]+)(?:\[((?:[^[\]]|\[[^\]]*\])*)\]|<[^>]*>)?|[{}.|!><^$]|$)/g;

export function formatText(raw: string, data: GameData): string {
  return raw.replace(TOKEN, (_m, backslash?: string, code?: string, arg?: string) => {
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
  });
}
