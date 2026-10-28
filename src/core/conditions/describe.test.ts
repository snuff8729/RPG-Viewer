import { describe, it, expect, beforeAll } from "vitest";
import { loadGame } from "../loader/loadGame";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import type { GameData, PageConditions, TroopPageConditions } from "../types";
import {
  describePageConditions, describeCommonEventConditions,
  describeTroopPageConditions, describeBranchCondition,
} from "./describe";

const emptyConds: PageConditions = {
  switch1Valid: false, switch1Id: 1, switch2Valid: false, switch2Id: 1,
  variableValid: false, variableId: 1, variableValue: 0,
  selfSwitchValid: false, selfSwitchCh: "A",
  itemValid: false, itemId: 1, actorValid: false, actorId: 1,
};
const emptyTroop: TroopPageConditions = {
  turnEnding: false, turnValid: false, enemyValid: false, actorValid: false, switchValid: false,
  turnA: 0, turnB: 0, enemyIndex: 0, enemyHp: 50, actorId: 1, actorHp: 50, switchId: 1,
};

let data: GameData;
beforeAll(async () => {
  const r = await loadGame(loadFixtureFolder("sample-mz"));
  if (!r.ok) throw new Error("load failed");
  data = r.data;
});

describe("describePageConditions", () => {
  it("switch1", () => expect(describePageConditions({ ...emptyConds, switch1Valid: true, switch1Id: 1 }, 0, data).map(c => c.text))
    .toEqual(["스위치: 숲 개방 ON", "실행: 결정 키"]));
  it("variable/self/item", () => expect(describePageConditions({ ...emptyConds, variableValid: true, variableId: 1, variableValue: 5, selfSwitchValid: true, selfSwitchCh: "B", itemValid: true, itemId: 1 }, 3, data).map(c => c.text))
    .toEqual(["변수: 호감도 ≥ 5", "셀프 스위치 B ON", "아이템: 낡은 열쇠 보유", "실행: 자동 실행"]));
  it("refs", () => {
    const cs = describePageConditions({ ...emptyConds, selfSwitchValid: true, selfSwitchCh: "B", actorValid: true, actorId: 1 }, 1, data);
    expect(cs[0].refs).toEqual([{ type: "selfSwitch", id: "B" }]);
    expect(cs[1]).toEqual({ text: "파티에 레나 있음", refs: [{ type: "actor", id: 1 }], test: { kind: "actorInParty", id: 1 } });
    expect(cs[2]).toEqual({ text: "실행: 플레이어 접촉", refs: [], test: { kind: "trigger" } });
  });
  it("triggers", () => expect([0, 1, 2, 3, 4].map(t => describePageConditions(emptyConds, t, data)[0].text))
    .toEqual(["실행: 결정 키", "실행: 플레이어 접촉", "실행: 이벤트 접촉", "실행: 자동 실행", "실행: 병렬 처리"]));
});

describe("describeCommonEventConditions", () => {
  const ev = (trigger: number) => ({ id: 1, name: "x", trigger, switchId: 1, list: [] });
  it("none", () => expect(describeCommonEventConditions(ev(0), data)).toEqual([]));
  it("auto", () => expect(describeCommonEventConditions(ev(1), data).map(c => c.text)).toEqual(["실행: 자동 실행", "스위치: 숲 개방 ON"]));
  it("parallel", () => expect(describeCommonEventConditions(ev(2), data).map(c => c.text)).toEqual(["실행: 병렬 처리", "스위치: 숲 개방 ON"]));
});

describe("describeTroopPageConditions", () => {
  it("sample", () => expect(describeTroopPageConditions({ ...emptyTroop, turnValid: true, turnA: 1, turnB: 0 }, 0, data).map(c => c.text))
    .toEqual(["턴: 1 + 0×X", "범위: 전투"]));
  it("all", () => expect(describeTroopPageConditions({ ...emptyTroop, turnEnding: true, enemyValid: true, actorValid: true, switchValid: true }, 2, data).map(c => c.text))
    .toEqual(["턴 종료 시", "적 #1 HP ≤ 50%", "레나 HP ≤ 50%", "스위치: 숲 개방 ON", "범위: 순간"]));
  it("span 1", () => expect(describeTroopPageConditions(emptyTroop, 1, data).map(c => c.text)).toEqual(["범위: 턴"]));
});

