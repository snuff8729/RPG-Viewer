import type { EventCommand, ScriptNode } from "../types";

type Frame = { list: ScriptNode[]; i: number };
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const cmdOf = (n: ScriptNode): number | undefined => {
  const c = (n as { cmd?: unknown }).cmd;
  return typeof c === "number" && Number.isFinite(c) ? c : undefined;
};
const isNode = (n: unknown): n is ScriptNode => !!n && typeof n === "object";
const clean = (l: ScriptNode[]) => l.filter(isNode);
/** 메시지·스크롤 노드가 차지하는 본문 줄 명령 수(화자로 옮긴 ADVTalkSystem 이름 줄 포함). */
const bodyCmds = (n: ScriptNode): number =>
  n.kind === "message" ? arr(n.lines).length + (n.nameLine ? 1 : 0) : n.kind === "scroll" ? arr(n.lines).length : 0;

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
 * 시작 노드가 선택지이고 바로 앞 형제가 그 질문 메시지(메시지 cmd + 1 + 줄 수 === 선택지 cmd)면
 * 메시지 위치를, 아니면 i를 돌려준다. 예외를 던지지 않는다.
 */
export function inlineQuestionStart(list: ScriptNode[], i: number): number {
  const n = list[i];
  const prev = i > 0 ? list[i - 1] : undefined;
  if (!isNode(n) || n.kind !== "choices" || !isNode(prev) || prev.kind !== "message") return i;
  const pc = cmdOf(prev);
  return pc !== undefined && pc + 1 + bodyCmds(prev) === n.cmd ? i - 1 : i;
}

// ── 원본 명령 목록의 블록 구조 (interpret의 parseBlock과 같은 규칙) ──────────────

type StructKind = "choices" | "conditional" | "loop";
type SubKey = number | "cancel" | "then" | "else" | "body";
/** 블록 내용의 원본 인덱스 범위 [from, to) */
type RawBlock = { from: number; to: number; structs: RawStruct[] };
/** open: 여는 명령(102/111/112), close: 마지막으로 소비한 명령(404/412/413 등) */
type RawStruct = { kind: StructKind; open: number; close: number; subs: { key: SubKey; marker: number; block: RawBlock }[] };

function parseRaw(list: EventCommand[]): RawBlock {
  const cmds: EventCommand[] = [];
  const src: number[] = [];
  list.forEach((c, i) => { if (c && typeof c === "object") { cmds.push(c); src.push(i); } });
  const indentOf = (c: EventCommand): number => (typeof c?.indent === "number" ? c.indent : 0);
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const params = (c: EventCommand): unknown[] => (Array.isArray(c?.parameters) ? c.parameters : []);
  let pos = 0;
  const here = () => (pos < cmds.length ? src[pos] : list.length);
  const take = (code: number, indent: number): EventCommand | undefined => {
    const c = cmds[pos];
    if (c && c.code === code && indentOf(c) === indent) { pos++; return c; }
    return undefined;
  };
  const skipLines = (code: number) => { while (pos < cmds.length && cmds[pos].code === code) pos++; };

  function block(indent: number): RawBlock {
    const b: RawBlock = { from: here(), to: 0, structs: [] };
    for (let c = cmds[pos]; c && indentOf(c) >= indent; c = cmds[pos]) {
      const open = src[pos];
      pos++;
      const at = indentOf(c);
      if (c.code === 101) skipLines(401);
      else if (c.code === 105) skipLines(405);
      else if (c.code === 102) {
        const s: RawStruct = { kind: "choices", open, close: open, subs: [] };
        let count = arr(params(c)[0]).length;
        for (;;) {
          const marker = here();
          const br = take(402, at);
          if (br) {
            const i = num(params(br)[0]);
            // interpret: 범위 밖 번호는 새 분기로 뒤에 붙는다
            const key = Number.isInteger(i) && i >= 0 && i < count ? i : count++;
            s.subs.push({ key, marker, block: block(at + 1) });
            continue;
          }
          if (take(403, at)) { s.subs.push({ key: "cancel", marker, block: block(at + 1) }); continue; }
          take(404, at);
          break;
        }
        s.close = src[pos - 1];
        b.structs.push(s);
      } else if (c.code === 111) {
        const s: RawStruct = { kind: "conditional", open, close: open, subs: [{ key: "then", marker: open, block: block(at + 1) }] };
        const marker = here();
        if (take(411, at)) s.subs.push({ key: "else", marker, block: block(at + 1) });
        take(412, at);
        s.close = src[pos - 1];
        b.structs.push(s);
      } else if (c.code === 112) {
        const s: RawStruct = { kind: "loop", open, close: open, subs: [{ key: "body", marker: open, block: block(at + 1) }] };
        take(413, at);
        s.close = src[pos - 1];
        b.structs.push(s);
      }
    }
    b.to = here();
    return b;
  }
  return block(-Infinity);
}

