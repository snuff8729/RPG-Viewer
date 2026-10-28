import { describe, expect, it } from "vitest";
import { battleText, choiceTexts, stateChangeText, transferText } from "./historyText";
import type { LogRecord } from "@/core/live/types";
import type { GameData } from "@/core/types";

const data = {
  system: { switches: [null, "문 열림"], variables: [null, "호감"] },
  troops: [null, { name: "슬라임" }],
  mapInfos: [null, { name: "마을" }],
} as unknown as GameData;
const src = { source: "map", mapId: 1, eventId: 1, page: 0 } as const;
const base = { v: 1, t: 0, run: 1, branch: 1 } as const;

describe("historyText", () => {
  it("finds the option text from the preceding choices record", () => {
    const path = [
      { ...base, seq: 1, type: "choices", src, cmd: 3, options: ["예", "아니오"] },
      { ...base, seq: 2, type: "choice", src, cmd: 3, picked: 1 },
      { ...base, seq: 3, type: "choice", src, cmd: 9, picked: 0 },
    ] as LogRecord[];
    const m = choiceTexts(path, data);
    expect(m.get(2)).toBe("아니오");
    expect(m.get(3)).toBe("1번째 선택지");
  });
  it("names state changes", () => {
    expect(stateChangeText({ kind: "switch", id: 1, value: true }, data)).toBe("스위치 문 열림 → ON");
    expect(stateChangeText({ kind: "variable", id: 1, value: 5 }, data)).toBe("변수 호감 = 5");
    expect(stateChangeText({ kind: "selfSwitch", id: "1,2,A", value: true }, data)).toBe("셀프 스위치 1,2,A → ON");
  });
  it("formats battle and transfer", () => {
    expect(battleText({ ...base, seq: 1, type: "battle", phase: "start", troopId: 1 }, data)).toBe("⚔ 전투 시작: 슬라임");
    expect(battleText({ ...base, seq: 1, type: "battle", phase: "end", troopId: 1, result: "escape" }, data)).toBe("⚔ 전투 종료: 도주");
    expect(transferText({ ...base, seq: 1, type: "transfer", mapId: 1, x: 3, y: 4 }, data)).toBe("🚪 마을 (3, 4)");
  });
});
