import { testToReq, type Req } from "../deps/graph";
import { flattenCalls, type CallCtx } from "../interpret/teCall";
import { formatText } from "../text/escape";
import type { CompareOp, ConditionTest, GameData, Location, MapEvent, PageEntry, ScriptNode } from "../types";
import { seenKey } from "./coverage";
import { evaluate } from "./evaluate";
import { writesCanMake } from "./repeat";
import type { Coverage, LiveSnapshot } from "./types";

/** 지금 페이지에서 아직 안 본 대사 한 줄과 거기까지 가는 길. */
export interface RemainingLine {
  /** 첫 줄(제어 문자 뺌, 최대 60자) */
  text: string;
  /** 페이지 처음부터: 고를 선택지·지나야 할 조건(`선택지 「X」 고르기`, `조건: …`, `조건이 아닐 때: …`) */
  how: string[];
  /** 지금은 거짓인 조건이 필요해 지금은 못 봄(나중에). needs: 그 조건들(req는 만드는 법을 찾을 수 있을 때만) */
  needs?: { text: string; req?: Req }[];
}
type Need = { text: string; req?: Req };
export interface RemainingContent {
  /** 지금 볼 수 있는 남은 대사(최대 3개)와 전체 수 */
  now: RemainingLine[]; nowCount: number;
  /** 조건이 맞으면 볼 수 있는 대사(최대 3개)와 전체 수 */
  later: RemainingLine[]; laterCount: number;
}

export const REMAINING_MAX = 3;
const TEXT_MAX = 60;
const EMPTY: RemainingContent = { now: [], nowCount: 0, later: [], laterCount: 0 };
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object";

const NEG: Record<CompareOp, CompareOp> = { "=": "!=", "!=": "=", ">=": "<", "<": ">=", "<=": ">", ">": "<=" };
/** 조건이 아닐 때(else 갈래)를 뜻하는 test. 뒤집을 수 없으면 undefined */
function negate(t: ConditionTest | undefined): ConditionTest | undefined {
  if (!t) return undefined;
  switch (t.kind) {
    case "switch": case "selfSwitch": return { ...t, on: !t.on };
    case "variable": case "variableVar": return { ...t, op: NEG[t.op] ?? t.op };
    default: return undefined;
  }
}

function firstLine(n: ScriptNode, data: GameData): string {
  const line = arr<unknown>((n as { lines?: unknown }).lines)
    .map(l => (typeof l === "string" ? formatText(l, data).trim() : "")).find(Boolean) ?? "";
  if (!line) return "(글 없음)";
  return line.length > TEXT_MAX ? `${line.slice(0, TEXT_MAX)}…` : line;
}

/**
 * 페이지(TemplateEvent로 부른 목록 포함)의 안 본 대사를, 처음부터 거기까지 가는 길(선택지·조건)과 함께 모은다.
 * 길에 있는 조건은 live로 판정한다: 지금 맞으면 지금 볼 수 있음, 판정할 수 없으면 볼 수 있다고 보고 `조건 확인 불가`,
 * 지금 틀렸지만 이 페이지가 스스로 맞게 만들면(`1146 += 1` 등) `한 번 더 하면`으로 볼 수 있음, 그 밖에는 나중에(later).
 * 예외를 던지지 않는다.
 */
export function remainingLines(
  entry: PageEntry | null, coverage: Coverage, data: GameData, live: LiveSnapshot, ev: MapEvent, mapId: number, page: number,
): RemainingContent {
  try {
    if (!isObj(entry) || !isObj(coverage) || !(coverage.seen instanceof Set)) return EMPTY;
    const out: RemainingContent = { now: [], nowCount: 0, later: [], laterCount: 0 };
    const self = { mapId, eventId: ev.id };
    let writes: unknown[] | null = null;
    const pageWrites = () => {
      if (!writes) {
        const ctx: CallCtx = { data, mapId, event: ev, page };
        writes = flattenCalls(ev.pages?.[page]?.list, ctx);
      }
      return writes;
    };
    const visit = (nodes: unknown, loc: Location, how: string[], needs: Need[]) => {
      for (const n of arr<ScriptNode | null>(nodes)) {
        if (!isObj(n)) continue;
        switch (n.kind) {
          case "message": case "scroll": {
            if (coverage.seen.has(seenKey(loc, n.cmd))) break;
            const line: RemainingLine = { text: firstLine(n, data), how: [...how] };
            if (needs.length > 0) {
              line.needs = [...needs];
              if (out.later.length < REMAINING_MAX) out.later.push(line);
              out.laterCount++;
            } else {
              if (out.now.length < REMAINING_MAX) out.now.push(line);
              out.nowCount++;
            }
            break;
          }
          case "choices":
            arr<{ label?: unknown; body: ScriptNode[] } | null>(n.branches).forEach(b => {
              if (isObj(b)) visit(b.body, loc, [...how, `선택지 「${String(b.label ?? "")}」 고르기`], needs);
            });
            if (n.cancelBranch) visit(n.cancelBranch, loc, [...how, "선택지 취소하기"], needs);
            break;
          case "conditional": {
            const cond: { text?: unknown; test?: ConditionTest } = isObj(n.condition) ? n.condition : {};
            const text = String(cond.text ?? "?");
            const test = cond.test;
            const branch = (body: unknown, want: "met" | "unmet", label: string) => {
              const status = test && test.kind !== "unknown" ? evaluate(test, live, self) : "unknown";
              if (status === "unknown") return visit(body, loc, [...how, `${label} (조건 확인 불가)`], needs);
              if (status === want) return visit(body, loc, [...how, label], needs);
              if (writesCanMake(pageWrites(), live, mapId, ev.id, data, test, want)) {
                return visit(body, loc, [...how, `한 번 더 하면 — ${label}`], needs);
              }
              const need: Need = { text: label };
              const req = testToReq(want === "met" ? test : negate(test), self);
              if (req) need.req = req;
              visit(body, loc, [...how, label], [...needs, need]);
            };
            branch(n.then, "met", `조건: ${text}`);
            if (n.else) branch(n.else, "unmet", `조건이 아닐 때: ${text}`);
            break;
          }
          case "loop":
            visit(n.body, loc, how, needs);
            break;
          case "call":
            if (isObj(n.location)) visit(n.nodes, n.location, how, needs);
            break;
        }
      }
    };
    visit(entry.nodes, entry.location, [], []);
    return out;
  } catch {
    return EMPTY;
  }
}
