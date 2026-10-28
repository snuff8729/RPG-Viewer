import type { CompareOp, ConditionTest } from "../types";
import type { EvalStatus, LiveSnapshot } from "./types";

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const has = (list: unknown, v: unknown): boolean => Array.isArray(list) && list.includes(v);
const count = (bag: unknown, id: number): number =>
  bag && typeof bag === "object" ? num((bag as Record<string, unknown>)[String(id)]) : 0;

function compare(a: number, op: CompareOp, b: number): boolean {
  switch (op) {
    case "=": return a === b;
    case ">=": return a >= b;
    case "<=": return a <= b;
    case ">": return a > b;
    case "<": return a < b;
    case "!=": return a !== b;
    default: return false;
  }
}

const status = (ok: boolean): EvalStatus => (ok ? "met" : "unmet");

/** 조건 판정. live 없음·test 없음·판정 불가 → "unknown". 예외를 던지지 않는다. */
export function evaluate(
  test: ConditionTest | undefined, live: LiveSnapshot | null, ctx: { mapId?: number; eventId?: number },
): EvalStatus {
  try {
    if (!test || !live || typeof live !== "object") return "unknown";
    switch (test.kind) {
      case "trigger": return "met";
      case "switch": return status(has(live.switches, test.id) === test.on);
      case "variable": return status(compare(count(live.variables, test.id), test.op, num(test.value)));
      case "variableVar":
        return status(compare(count(live.variables, test.id), test.op, count(live.variables, test.otherId)));
      case "selfSwitch": {
        if (ctx?.mapId === undefined || ctx.eventId === undefined) return "unknown";
        return status(has(live.selfSwitches, `${ctx.mapId},${ctx.eventId},${test.letter}`) === test.on);
      }
      case "item": return status(count(live.items, test.id) > 0);
      case "weapon": return status(count(live.weapons, test.id) > 0);
      case "armor": return status(count(live.armors, test.id) > 0);
      case "actorInParty": return status(has(live.party, test.id));
      case "gold": return status(compare(num(live.gold), test.op, num(test.value)));
      default: return "unknown";
    }
  } catch {
    return "unknown";
  }
}
