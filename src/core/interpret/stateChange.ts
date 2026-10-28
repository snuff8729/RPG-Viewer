import type { EventCommand, GameData, Ref, ScriptNode } from "../types";
import { actorName, armorName, itemName, switchName, variableName, weaponName } from "../text/names";

type StateChange = Extract<ScriptNode, { kind: "stateChange" }>;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const OPS = ["=", "+=", "-=", "*=", "/=", "%="];

/** "숲 개방" for a single id, "#1~#3" for a range; refs cover every id (capped to stay bounded). */
function range(start: number, end: number, type: "switch" | "variable", name: (id: number) => string) {
  const lo = Math.min(start, end), hi = Math.max(start, end);
  const label = lo === hi ? name(lo) : `#${lo}~#${hi}`;
  const refs: Ref[] = [];
  for (let id = lo; id <= hi && refs.length < 1000; id++) refs.push({ type, id });
  return { label, refs };
}

/** Constant or variable operand (used by gold/items/weapons/armors). */
function amount(data: GameData, operandType: unknown, operand: unknown, refs: Ref[]): string {
  if (operandType === 1) {
    refs.push({ type: "variable", id: num(operand) });
    return `[변수: ${variableName(data, num(operand))}]`;
  }
  return String(num(operand));
}

function variableOperand(data: GameData, p: any[], refs: Ref[]): string {
  switch (p[3]) {
    case 0: return String(num(p[4]));
    case 1: refs.push({ type: "variable", id: num(p[4]) }); return `[변수: ${variableName(data, num(p[4]))}]`;
    case 2: return `랜덤 ${num(p[4])}~${num(p[5])}`;
    case 3: return "(게임 데이터)";
    default: return "(스크립트)";
  }
}

/** Describes codes 121-129; returns null for anything else. Never throws. */
export function describeStateChange(cmd: EventCommand, data: GameData): StateChange | null {
  const p: any[] = Array.isArray(cmd.parameters) ? cmd.parameters : [];
  const node = (target: StateChange["target"], description: string, refs: Ref[]): StateChange =>
    ({ kind: "stateChange", target, description, refs });
  switch (cmd.code) {
    case 121: {
      const r = range(num(p[0]), num(p[1]), "switch", id => switchName(data, id));
      return node("switch", `스위치 ${r.label} → ${p[2] === 0 ? "ON" : "OFF"}`, r.refs);
    }
    case 122: {
      const r = range(num(p[0]), num(p[1]), "variable", id => variableName(data, id));
      const refs = [...r.refs];
      const operand = variableOperand(data, p, refs);
      return node("variable", `변수 ${r.label} ${OPS[num(p[2])] ?? "="} ${operand}`, refs);
    }
    case 123: {
      const letter = String(p[0] ?? "A");
      return node("selfSwitch", `셀프 스위치 ${letter} → ${p[1] === 0 ? "ON" : "OFF"}`, [{ type: "selfSwitch", id: letter }]);
    }
    case 125: {
      const refs: Ref[] = [];
      const v = amount(data, p[1], p[2], refs);
      return node("gold", `소지금 ${p[0] === 1 ? "-" : "+"}${v}G`, refs);
    }
    case 126: case 127: case 128: {
      const id = num(p[0]);
      const [target, label, name] =
        cmd.code === 126 ? ["item", "아이템", itemName(data, id)] as const
        : cmd.code === 127 ? ["weapon", "무기", weaponName(data, id)] as const
        : ["armor", "방어구", armorName(data, id)] as const;
      const refs: Ref[] = [{ type: target, id }];
      const v = amount(data, p[2], p[3], refs);
      return node(target, `${label} ${name} ${p[1] === 1 ? "-" : "+"}${v}`, refs);
    }
    case 129: {
      const id = num(p[0]);
      const name = actorName(data, id);
      return node("party", p[1] === 1 ? `파티에서 ${name} 제외` : `파티에 ${name} 추가`, [{ type: "actor", id }]);
    }
    default:
      return null;
  }
}
