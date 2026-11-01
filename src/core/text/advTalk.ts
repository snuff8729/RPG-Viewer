import { parsePluginsJs } from "../live/installer";
import type { GameData } from "../types";

/**
 * ADVTalkSystem(MV 대화 플러그인)의 이름 창.
 *
 * 플러그인은 "Talk Mode Switch ID"와 "Name Window Switch ID" 스위치가 켜져 있고 메시지 글이 두 줄 이상이면
 * 첫 줄을 글에서 빼(`$gameMessage._texts.splice(0, 1)`) 이름 창에 화자로 띄운다.
 *
 * 근사: 뷰어는 스위치 상태를 따지지 않는다. 이 플러그인을 쓰는 게임은 보통 시작할 때 두 스위치를 켜고
 * 거의 끄지 않으므로(끄는 곳은 아주 드묾), 플러그인이 켜져 있으면 두 줄 이상인 메시지의 첫 줄을 늘 화자로 본다.
 * 스위치가 꺼진 드문 자리에서는 첫 줄이 화자로 잘못 보일 수 있다.
 */

/** 이름 상자 코드(\n<X> 등) — 이 코드가 있으면 그쪽 화자가 먼저다(interpret.ts의 NAME_BOX와 같음). */
const NAME_BOX = /^\\n[lcr]?<([^<>]*)>/i;

/** plugins.js 텍스트에서 ADVTalkSystem이 켜져 있으면 true. 없거나 이상하면 false. 예외를 던지지 않는다. */
export function advTalkNameLineFromPlugins(text: string | null | undefined): boolean {
  try {
    if (typeof text !== "string") return false;
    return (parsePluginsJs(text) ?? []).some(e => !!e && typeof e === "object" && e.status === true && e.name === "ADVTalkSystem");
  } catch {
    return false;
  }
}

/**
 * 원문 줄들(서식화 전)에 ADVTalkSystem 이름 줄 규칙을 적용한다: 두 줄 이상이고 첫 줄이 이름 상자 코드로 시작하지 않으면
 * { name: 첫 줄, rest: 나머지 }. 규칙이 맞지 않으면 null. 예외를 던지지 않는다.
 */
export function splitAdvNameLine(rawLines: readonly unknown[]): { name: string; rest: string[] } | null {
  if (!Array.isArray(rawLines) || rawLines.length < 2) return null;
  const first = typeof rawLines[0] === "string" ? rawLines[0] : "";
  if (NAME_BOX.test(first)) return null;
  return { name: first, rest: rawLines.slice(1).map(l => (typeof l === "string" ? l : "")) };
}

/**
 * 기록된 메시지(speaker·text 원문)를 화자·본문 원문으로 나눈다. 게임에 ADVTalkSystem 이름 줄 규칙이 있고
 * 기록에 화자가 없으면(기록 플러그인은 이름 창을 모르고 글 전체를 남긴다) 첫 줄을 화자로 옮긴다.
 * 그 밖에는 그대로. 예외를 던지지 않는다.
 */
export function messageParts(speaker: unknown, text: unknown, data: GameData | null | undefined): { speaker: string; text: string } {
  const sp = typeof speaker === "string" ? speaker : "";
  const tx = typeof text === "string" ? text : "";
  try {
    if (!data?.advTalkNameLine || sp.trim()) return { speaker: sp, text: tx };
    const split = splitAdvNameLine(tx.split("\n"));
    return split ? { speaker: split.name, text: split.rest.join("\n") } : { speaker: sp, text: tx };
  } catch {
    return { speaker: sp, text: tx };
  }
}
