import type { BranchPrefs, BranchSummary } from "@/core/live/branchTidy";
import { formatText } from "@/core/text/escape";
import { messageParts } from "@/core/text/advTalk";
import type { GameData } from "@/core/types";
import { pickedFallbackText } from "./historyText";

const pad = (n: number) => String(n).padStart(2, "0");

/** `10/29 14:03`(시각을 모르면 빈 문자열). */
export function shortDateTime(t: number): string {
  if (!Number.isFinite(t) || t <= 0) return "";
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 자동 이름: `{날짜 시각} · {시작한 맵} · 대사 N줄`. */
export function autoBranchName(s: BranchSummary, data: GameData | null | undefined): string {
  const parts: string[] = [];
  const when = shortDateTime(s.startT);
  if (when) parts.push(when);
  if (s.startMapId !== null) parts.push(data?.mapInfos?.[s.startMapId]?.name || `맵 #${s.startMapId}`);
  parts.push(`대사 ${s.lineCount}줄`);
  return parts.join(" · ");
}

/** 사용자 이름이 있으면 그것, 없으면 자동 이름. */
export function branchName(s: BranchSummary | undefined, prefs: BranchPrefs, data: GameData | null | undefined, fallback: string): string {
  if (!s) return fallback;
  return prefs.branches[String(s.id)]?.label || autoBranchName(s, data);
}

/** 마지막 대사 미리보기(`이름: 대사`, 한 줄). */
export function lastLineText(s: BranchSummary, data: GameData | null | undefined): string | null {
  if (!s.lastLine) return null;
  const fmt = (raw: string) => (data ? formatText(raw, data) : raw).replace(/\s+/g, " ").trim();
  const parts = messageParts(s.lastLine.speaker, s.lastLine.text, data);
  const text = fmt(parts.text);
  const speaker = parts.speaker ? fmt(parts.speaker) : "";
  return speaker ? `${speaker}: ${text}` : text;
}

/** 부모와 갈라지는 선택 문구. */
export function firstPickText(s: BranchSummary, data: GameData | null | undefined): string | null {
  const p = s.firstPick;
  if (!p) return null;
  const raw = p.picked >= 0 ? p.options?.[p.picked] : undefined;
  return raw !== undefined ? (data ? formatText(raw, data) : raw) : pickedFallbackText(p.picked);
}
