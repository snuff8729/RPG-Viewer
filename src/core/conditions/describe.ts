import type { Condition, CommonEvent, GameData, PageConditions, Ref, TroopPageConditions } from "../types";
import { actorName, armorName, itemName, switchName, variableName, weaponName } from "../text/names";

const TRIGGERS = ["결정 키", "플레이어 접촉", "이벤트 접촉", "자동 실행", "병렬 처리"];
const SPANS = ["전투", "턴", "순간"];
const VAR_OPS = ["=", "≥", "≤", ">", "<", "≠"];
const GOLD_OPS = ["≥", "≤", "<"];
const TIMER_OPS = ["≥", "≤"];
const DIRECTIONS: Record<number, string> = { 2: "아래", 4: "왼쪽", 6: "오른쪽", 8: "위" };

const cond = (text: string, refs: Ref[] = []): Condition => ({ text, refs });
const switchCond = (data: GameData, id: number, on = true): Condition =>
  cond(`스위치: ${switchName(data, id)} ${on ? "ON" : "OFF"}`, [{ type: "switch", id }]);
const partyCond = (data: GameData, id: number): Condition =>
  cond(`파티에 ${actorName(data, id)} 있음`, [{ type: "actor", id }]);
const triggerCond = (t: number): Condition => cond(`실행: ${TRIGGERS[t] ?? `트리거 ${t}`}`);

export function describePageConditions(c: PageConditions, trigger: number, data: GameData): Condition[] {
  const out: Condition[] = [];
  if (c.switch1Valid) out.push(switchCond(data, c.switch1Id));
  if (c.switch2Valid) out.push(switchCond(data, c.switch2Id));
  if (c.variableValid) {
    out.push(cond(`변수: ${variableName(data, c.variableId)} ≥ ${c.variableValue}`, [{ type: "variable", id: c.variableId }]));
  }
  if (c.selfSwitchValid) out.push(cond(`셀프 스위치 ${c.selfSwitchCh} ON`, [{ type: "selfSwitch", id: c.selfSwitchCh }]));
  if (c.itemValid) out.push(cond(`아이템: ${itemName(data, c.itemId)} 보유`, [{ type: "item", id: c.itemId }]));
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
  if (c.turnEnding) out.push(cond("턴 종료 시"));
  if (c.turnValid) out.push(cond(`턴: ${c.turnA} + ${c.turnB}×X`));
  if (c.enemyValid) out.push(cond(`적 #${c.enemyIndex + 1} HP ≤ ${c.enemyHp}%`));
  if (c.actorValid) out.push(cond(`${actorName(data, c.actorId)} HP ≤ ${c.actorHp}%`, [{ type: "actor", id: c.actorId }]));
  if (c.switchValid) out.push(switchCond(data, c.switchId));
  out.push(cond(`범위: ${SPANS[span] ?? span}`));
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
      let rhs: string;
      if (p[2] === 1) {
        rhs = `변수: ${variableName(data, p[3])}`;
        refs.push({ type: "variable", id: p[3] });
      } else rhs = String(p[3]);
      return cond(`변수: ${variableName(data, p[1])} ${op} ${rhs}`, refs);
    }
    case 2:
      return cond(`셀프 스위치 ${p[1]} ${p[2] === 0 ? "ON" : "OFF"}`, [{ type: "selfSwitch", id: p[1] }]);
    case 3: {
      const s = Number(p[1]) || 0;
      return cond(`타이머 ${TIMER_OPS[p[2]] ?? "≥"} ${Math.floor(s / 60)}분 ${s % 60}초`);
    }
    case 4:
      return p[2] === 0
        ? partyCond(data, p[1])
        : cond(`배우: ${actorName(data, p[1])} (조건 유형 ${p[2]})`, [{ type: "actor", id: p[1] }]);
    case 5:
      return p[2] === 0
        ? cond(`적 #${(Number(p[1]) || 0) + 1} 등장`)
        : cond(`적 #${(Number(p[1]) || 0) + 1} (조건 유형 ${p[2]})`);
    case 6:
      return cond(`캐릭터 ${p[1]} 방향 = ${DIRECTIONS[p[2]] ?? p[2]}`);
    case 7:
      return cond(`소지금 ${GOLD_OPS[p[2]] ?? "≥"} ${p[1]}${data.system?.currencyUnit ?? ""}`);
    case 8:
      return cond(`아이템: ${itemName(data, p[1])} 보유`, [{ type: "item", id: p[1] }]);
    case 9:
      return cond(`무기: ${weaponName(data, p[1])} 보유`, [{ type: "weapon", id: p[1] }]);
    case 10:
      return cond(`방어구: ${armorName(data, p[1])} 보유`, [{ type: "armor", id: p[1] }]);
    case 11:
      return cond(`버튼: ${p[1]} 누름`);
    case 12:
      return cond(`스크립트: ${p[1]}`);
    case 13:
      return cond(`탈것 ${p[1]} 탑승 중`);
    default:
      return cond(`알 수 없는 조건 (유형 ${type})`);
  }
}