describe("describeBranchCondition", () => {
  it("unnamed switch", () => expect(describeBranchCondition([0, 2, 1], data).text).toBe("스위치: #2 OFF"));
  it("variable const", () => {
    const c = describeBranchCondition([1, 1, 0, 5, 1], data);
    expect(c.text).toBe("변수: 호감도 ≥ 5");
    expect(c.refs).toEqual([{ type: "variable", id: 1 }]);
  });
  it("variable vs variable", () => {
    const c = describeBranchCondition([1, 1, 1, 2, 5], data);
    expect(c.text).toBe("변수: 호감도 ≠ 변수: #2");
    expect(c.refs).toEqual([{ type: "variable", id: 1 }, { type: "variable", id: 2 }]);
  });
  it("self switch", () => expect(describeBranchCondition([2, "A", 0], data)).toEqual({ text: "셀프 스위치 A ON", refs: [{ type: "selfSwitch", id: "A" }], test: { kind: "selfSwitch", letter: "A", on: true } }));
  it("timer", () => expect(describeBranchCondition([3, 90, 0], data).text).toBe("타이머 ≥ 1분 30초"));
  it("actor", () => {
    expect(describeBranchCondition([4, 1, 0], data).text).toBe("파티에 레나 있음");
    expect(describeBranchCondition([4, 1, 2, 3], data).text).toBe("배우: 레나 (조건 유형 2)");
  });
  it("enemy", () => expect(describeBranchCondition([5, 0, 0], data).text).toBe("적 #1 등장"));
  it("character", () => expect(describeBranchCondition([6, 0, 4], data).text).toBe("캐릭터 0 방향 = 왼쪽"));
  it("gold", () => expect(describeBranchCondition([7, 100, 0], data).text).toBe("소지금 ≥ 100G"));
  it("item/weapon/armor", () => {
    expect(describeBranchCondition([8, 1], data)).toEqual({ text: "아이템: 낡은 열쇠 보유", refs: [{ type: "item", id: 1 }], test: { kind: "item", id: 1 } });
    expect(describeBranchCondition([9, 7, false], data).text).toBe("무기: #7 보유");
    expect(describeBranchCondition([10, 7, false], data).text).toBe("방어구: #7 보유");
  });
  it("weapon/armor including equipment cannot be judged from inventory", () => {
    expect(describeBranchCondition([9, 7, true], data)).toEqual({ text: "무기: #7 보유", refs: [{ type: "weapon", id: 7 }], test: { kind: "unknown" } });
    expect(describeBranchCondition([10, 7, true], data)).toEqual({ text: "방어구: #7 보유", refs: [{ type: "armor", id: 7 }], test: { kind: "unknown" } });
    expect(describeBranchCondition([9, 7, false], data).test).toEqual({ kind: "weapon", id: 7 });
  });
  it("button/vehicle", () => {
    expect(describeBranchCondition([11, "ok"], data).text).toBe("버튼: ok 누름");
    expect(describeBranchCondition([13, 1], data).text).toBe("탈것 1 탑승 중");
  });
  it("script", () => expect(describeBranchCondition([12, "$gameParty.size() > 2"], data).text).toBe("스크립트: $gameParty.size() > 2"));
  it("unknown / garbage", () => {
    expect(describeBranchCondition([42], data).text).toBe("알 수 없는 조건 (유형 42)");
    expect(() => describeBranchCondition([] as any, data)).not.toThrow();
  });
});

describe("condition tests", () => {
  it("attaches tests", () => {
    expect(describeBranchCondition([1, 1, 0, 5, 1], data).test).toEqual({ kind: "variable", id: 1, op: ">=", value: 5 });
    expect(describeBranchCondition([0, 2, 1], data).test).toEqual({ kind: "switch", id: 2, on: false });
    expect(describeBranchCondition([12, "x"], data).test).toEqual({ kind: "unknown" });
    expect(describePageConditions({ ...emptyConds, switch1Valid: true, switch1Id: 1 }, 0, data).map(c => c.test))
      .toEqual([{ kind: "switch", id: 1, on: true }, { kind: "trigger" }]);
  });
  it("branch condition tests by type", () => {
    const t = (p: any[]) => describeBranchCondition(p, data).test;
    expect(t([1, 1, 1, 2, 5])).toEqual({ kind: "variableVar", id: 1, op: "!=", otherId: 2 });
    expect(t([1, 1, 0, 3, 0])).toEqual({ kind: "variable", id: 1, op: "=", value: 3 });
    expect(t([2, "B", 1])).toEqual({ kind: "selfSwitch", letter: "B", on: false });
    expect(t([3, 90, 0])).toEqual({ kind: "unknown" });
    expect(t([4, 1, 0])).toEqual({ kind: "actorInParty", id: 1 });
    expect(t([4, 1, 2, 3])).toEqual({ kind: "unknown" });
    expect(t([5, 0, 0])).toEqual({ kind: "unknown" });
    expect(t([6, 0, 4])).toEqual({ kind: "unknown" });
    expect(t([7, 100, 2])).toEqual({ kind: "gold", op: "<", value: 100 });
    expect(t([8, 1])).toEqual({ kind: "item", id: 1 });
    expect(t([9, 7, false])).toEqual({ kind: "weapon", id: 7 });
    expect(t([10, 7, false])).toEqual({ kind: "armor", id: 7 });
    expect(t([11, "ok"])).toEqual({ kind: "unknown" });
    expect(t([13, 1])).toEqual({ kind: "unknown" });
    expect(t([42])).toEqual({ kind: "unknown" });
    expect(t([] as any)).toEqual({ kind: "unknown" });
  });
  it("page / common / troop tests", () => {
    expect(describePageConditions({ ...emptyConds, variableValid: true, variableId: 1, variableValue: 5, selfSwitchValid: true, selfSwitchCh: "B", itemValid: true, itemId: 1, actorValid: true, actorId: 1 }, 3, data).map(c => c.test))
      .toEqual([{ kind: "variable", id: 1, op: ">=", value: 5 }, { kind: "selfSwitch", letter: "B", on: true },
        { kind: "item", id: 1 }, { kind: "actorInParty", id: 1 }, { kind: "trigger" }]);
    expect(describeCommonEventConditions({ id: 1, name: "x", trigger: 1, switchId: 1, list: [] }, data).map(c => c.test))
      .toEqual([{ kind: "trigger" }, { kind: "switch", id: 1, on: true }]);
    expect(describeTroopPageConditions({ ...emptyTroop, turnEnding: true, turnValid: true, enemyValid: true, actorValid: true, switchValid: true }, 0, data).map(c => c.test))
      .toEqual([{ kind: "trigger" }, { kind: "trigger" }, { kind: "unknown" }, { kind: "unknown" }, { kind: "switch", id: 1, on: true }, { kind: "trigger" }]);
  });
});
