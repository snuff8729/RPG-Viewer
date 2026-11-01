import { formatText } from "../text/escape";
import type { GameData } from "../types";
import type { RecordOf } from "./types";

/** 전투 로그의 기술·아이템 사용 줄. by = 쓴 쪽 이름(""이면 모름: 1.8.0 기록), enemy = 적이 썼는지 */
export interface BattleAction {
  by: string;
  item: string;
  itemKind: "skill" | "item";
  enemy: boolean;
  targets: string[];
}

/** 줄 첫머리의 전투 플러그인 줄 태그(YEP `<SIMPLE>`·`<CENTER>`·`<LEFT>`·`<RIGHT>`·`<WRAP>` 등 대문자 태그) */
const LINE_TAGS = /^(?:\s*<[A-Z][A-Z0-9_-]*>)+/;
const SIMPLE = /^\s*<SIMPLE>/;

const str = (s: unknown): string => typeof s === "string" ? s : "";

/** 줄마다 앞의 대문자 줄 태그를 뗀다. */
export function stripLineTags(text: string): string {
  return text.split("\n").map(l => l.replace(LINE_TAGS, "")).join("\n");
}

/** 전투 로그 줄 글: 제어 문자 처리 + 줄 태그 떼기 */
export function battleLogText(text: unknown, data: GameData): string {
  return stripLineTags(formatText(str(text), data));
}

/**
 * 기술·아이템 사용 줄이면 그 정보. 1.8.1+는 kind "action" 기록, 1.8.0은 `<SIMPLE>기술 이름` 줄(누가 썼는지 모름).
 * 아니면 null.
 */
export function battleActionOf(r: RecordOf<"battlelog">, data: GameData): BattleAction | null {
  if (r.kind === "action") {
    const item = formatText(str(r.item), data);
    const by = formatText(str(r.by), data);
    if (!item && !by) return null;
    const targets = Array.isArray(r.targets) ? r.targets.filter((t): t is string => typeof t === "string").map(t => formatText(t, data)) : [];
    return { by, item, itemKind: r.itemKind === "item" ? "item" : "skill", enemy: r.isEnemy === true, targets };
  }
  const text = str(r.text);
  if (!SIMPLE.test(text) || text.includes("\n")) return null;
  const item = battleLogText(text, data).trim();
  return item ? { by: "", item, itemKind: "skill", enemy: false, targets: [] } : null;
}

/**
 * 전투 기록을 접어 둬도 보이는 줄인가: 누가 무엇을 누구에게 쓴 줄(action)과 알림 문구.
 * 피해·상태 줄 등 나머지는 펼쳤을 때만(그 줄의 화면 그림은 접혀 있어도 보인다).
 */
export function shownWhenLogFolded(line: { kind: string; action?: BattleAction | null }): boolean {
  return line?.kind === "notice" || (line?.kind === "battlelog" && !!line.action);
}

/** 사용 줄의 한 줄 글: `{쓴 쪽}: {이름}`(쓴 쪽을 모르면 `기술: {이름}`) */
export function battleActionLabel(a: BattleAction): string {
  return `${a.by || (a.itemKind === "item" ? "아이템" : "기술")}: ${a.item}`;
}
