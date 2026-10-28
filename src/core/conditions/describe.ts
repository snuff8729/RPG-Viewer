import type {
  CompareOp, Condition, ConditionTest, CommonEvent, GameData, PageConditions, Ref, TroopPageConditions,
} from "../types";
import { actorName, armorName, itemName, switchName, variableName, weaponName } from "../text/names";

const TRIGGERS = ["결정 키", "플레이어 접촉", "이벤트 접촉", "자동 실행", "병렬 처리"];
const SPANS = ["전투", "턴", "순간"];
const VAR_OPS = ["=", "≥", "≤", ">", "<", "≠"];
const VAR_TEST_OPS: CompareOp[] = ["=", ">=", "<=", ">", "<", "!="];
const GOLD_OPS = ["≥", "≤", "<"];
const GOLD_TEST_OPS = [">=", "<=", "<"] as const;
const TIMER_OPS = ["≥", "≤"];
const DIRECTIONS: Record<number, string> = { 2: "아래", 4: "왼쪽", 6: "오른쪽", 8: "위" };

const UNKNOWN: ConditionTest = { kind: "unknown" };
const TRIGGER: ConditionTest = { kind: "trigger" };
const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

const cond = (text: string, refs: Ref[], test: ConditionTest): Condition => ({ text, refs, test: { ...test } });
const switchCond = (data: GameData, id: number, on = true): Condition =>
  cond(`스위치: ${switchName(data, id)} ${on ? "ON" : "OFF"}`, [{ type: "switch", id }], { kind: "switch", id: n(id), on });
const partyCond = (data: GameData, id: number): Condition =>
  cond(`파티에 ${actorName(data, id)} 있음`, [{ type: "actor", id }], { kind: "actorInParty", id: n(id) });
const triggerCond = (t: number): Condition => cond(`실행: ${TRIGGERS[t] ?? `트리거 ${t}`}`, [], TRIGGER);

export function describePageConditions(c: PageConditions, trigger: number, data: GameData): Condition[] {
  const out: Condition[] = [];
  if (c.switch1Valid) out.push(switchCond(data, c.switch1Id));
  if (c.switch2Valid) out.push(switchCond(data, c.switch2Id));
  if (c.variableValid) {
    out.push(cond(`변수: ${variableName(data, c.variableId)} ≥ ${c.variableValue}`, [{ type: "variable", id: c.variableId }],
      { kind: "variable", id: n(c.variableId), op: ">=", value: n(c.variableValue) }));
  }
  if (c.selfSwitchValid) {
    out.push(cond(`셀프 스위치 ${c.selfSwitchCh} ON`, [{ type: "selfSwitch", id: c.selfSwitchCh }],
      { kind: "selfSwitch", letter: String(c.selfSwitchCh), on: true }));
  }
  if (c.itemValid) out.push(cond(`아이템: ${itemName(data, c.itemId)} 보유`, [{ type: "item", id: c.itemId }], { kind: "item", id: n(c.itemId) }));
  if (c.actorValid) out.push(partyCond(data, c.actorId));
  out.push(triggerCond(trigger));
  return out;
}

export function describeCommonEventConditions(ev: CommonEvent, data: GameData): Condition[] {
  if (ev.trigger === 1) return [triggerCond(3), switchCond(data, ev.switchId)];
  if (ev.trigger === 2) return [triggerCond(4), switchCond(data, ev.switchId)];
  return [];
}

export function describeTroopPageConditions(c: TroopPageConditions, span: number, data: GameData): Condition[] {
  const out: Condition[] = [];
  if (c.turnEnding) out.push(cond("턴 종료 시", [], TRIGGER));
  if (c.turnValid) out.push(cond(`턴: ${c.turnA} + ${c.turnB}×X`, [], TRIGGER));
  if (c.enemyValid) out.push(cond(`적 #${c.enemyIndex + 1} HP ≤ ${c.enemyHp}%`, [], UNKNOWN));
  if (c.actorValid) out.push(cond(`${actorName(data, c.actorId)} HP ≤ ${c.actorHp}%`, [{ type: "actor", id: c.actorId }], UNKNOWN));
  if (c.switchValid) out.push(switchCond(data, c.switchId));
  out.push(cond(`범위: ${SPANS[span] ?? span}`, [], TRIGGER));
  return out;
}

