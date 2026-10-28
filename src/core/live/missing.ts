import type { Condition, GameData, GameIndex, PageEntry, ScriptNode } from "../types";
import { pickKey, seenKey } from "./coverage";
import { evaluate } from "./evaluate";
import type { Coverage, EvalStatus, LiveSnapshot, MissingItem, Requirement } from "./types";

type Ctx = { mapId?: number; eventId?: number };
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const invert = (s: EvalStatus): EvalStatus => (s === "met" ? "unmet" : s === "unmet" ? "met" : "unknown");

function pageCtx(entry: PageEntry): Ctx {
  const loc = entry.location;
  return loc.source === "map" ? { mapId: loc.mapId, eventId: loc.eventId } : {};
}

function pageRequirements(entry: PageEntry, live: LiveSnapshot | null, ctx: Ctx): Requirement[] {
  return arr<Condition | null>(entry.conditions)
    .filter((c): c is Condition => !!c && typeof c === "object" && c.test?.kind !== "trigger")
    .map(c => ({ text: String(c.text ?? ""), status: evaluate(c.test, live, ctx) }));
}

const isUnseen = (n: ScriptNode, entry: PageEntry, cov: Coverage) =>
  (n.kind === "message" || n.kind === "scroll") && !cov.seen.has(seenKey(entry.location, n.cmd));

function comparePaths(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/** 안 고른 선택지 항목 + 안 본 대사가 있는 페이지. 예외를 던지지 않는다. */
export function computeMissing(index: GameIndex, data: GameData, coverage: Coverage, live: LiveSnapshot | null): MissingItem[] {
  const templateMapId = data?.templateMapId;
  const out: { item: MissingItem; order: number }[] = [];
  const pages = arr<PageEntry | null>(index?.pages);
  pages.forEach((entry, order) => {
    try {
      if (!entry || typeof entry !== "object" || !entry.location) return;
      // 템플릿 맵(TemplateEvent)의 이벤트는 실제 맵에 풀려 들어가므로 따로 세지 않는다.
      if (templateMapId !== undefined && entry.location.source === "map" && entry.location.mapId === templateMapId) return;
      const ctx = pageCtx(entry);
      const base = pageRequirements(entry, live, ctx);
      const onCurrentMap = !!live && entry.location.source === "map" && live.mapId === entry.location.mapId;
      const push = (kind: MissingItem["kind"], nodePath: number[], label: string, extra: Requirement[]) => {
        const requirements = [...base, ...extra];
        const allMet = requirements.every(r => r.status === "met");
        out.push({ item: { kind, entry, nodePath, label, requirements, onCurrentMap, allMet }, order });
      };
      let pageFound = false;

      /** inChoice: 선택지 분기 안이면 "page" 항목 후보에서 제외. */
      const visit = (nodes: ScriptNode[], prefix: number[], reqs: Requirement[], inChoice: boolean) => {
        arr<ScriptNode | null>(nodes).forEach((n, i) => {
          if (!n || typeof n !== "object") return;
          const path = [...prefix, i];
          switch (n.kind) {
            case "message": case "scroll":
              if (!inChoice && !pageFound && isUnseen(n, entry, coverage)) {
                pageFound = true;
                push("page", path, arr<string>(n.lines)[0] ?? "", reqs);
              }
              break;
            case "choices": {
              const picked = new Set(arr<{ picked: number }>(coverage.picks.get(pickKey(entry.location, n.cmd))).map(p => p?.picked));
              arr<{ label: string; body: ScriptNode[] } | null>(n.branches).forEach((b, bi) => {
                if (!b) return;
                if (!picked.has(bi)) push("choice", [...path, bi], `"${b.label}"`, reqs);
                visit(b.body, [...path, bi], [...reqs, { text: `선택지 "${b.label}" 선택`, status: "unknown" }], true);
              });
              if (n.cancelBranch) {
                if (!picked.has(-2)) push("choice", [...path, -1], "취소했을 때", reqs);
                visit(n.cancelBranch, [...path, -1], [...reqs, { text: "취소했을 때", status: "unknown" }], true);
              }
              break;
            }
            case "conditional": {
              const text = String(n.condition?.text ?? "");
              const s = evaluate(n.condition?.test, live, ctx);
              visit(n.then, [...path, 0], [...reqs, { text, status: s }], inChoice);
              if (n.else) visit(n.else, [...path, 1], [...reqs, { text: `아니라면: ${text}`, status: invert(s) }], inChoice);
              break;
            }
            case "loop":
              visit(n.body, [...path, 0], reqs, inChoice);
              break;
          }
        });
      };
      visit(entry.nodes, [], [], false);
    } catch {
      /* 이상한 페이지는 건너뛴다 */
    }
  });

  // "page" 항목은 첫 안 본 대사를 고르기 위해 순회 순서(pre-order)로 찾았다. 정렬은 nodePath 사전순.
  out.sort((a, b) =>
    Number(b.item.onCurrentMap) - Number(a.item.onCurrentMap)
    || Number(b.item.allMet) - Number(a.item.allMet)
    || a.order - b.order
    || comparePaths(a.item.nodePath, b.item.nodePath));
  return out.map(o => o.item);
}
