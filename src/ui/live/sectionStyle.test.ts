import { describe, expect, it } from "vitest";
import { BookOpen, Check, Gift, Hand, Lock, MessageCircle, Repeat } from "lucide-react";
import { eventStyle, sectionStyle } from "./sectionStyle";

describe("sectionStyle", () => {
  it("maps each section to its label, icon and colour", () => {
    expect(sectionStyle("now")).toMatchObject({ label: "새 대화", Icon: MessageCircle, text: "text-chart-2", border: "border-chart-2", bg: "bg-chart-2", fill: "fill-chart-2", cssVar: "--chart-2" });
    expect(sectionStyle("item")).toMatchObject({ label: "아이템", Icon: Gift, text: "text-chart-4", fill: "fill-chart-4", cssVar: "--chart-4" });
    expect(sectionStyle("repeat")).toMatchObject({ label: "반복하면 달라짐", Icon: Repeat, text: "text-chart-1", fill: "fill-chart-1" });
    expect(sectionStyle("talk")).toMatchObject({ label: "조사·대화 가능", Icon: Hand, text: "text-chart-3", fill: "fill-chart-3" });
    expect(sectionStyle("locked")).toMatchObject({ label: "잠김", Icon: Lock, text: "text-muted-foreground", fill: "fill-muted-foreground" });
    expect(sectionStyle("done")).toMatchObject({ label: "다 봄", Icon: Check, border: "border-border", fill: "fill-border" });
  });
  it("uses distinct colours for the actionable sections", () => {
    const texts = (["now", "item", "repeat", "talk"] as const).map((s) => sectionStyle(s).text);
    expect(new Set(texts).size).toBe(4);
  });
  it("story-locked events get their own style", () => {
    expect(eventStyle({ section: "locked", story: true })).toMatchObject({ label: "이야기 진행 조건", Icon: BookOpen });
    expect(eventStyle({ section: "locked", story: false })).toBe(sectionStyle("locked"));
    expect(eventStyle({ section: "talk", story: false })).toBe(sectionStyle("talk"));
  });
});
