import { describe, expect, it } from "vitest";
import { bannerText, connectionGuide, installResultText, lastSeenText, needsPluginBanner, panelAction } from "./connectionGuide";

const pc = { remote: false, canLaunch: true };

describe("connection panel", () => {
  it("offers install/update, launch only when installed and off, nothing on the phone", () => {
    expect(panelAction("install", pc)).toBe("install");
    expect(panelAction("update", pc)).toBe("update");
    expect(panelAction("off", pc)).toBe("launch");
    expect(panelAction("off", { remote: false, canLaunch: false })).toBeNull();
    expect(panelAction("connected", pc)).toBeNull();
    expect(panelAction("install", { remote: true, canLaunch: true })).toBeNull();
  });
  it("describes the last record time briefly", () => {
    const now = new Date(2026, 10, 1, 12, 0).getTime();
    expect(lastSeenText(null, now)).toBe("기록 없음");
    expect(lastSeenText(now - 10_000, now)).toBe("마지막 기록 방금");
    expect(lastSeenText(now - 5 * 60_000, now)).toBe("마지막 기록 5분 전");
    expect(lastSeenText(now - 3 * 3_600_000, now)).toBe("마지막 기록 3시간 전");
    expect(lastSeenText(new Date(2026, 9, 3, 9).getTime(), now)).toBe("마지막 기록 10월 3일");
  });
});

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