export function describeBranchCondition(params: any[], data: GameData): Condition {
  const p = Array.isArray(params) ? params : [];
  const type = p[0];
  switch (type) {
    case 0:
      return switchCond(data, p[1], p[2] === 0);
    case 1: {
      const refs: Ref[] = [{ type: "variable", id: p[1] }];
      const op = VAR_OPS[p[4]] ?? "=";
      const testOp = VAR_TEST_OPS[p[4]] ?? "=";
      let rhs: string;
      let test: ConditionTest;
      if (p[2] === 1) {
        rhs = `변수: ${variableName(data, p[3])}`;
        refs.push({ type: "variable", id: p[3] });
        test = { kind: "variableVar", id: n(p[1]), op: testOp, otherId: n(p[3]) };
      } else {
        rhs = String(p[3]);
        test = { kind: "variable", id: n(p[1]), op: testOp, value: n(p[3]) };
      }
      return cond(`변수: ${variableName(data, p[1])} ${op} ${rhs}`, refs, test);
    }
    case 2:
      return cond(`셀프 스위치 ${p[1]} ${p[2] === 0 ? "ON" : "OFF"}`, [{ type: "selfSwitch", id: p[1] }],
        { kind: "selfSwitch", letter: String(p[1]), on: p[2] === 0 });
    case 3: {
      const s = Number(p[1]) || 0;
      return cond(`타이머 ${TIMER_OPS[p[2]] ?? "≥"} ${Math.floor(s / 60)}분 ${s % 60}초`, [], UNKNOWN);
    }
    case 4:
      return p[2] === 0
        ? partyCond(data, p[1])
        : cond(`배우: ${actorName(data, p[1])} (조건 유형 ${p[2]})`, [{ type: "actor", id: p[1] }], UNKNOWN);
    case 5:
      return p[2] === 0
        ? cond(`적 #${(Number(p[1]) || 0) + 1} 등장`, [], UNKNOWN)
        : cond(`적 #${(Number(p[1]) || 0) + 1} (조건 유형 ${p[2]})`, [], UNKNOWN);
    case 6:
      return cond(`캐릭터 ${p[1]} 방향 = ${DIRECTIONS[p[2]] ?? p[2]}`, [], UNKNOWN);
    case 7:
      return cond(`소지금 ${GOLD_OPS[p[2]] ?? "≥"} ${p[1]}${data.system?.currencyUnit ?? ""}`, [],
        { kind: "gold", op: GOLD_TEST_OPS[p[2]] ?? ">=", value: n(p[1]) });
    case 8:
      return cond(`아이템: ${itemName(data, p[1])} 보유`, [{ type: "item", id: p[1] }], { kind: "item", id: n(p[1]) });
    // p[2] = 장비 포함: 실시간 상태(소지품)만으로는 판정할 수 없다
    case 9:
      return cond(`무기: ${weaponName(data, p[1])} 보유`, [{ type: "weapon", id: p[1] }], p[2] ? UNKNOWN : { kind: "weapon", id: n(p[1]) });
    case 10:
      return cond(`방어구: ${armorName(data, p[1])} 보유`, [{ type: "armor", id: p[1] }], p[2] ? UNKNOWN : { kind: "armor", id: n(p[1]) });
    case 11:
      return cond(`버튼: ${p[1]} 누름`, [], UNKNOWN);
    case 12:
      return cond(`스크립트: ${p[1]}`, [], UNKNOWN);
    case 13:
      return cond(`탈것 ${p[1]} 탑승 중`, [], UNKNOWN);
    default:
      return cond(`알 수 없는 조건 (유형 ${type})`, [], UNKNOWN);
  }
}
