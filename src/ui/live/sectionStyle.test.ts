import { describe, expect, it } from "vitest";
import { Check, Lock, MessageCircle, Repeat } from "lucide-react";
import { sectionStyle } from "./sectionStyle";

describe("sectionStyle", () => {
  it("maps each section to its label, icon and colour", () => {
    expect(sectionStyle("now")).toMatchObject({ label: "지금 할 수 있음", Icon: MessageCircle, text: "text-chart-2", border: "border-chart-2", bg: "bg-chart-2", fill: "fill-chart-2" });
    expect(sectionStyle("repeat")).toMatchObject({ label: "반복하면 달라짐", Icon: Repeat, text: "text-chart-1", fill: "fill-chart-1" });
    expect(sectionStyle("locked")).toMatchObject({ label: "잠김", Icon: Lock, text: "text-muted-foreground", fill: "fill-muted-foreground" });
    expect(sectionStyle("done")).toMatchObject({ label: "다 봄", Icon: Check, border: "border-border", fill: "fill-border" });
  });
  it("uses distinct colours for now and repeat", () => {
    expect(sectionStyle("now").text).not.toBe(sectionStyle("repeat").text);
  });
});
