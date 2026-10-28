import type { ScriptNode } from "../types";

type Frame = { list: ScriptNode[]; i: number };
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const cmdOf = (n: ScriptNode): number | undefined => {
  const c = (n as { cmd?: unknown }).cmd;
  return typeof c === "number" && Number.isFinite(c) ? c : undefined;
};

/** 노드의 하위 블록들(문서 순서). */
function childBlocks(n: ScriptNode): ScriptNode[][] {
  switch (n.kind) {
    case "choices": {
      const out = arr<{ body: ScriptNode[] } | null>(n.branches).map(b => arr<ScriptNode>(b?.body));
      if (n.cancelBranch) out.push(arr<ScriptNode>(n.cancelBranch));
      return out;
    }
    case "conditional": return n.else ? [arr(n.then), arr(n.else)] : [arr(n.then)];
    case "loop": return [arr(n.body)];
    default: return [];
  }
}

/**
 * 실행 중 명령 인덱스 cmd 이후 남은 대본을 평탄하게 돌려준다.
 * 현재 위치 = cmd를 가진 노드 중 `cmd <= 주어진 cmd`인 문서 순서상 마지막 노드.
 * 그 노드부터 현재 블록 끝 + 바깥 블록들의 다음 노드들(다른 분기는 제외).
 * 해당 노드가 없으면 전체 nodes. 예외를 던지지 않는다.
 */
export function remainingNodes(nodes: ScriptNode[], cmd: number): ScriptNode[] {
  const all = arr<ScriptNode | null>(nodes).filter((n): n is ScriptNode => !!n && typeof n === "object");
  try {
    if (typeof cmd !== "number" || !Number.isFinite(cmd)) return all;
    const found: { path: Frame[] | null } = { path: null };
    const stack: Frame[] = [];
    const visit = (list: ScriptNode[]) => {
      list.forEach((n, i) => {
        if (!n || typeof n !== "object") return;
        stack.push({ list, i });
        const c = cmdOf(n);
        if (c !== undefined && c <= cmd) found.path = stack.slice();
        for (const block of childBlocks(n)) visit(block);
        stack.pop();
      });
    };
    visit(arr<ScriptNode>(nodes));
    const path = found.path;
    if (!path) return all;
    const out: ScriptNode[] = [];
    const clean = (l: ScriptNode[]) => l.filter(n => !!n && typeof n === "object");
    for (let k = path.length - 1; k >= 0; k--) {
      const { list, i } = path[k];
      out.push(...clean(list.slice(k === path.length - 1 ? i : i + 1)));
    }
    return out;
  } catch {
    return all;
  }
}
