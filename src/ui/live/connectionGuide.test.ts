import { describe, expect, it } from "vitest";
import { bannerText, connectionGuide, installResultText, needsPluginBanner } from "./connectionGuide";

const pc = { remote: false, canLaunch: true };

describe("connectionGuide", () => {
  it("connected has no guide", () => {
    expect(connectionGuide("connected", pc)).toBeNull();
  });

  it("install: step 1 with the install button on PC, no button on the phone", () => {
    const g = connectionGuide("install", pc)!;
    expect(g.title).toBe("기록 플러그인이 필요해요");
    expect(g.action).toBe("install");
    expect(g.steps?.map((s) => [s.done, s.current])).toEqual([[false, true], [false, false]]);
    const phone = connectionGuide("install", { remote: true, canLaunch: false })!;
    expect(phone.action).toBeNull();
    expect(phone.text).toBe("PC에서 설치해 주세요.");
  });

  it("update shows versions when known", () => {
    const g = connectionGuide("update", { ...pc, installedVersion: "1.20.0", bundledVersion: "1.29.1" })!;
    expect(g.action).toBe("update");
    expect(g.text).toBe("지금 1.20.0 → 새 1.29.1");
  });

  it("off: plugin step done, launch only when the launcher is available", () => {
    const g = connectionGuide("off", pc)!;
    expect(g.title).toBe("게임을 실행해 주세요");
    expect(g.action).toBe("launch");
    expect(g.steps?.map((s) => [s.done, s.current])).toEqual([[true, false], [false, true]]);
    expect(connectionGuide("off", { remote: false, canLaunch: false })!.action).toBeNull();
    expect(connectionGuide("off", { remote: true, canLaunch: true })!.text).toBe("PC에서 게임을 실행해 주세요.");
    expect(connectionGuide("off", { ...pc, justInstalled: "install" })!.text).toMatch(/^설치했어요/);
  });

  it("checking shows a spinner, unsupported links to manage", () => {
    expect(connectionGuide("checking", pc)!.spinner).toBe(true);
    expect(connectionGuide("unsupported", pc)!.action).toBe("manage");
  });

  it("banner only for install and update", () => {
    expect(needsPluginBanner("install")).toBe(true);
    expect(needsPluginBanner("update")).toBe(true);
    expect(needsPluginBanner("off")).toBe(false);
    expect(bannerText("install", true)).toMatch(/PC에서/);
  });

  it("install result text", () => {
    expect(installResultText("update", true)).toBe("업데이트했어요. 게임을 다시 실행해 주세요.");
    expect(installResultText("install", false, "쓸 수 없어요")).toBe("쓸 수 없어요");
  });
});
