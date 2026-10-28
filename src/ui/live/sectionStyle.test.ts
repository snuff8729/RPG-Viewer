import { describe, expect, it } from "vitest";
import { BookOpen, Check, DoorOpen, Gift, Hand, Lock, MessageCircle, Repeat } from "lucide-react";
import { eventStyle, sectionStyle } from "./sectionStyle";

describe("sectionStyle", () => {
  it("maps each section to its label, icon and colour", () => {
    expect(sectionStyle("now")).toMatchObject({ label: "새 대화", Icon: MessageCircle, text: "text-chart-2", border: "border-chart-2", bg: "bg-chart-2", fill: "fill-chart-2", cssVar: "--chart-2" });
    expect(sectionStyle("item")).toMatchObject({ label: "아이템", Icon: Gift, text: "text-chart-4", fill: "fill-chart-4", cssVar: "--chart-4" });
    expect(sectionStyle("repeat")).toMatchObject({ label: "반복하면 달라짐", Icon: Repeat, text: "text-chart-1", fill: "fill-chart-1" });
    expect(sectionStyle("exit")).toMatchObject({ label: "다른 곳으로 이동", Icon: DoorOpen, text: "text-chart-5", fill: "fill-chart-5", cssVar: "--chart-5" });
    expect(sectionStyle("talk")).toMatchObject({ label: "조사·대화 가능", Icon: Hand, text: "text-chart-3", fill: "fill-chart-3" });
    expect(sectionStyle("locked")).toMatchObject({ label: "잠김", Icon: Lock, text: "text-muted-foreground", fill: "fill-muted-foreground" });
    expect(sectionStyle("done")).toMatchObject({ label: "다 봄", Icon: Check, border: "border-border", fill: "fill-border" });
  });
  it("uses distinct colours for the actionable sections", () => {
    const texts = (["now", "item", "repeat", "exit", "talk"] as const).map((s) => sectionStyle(s).text);
    expect(new Set(texts).size).toBe(5);
  });
  it("story / background events get their own style", () => {
    expect(eventStyle({ section: "locked", story: true })).toMatchObject({ label: "이야기·자동 진행", Icon: BookOpen });
    expect(eventStyle({ section: "now", story: true })).toMatchObject({ label: "이야기·자동 진행" });
    expect(eventStyle({ section: "locked", story: false })).toBe(sectionStyle("locked"));
    expect(eventStyle({ section: "talk", story: false })).toBe(sectionStyle("talk"));
  });
});
