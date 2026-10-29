import { describe, expect, it } from "vitest";
import type { ReaderItem } from "./reader";
import type { HideRule } from "./readerFile";
import {
  compileHideRules, countByRule, digitsPattern, hideChoicesOf, lineTextOf, lineTypesOf, matchHide, NO_HIDE, normalizeLine,
} from "./hideRules";

const msg = (seq: number, text: string): ReaderItem =>
  ({ kind: "message", key: `r${seq}`, seq, speaker: "레이", face: "", faceIndex: 0, lines: text.split("\n"), src: null, cmd: null });
const notice = (seq: number, text: string, kind: "gain" | "info" = "gain", source = "ticker"): ReaderItem =>
  ({ kind: "notice", key: `r${seq}`, seq, text, source, noticeKind: kind });
const plugin = (seq: number, name: string, tech: boolean, text = "글"): ReaderItem =>
  ({ kind: "plugin", key: `r${seq}`, seq, text, raw: `${name} 1 2`, name, tech });
const battle = (seq: number): ReaderItem => ({
  kind: "battle", key: `r${seq}`, seq, troop: "슬라임", result: "win", ended: true, items: [], logLines: 0, dropped: 0, rewards: null, repeat: 0,
});
const rule = (r: Partial<HideRule> & Pick<HideRule, "kind">, id = "x"): HideRule => ({ id, t: 0, ...r } as HideRule);

describe("text keys", () => {
  it("normalizes whitespace and digit runs", () => {
    expect(normalizeLine("  골드\n 120   획득 ")).toBe("골드 120 획득");
    expect(digitsPattern("골드 120 획득")).toBe(digitsPattern("골드 35 획득"));
    expect(digitsPattern("HP 1,200 회복 ３회")).toBe("HP # 회복 #회");
  });

  it("reads the text of hideable lines only", () => {
    expect(lineTextOf(msg(1, "a\nb"))).toBe("a\nb");
    expect(lineTextOf(plugin(1, "Cmd", true))).toBe("Cmd 1 2");
    expect(lineTextOf(plugin(1, "Cmd", false, "보이는 글"))).toBe("보이는 글");
    expect(lineTextOf(battle(1))).toBeNull();
    expect(lineTextOf({ kind: "chapter", key: "c1", text: "— 마을 —" })).toBeNull();
  });

  it("gives types for system lines but none for story text", () => {
    expect(lineTypesOf(plugin(1, "Cmd", true))).toEqual(["plugin:Cmd", "plugin-tech"]);
    expect(lineTypesOf(notice(1, "x", "gain", "ticker"))).toEqual(["notice-kind:gain", "notice-source:ticker", "notice"]);
    expect(lineTypesOf(battle(1))).toEqual(["battle"]);
    expect(lineTypesOf(msg(1, "x"))).toEqual([]);
    expect(lineTypesOf({ kind: "scroll", key: "r1", seq: 1, lines: ["x"] })).toEqual([]);
  });
});

describe("matchHide", () => {
  it("matches exact, digits and type rules and reports the first rule in list order", () => {
    const c = compileHideRules([
      rule({ kind: "type", type: "plugin-tech" }, "a"),
      rule({ kind: "exact", text: "또 만났네" }, "b"),
      rule({ kind: "digits", pattern: "골드 # 획득" }, "c"),
      rule({ kind: "exact", text: "골드 7 획득" }, "d"),
    ]);
    expect(matchHide(plugin(1, "Cmd", true), c)).toBe(0);
    expect(matchHide(plugin(1, "Cmd", false), c)).toBe(-1);
    expect(matchHide(msg(1, "  또   만났네 "), c)).toBe(1);
    expect(matchHide(msg(1, "또 만났네!"), c)).toBe(-1);
    expect(matchHide(notice(1, "골드 35 획득"), c)).toBe(2);
    expect(matchHide(notice(1, "골드 7 획득"), c)).toBe(2);
    expect(matchHide(battle(1), c)).toBe(-1);
    expect(matchHide(msg(1, "x"), NO_HIDE)).toBe(-1);
  });

  it("hides notices by kind, source or all, and whole battles", () => {
    const c = compileHideRules([rule({ kind: "type", type: "notice-kind:gain" }), rule({ kind: "type", type: "battle" }, "y")]);
    expect(matchHide(notice(1, "a", "gain"), c)).toBe(0);
    expect(matchHide(notice(1, "a", "info"), c)).toBe(-1);
    expect(matchHide(battle(2), c)).toBe(1);
    expect(matchHide(notice(1, "a", "info", "livecomment"), compileHideRules([rule({ kind: "type", type: "notice-source:livecomment" })]))).toBe(0);
    expect(matchHide(notice(1, "a", "info"), compileHideRules([rule({ kind: "type", type: "notice" })]))).toBe(0);
  });

  it("never throws on junk", () => {
    expect(matchHide(null as unknown as ReaderItem, compileHideRules([rule({ kind: "exact", text: "a" })]))).toBe(-1);
    expect(compileHideRules(null).rules).toEqual([]);
    expect(compileHideRules([null as unknown as HideRule]).exact.size).toBe(0);
  });
});

describe("hideChoicesOf", () => {
  const label = (t: string) => `[${t}]`;
  it("offers this sentence, digits-only variants (when there are digits) and types", () => {
    expect(hideChoicesOf(notice(1, "골드 120 획득"), label).map((c) => c.label)).toEqual([
      "이 문장 숨기기", "숫자만 다른 문장도 숨기기", "[notice-kind:gain] 모두 숨기기", "[notice-source:ticker] 모두 숨기기", "[notice] 모두 숨기기",
    ]);
    expect(hideChoicesOf(notice(1, "골드 120 획득"), label)[1].rule).toEqual({ kind: "digits", pattern: "골드 # 획득" });
    // 대사에는 종류 숨기기가 없다
    expect(hideChoicesOf(msg(1, "안녕"), label).map((c) => c.label)).toEqual(["이 문장 숨기기"]);
    expect(hideChoicesOf(battle(1), label).map((c) => c.rule)).toEqual([{ kind: "type", type: "battle" }]);
  });
});

describe("countByRule", () => {
  it("counts hidden lines per rule", () => {
    expect(countByRule([-1, 0, 1, 0, -2, 5], 2)).toEqual([2, 1]);
  });
});
