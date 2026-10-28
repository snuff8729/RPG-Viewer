import { describe, expect, it } from "vitest";
import { fsAccessSupport } from "./fsAccess";

describe("fsAccessSupport", () => {
  it("supported when picker exists", () => {
    expect(fsAccessSupport({ showDirectoryPicker: () => {} })).toEqual({ supported: true, message: null });
  });
  it("Brave message", () => {
    const r = fsAccessSupport({ navigator: { brave: {} } });
    expect(r.supported).toBe(false);
    expect(r.message).toContain("brave://flags/#file-system-access-api");
  });
  it("other browser message", () => {
    const r = fsAccessSupport({ navigator: {} });
    expect(r.message).toBe("이 브라우저는 폴더 접근을 지원하지 않아 읽기 전용으로 열려요. 기록 플러그인을 쓰려면 크롬이나 엣지를 써 주세요.");
  });
});