/** 원본 위치 p가 들어 있는 가장 안쪽 블록과 그 안에서의 위치 */
type Step = { k: number; key: SubKey; atStart: boolean };
type At = { mode: "on" | "after"; k: number } | { mode: "in" };
type Where = { steps: Step[]; at: At };

function locate(b: RawBlock, p: number, steps: Step[] = []): Where {
  for (let k = 0; k < b.structs.length; k++) {
    const s = b.structs[k];
    if (p === s.open) return { steps, at: { mode: "on", k } };
    for (const sub of s.subs) {
      if (p === sub.marker && sub.marker !== s.open) {
        return { steps: [...steps, { k, key: sub.key, atStart: true }], at: { mode: "in" } };
      }
      if (p >= sub.block.from && p < sub.block.to) {
        return locate(sub.block, p, [...steps, { k, key: sub.key, atStart: false }]);
      }
    }
    if (p > s.open && p <= s.close) return { steps, at: { mode: "after", k } };
  }
  return { steps, at: { mode: "in" } };
}

const STRUCT = new Set<string>(["choices", "conditional", "loop"]);
const structIndexes = (l: ScriptNode[]) => l.flatMap((n, i) => (STRUCT.has(n.kind) ? [i] : []));

class Mismatch extends Error {}

function subBlockOf(n: ScriptNode, kind: StructKind, key: SubKey): ScriptNode[] {
  if (n.kind !== kind) throw new Mismatch();
  if (n.kind === "choices") {
    if (key === "cancel") return clean(arr(n.cancelBranch));
    if (typeof key !== "number") throw new Mismatch();
    const br = arr<{ body: ScriptNode[] } | null>(n.branches)[key];
    if (!br) throw new Mismatch();
    return clean(arr(br.body));
  }
  if (n.kind === "conditional") return clean(arr(key === "else" ? n.else : n.then));
  if (n.kind === "loop") return clean(arr(n.body));
  throw new Mismatch();
}

/** 원본 목록 구조로 남은 대본을 구한다. 구조가 맞지 않으면 예외(호출자가 잡아 기존 방식으로). */
function remainingByList(nodes: ScriptNode[], p: number, list: EventCommand[]): ScriptNode[] {
  const root = parseRaw(list);
  if (p < root.from || p >= root.to) throw new Mismatch();
  const where = locate(root, p);
  // 바깥 → 안쪽으로 실제 노드 블록을 따라간다
  let raw = root;
  let real = clean(nodes);
  const tails: ScriptNode[][] = [];
  for (const st of where.steps) {
    const rs = raw.structs[st.k];
    const idx = structIndexes(real)[st.k];
    if (!rs || idx === undefined) throw new Mismatch();
    tails.push(real.slice(idx + 1));
    real = subBlockOf(real[idx], rs.kind, st.key);
    const sub = rs.subs.find(s => s.key === st.key);
    if (!sub) throw new Mismatch();
    raw = sub.block;
  }
  const sIdx = structIndexes(real);
  if (sIdx.length !== raw.structs.length) throw new Mismatch();

  const at = where.at;
  const last = where.steps[where.steps.length - 1];
  let start = 0;
  if (at.mode === "on") start = sIdx[at.k];
  else if (at.mode === "after") start = sIdx[at.k] + 1;
  else if (last?.atStart) start = 0;
  else {
    const term = list[raw.to - 1];
    if (raw.to > raw.from && p === raw.to - 1 && isNode(term as unknown) && term.code === 0) {
      start = real.length; // 블록 끝(코드 0) → 이 블록에는 남은 것이 없다
    } else {
      // p 이하에서 시작한 마지막 노드: p가 그 범위 안이면 그 노드부터, 지났으면 다음 노드부터
      let structK = 0;
      real.forEach((n, j) => {
        let from: number | undefined;
        let to: number | undefined;
        if (STRUCT.has(n.kind)) {
          const rs = raw.structs[structK++];
          from = rs?.open;
          to = rs?.close;
        } else {
          from = cmdOf(n);
          if (from !== undefined) {
            to = from + bodyCmds(n);
          }
        }
        if (from !== undefined && to !== undefined && from <= p) start = p <= to ? j : j + 1;
      });
    }
  }
  start = inlineQuestionStart(real, start);
  const out = real.slice(start);
  for (let k = tails.length - 1; k >= 0; k--) out.push(...tails[k]);
  return out;
}

