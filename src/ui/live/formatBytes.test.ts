import { describe, expect, it } from "vitest";
import { formatBytes } from "./formatBytes";

describe("formatBytes", () => {
  it("1MB 미만은 KB 한 자리 소수", () => {
    expect(formatBytes(0)).toBe("0.0KB");
    expect(formatBytes(512)).toBe("0.5KB");
    expect(formatBytes(1536)).toBe("1.5KB");
    expect(formatBytes(1023.9 * 1024)).toBe("1023.9KB");
    expect(formatBytes(1024 * 1024 - 1)).toBe("1.0MB");
  });
  it("1MB 이상은 MB 한 자리 소수", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0MB");
    expect(formatBytes(2.25 * 1024 * 1024)).toBe("2.3MB");
  });
  it("음수·NaN은 0", () => {
    expect(formatBytes(-5)).toBe("0.0KB");
    expect(formatBytes(NaN)).toBe("0.0KB");
  });
});
