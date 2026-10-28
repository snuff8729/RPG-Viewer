import { describe, expect, it } from "vitest";
import { BookOpen, CircleCheck, DoorOpen, Gift, Hand, Lock, MessageCircle, Repeat, Swords } from "lucide-react";
import type { Section } from "@/core/live/mapChecklist";
import { eventStyle, sectionStyle, storyStyle } from "./sectionStyle";

const ALL: Section[] = ["now", "item", "repeat", "exit", "enemy", "talk", "locked", "done"];

describe("sectionStyle", () => {
  it("maps each section to its label, icon and colour token", () => {
    expect(sectionStyle("now")).toMatchObject({ label: "안 본 내용 있음", Icon: MessageCircle, text: "text-section-now", border: "border-section-now", bg: "bg-section-now", fill: "fill-section-now", cssVar: "--section-now" });
    expect(sectionStyle("item")).toMatchObject({ label: "아이템", Icon: Gift, text: "text-section-item", cssVar: "--section-item" });
    expect(sectionStyle("repeat")).toMatchObject({ label: "반복하면 달라짐", Icon: Repeat, fill: "fill-section-repeat" });
    expect(sectionStyle("exit")).toMatchObject({ label: "다른 곳으로 이동", Icon: DoorOpen, cssVar: "--section-exit" });
    expect(sectionStyle("enemy")).toMatchObject({ label: "적", Icon: Swords, text: "text-section-enemy", cssVar: "--section-enemy" });
    expect(sectionStyle("talk")).toMatchObject({ label: "다 봄 (다시 가능)", Icon: Hand, text: "text-section-talk" });
    expect(sectionStyle("locked")).toMatchObject({ label: "잠김", Icon: Lock, fill: "fill-section-locked" });
    expect(sectionStyle("done")).toMatchObject({ label: "다 봄", Icon: CircleCheck, border: "border-section-done" });
  });
  it("every section (and story) has its own colour, icon and label", () => {
    const all = [...ALL.map(sectionStyle), storyStyle];
    for (const key of ["text", "cssVar", "Icon", "label"] as const) expect(new Set(all.map(s => s[key])).size).toBe(all.length);
  });
  it("story / background events get their own style", () => {
    expect(eventStyle({ section: "locked", story: true })).toMatchObject({ label: "이야기·자동 진행", Icon: BookOpen });
    expect(eventStyle({ section: "now", story: true })).toBe(storyStyle);
    expect(eventStyle({ section: "locked", story: false })).toBe(sectionStyle("locked"));
    expect(eventStyle({ section: "talk", story: false })).toBe(sectionStyle("talk"));
  });
});