/**
 * 실행 중 명령 인덱스 cmd 이후 남은 대본을 평탄하게 돌려준다.
 * list(그 페이지의 원본 명령 목록)가 있으면 그 구조(들여쓰기·402/403/404/411/412/413)로
 * cmd가 들어 있는 분기를 찾아, 그 분기의 남은 노드 + 바깥 블록들의 다음 노드들을 돌려준다.
 * 노드가 없는 명령(대기·페이드 등)에 있으면 이미 지난 노드의 다음부터 시작한다.
 * list가 없거나 구조가 맞지 않으면: 현재 위치 = cmd를 가진 노드 중 `cmd <= 주어진 cmd`인
 * 문서 순서상 마지막 노드, 그 노드부터 현재 블록 끝 + 바깥 블록들의 다음 노드들(다른 분기는 제외).
 * 어느 쪽이든 시작이 선택지이고 바로 앞이 그 질문 메시지면 메시지부터.
 * 해당 노드가 없으면 전체 nodes. 예외를 던지지 않는다.
 */
export function remainingNodes(nodes: ScriptNode[], cmd: number, list?: EventCommand[]): ScriptNode[] {
  const all = arr<ScriptNode | null>(nodes).filter(isNode);
  try {
    if (typeof cmd !== "number" || !Number.isFinite(cmd)) return all;
    if (Array.isArray(list) && list.length > 0) {
      try {
        return remainingByList(arr<ScriptNode>(nodes), cmd, list);
      } catch {
        /* 구조 불일치 → 기존 방식 */
      }
    }
    const found: { path: Frame[] | null } = { path: null };
    const stack: Frame[] = [];
    const visit = (l: ScriptNode[]) => {
      l.forEach((n, i) => {
        if (!isNode(n)) return;
        stack.push({ list: l, i });
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
    for (let k = path.length - 1; k >= 0; k--) {
      const { list: l, i } = path[k];
      const from = k === path.length - 1 ? inlineQuestionStart(l, i) : i + 1;
      out.push(...clean(l.slice(from)));
    }
    return out;
  } catch {
    return all;
  }
}

export type Stop = { kind: "choices"; node: ScriptNode } | { kind: "transfer"; node: ScriptNode };

/** 최상위에서 첫 choices/transfer 직전까지. 멈춤 노드는 nodes에 포함하지 않는다. */
export function untilStop(nodes: ScriptNode[]): { nodes: ScriptNode[]; stop: Stop | null } {
  const out: ScriptNode[] = [];
  for (const n of arr<ScriptNode | null>(nodes)) {
    if (!isNode(n)) continue;
    if (n.kind === "choices") return { nodes: out, stop: { kind: "choices", node: n } };
    if (n.kind === "transfer") return { nodes: out, stop: { kind: "transfer", node: n } };
    out.push(n);
  }
  return { nodes: out, stop: null };
}

/** 문서 순서상 첫 message(하위 블록 포함). */
export function firstMessage(nodes: ScriptNode[]): ScriptNode | null {
  for (const n of arr<ScriptNode | null>(nodes)) {
    if (!isNode(n)) continue;
    if (n.kind === "message") return n;
    for (const b of childBlocks(n)) {
      const m = firstMessage(b);
      if (m) return m;
    }
  }
  return null;
}
