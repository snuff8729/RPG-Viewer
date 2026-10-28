import { describe, expect, it } from "vitest";
import type { EventCommand } from "../types";
import { dTextCaption, dTextCaptionBefore, dTextOf, textPictureLabel } from "./textPicture";

const c = (code: number, p: unknown[]): EventCommand => ({ code, indent: 0, parameters: p }) as EventCommand;

describe("dTextOf", () => {
  it("drops the command and the size arg", () => expect(dTextOf("D_TEXT 안녕하세요 24")).toBe("안녕하세요"));
  it("keeps text without size", () => expect(dTextOf("D_TEXT 안녕")).toBe("안녕"));
  it("keeps a lone number as the text", () => expect(dTextOf("D_TEXT 100")).toBe("100"));
  it("joins spaced words", () => expect(dTextOf("D_TEXT 좋은 아침 30")).toBe("좋은 아침"));
  it("ignores other commands", () => {
    expect(dTextOf("D_TEXT_SETTING ALIGN 1")).toBeNull();
    expect(dTextOf("ShowMessage foo")).toBeNull();
    expect(dTextOf(null)).toBeNull();
  });
});

describe("dTextCaption", () => {
  it("joins multiple D_TEXT lines", () => expect(dTextCaption(["D_TEXT 가 24", "D_TEXT_SETTING X", "D_TEXT 나"])).toBe("가 / 나"));
  it("is empty without D_TEXT", () => expect(dTextCaption(["Foo bar"])).toBe(""));
});

describe("dTextCaptionBefore", () => {
  it("collects the run of D_TEXT commands right before the index", () => {
    const list = [c(356, ["D_TEXT 먼저"]), c(101, ["", 0, 0, 2]), c(356, ["D_TEXT 안녕하세요 24"]), c(231, [1, ""])];
    expect(dTextCaptionBefore(list, 3)).toBe("안녕하세요");
  });
  it("stops at a non-D_TEXT plugin command", () => {
    const list = [c(356, ["D_TEXT 가"]), c(356, ["Other cmd"]), c(231, [1, ""])];
    expect(dTextCaptionBefore(list, 2)).toBe("");
  });
});

describe("textPictureLabel", () => {
  it("shows the caption or a muted note", () => {
    expect(textPictureLabel("안녕하세요")).toBe("글자 그림: 「안녕하세요」");
    expect(textPictureLabel("")).toBe("글자·플러그인 그림 (파일 없음)");
  });
});
