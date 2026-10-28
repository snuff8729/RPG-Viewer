import type { EventCommand, GameData, ScriptNode } from "../types";
import { formatText } from "../text/escape";
import { describeBranchCondition } from "../conditions/describe";
import { describeStateChange } from "./stateChange";

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const params = (c: EventCommand): any[] => (Array.isArray(c?.parameters) ? c.parameters : []);
/** 이름 상자 코드: \n<X>, \nl<X>, \nc<X>, \nr<X> (대소문자 무시). X에는 \N[1] 같은 코드가 올 수 있다. */
const NAME_BOX = /^\\n[lcr]?<([^<>]*)>/i;
const indentOf =(c: EventCommand): number => (typeof c?.indent === "number" ? c.indent : 0);

/**
 * Converts an RPG Maker event command list into a ScriptNode tree.
 * Cursor-based recursive descent; never throws. Unrecognised or orphaned commands
 * are kept in `other` nodes (consecutive ones grouped together).
 */
export function interpret(list: EventCommand[], data: GameData): ScriptNode[] {
  const cmds = Array.isArray(list) ? list.filter(c => c && typeof c === "object") : [];
  let pos = 0;

  const peek = (): EventCommand | undefined => cmds[pos];
  /** Consumes the next command if it is `code` at exactly `indent`. */
  const take = (code: number, indent: number): EventCommand | undefined => {
    const c = cmds[pos];
    if (c && c.code === code && indentOf(c) === indent) { pos++; return c; }
    return undefined;
  };
  /** 연속된 `code` 줄을 서식화한다. firstRaw가 있으면 첫 줄 원문 대신 쓴다. */
  const textLines = (code: number, firstRaw?: string): string[] => {
    const lines: string[] = [];
    while (pos < cmds.length && cmds[pos].code === code) {
      const raw = lines.length === 0 && firstRaw !== undefined ? firstRaw : str(params(cmds[pos])[0]);
      pos++;
      lines.push(formatText(raw, data));
    }
    return lines;
  };

  function message(c: EventCommand): ScriptNode {
    const p = params(c);
    const faceName = str(p[0]);
    const faceIndex = num(p[1]);
    const node: Extract<ScriptNode, { kind: "message" }> = { kind: "message", lines: [] };
    if (faceName) node.face = { name: faceName, index: faceIndex };
    let speaker = data.engine === "MZ" && str(p[4]) ? formatText(str(p[4]), data) : "";
    // MV 이름 상자 플러그인(YEP_MessageCore 등): 첫 줄 맨 앞의 \n<X> / \nl<X> / \nc<X> / \nr<X>.
    // \N[n](액터 이름)과는 꺾쇠로 구분된다. MZ 화자 이름이 있으면 코드만 지운다.
    // 원본 명령은 건드리지 않고, 첫 줄을 고친 문자열로만 서식화한다.
    let firstLine: string | undefined;
    const first = cmds[pos];
    if (first && first.code === 401) {
      const raw = str(params(first)[0]);
      const m = NAME_BOX.exec(raw);
      if (m) {
        if (!speaker) speaker = formatText(m[1], data);
        firstLine = raw.slice(m[0].length);
      }
    }
    if (!speaker && faceName) {
      const actor = (data.actors ?? []).find(a => a && a.faceName === faceName && a.faceIndex === faceIndex);
      speaker = actor?.name ?? "";
    }
    if (speaker) node.speaker = speaker;
    node.lines = textLines(401, firstLine);
    return node;
  }

  function choices(c: EventCommand, indent: number): ScriptNode {
    const labels: unknown[] = Array.isArray(params(c)[0]) ? params(c)[0] : [];
    const node: Extract<ScriptNode, { kind: "choices" }> = {
      kind: "choices",
      branches: labels.map(l => ({ label: formatText(str(l), data), body: [] as ScriptNode[] })),
    };
    for (;;) {
      const branch = take(402, indent);
      if (branch) {
        const i = num(params(branch)[0]);
        const body = parseBlock(indent + 1);
        if (node.branches[i]) node.branches[i].body = body;
        else node.branches.push({ label: formatText(str(params(branch)[1]), data), body });
        continue;
      }
      if (take(403, indent)) { node.cancelBranch = parseBlock(indent + 1); continue; }
      take(404, indent);
      return node;
    }
  }

  function conditional(c: EventCommand, indent: number): ScriptNode {
    const node: Extract<ScriptNode, { kind: "conditional" }> = {
      kind: "conditional",
      condition: describeBranchCondition(params(c), data),
      then: parseBlock(indent + 1),
    };
    if (take(411, indent)) node.else = parseBlock(indent + 1);
    take(412, indent);
    return node;
  }

  function loop(indent: number): ScriptNode {
    const body = parseBlock(indent + 1);
    take(413, indent);
    return { kind: "loop", body };
  }

  function parseBlock(indent: number): ScriptNode[] {
    const out: ScriptNode[] = [];
    let other: Extract<ScriptNode, { kind: "other" }> | null = null;
    const push = (n: ScriptNode) => { out.push(n); other = null; };

    for (let c = peek(); c && indentOf(c) >= indent; c = peek()) {
      pos++;
      const at = indentOf(c);
      switch (c.code) {
        case 0: continue;
        case 101: push(message(c)); continue;
        case 105: push({ kind: "scroll", lines: textLines(405) }); continue;
        case 102: push(choices(c, at)); continue;
        case 111: push(conditional(c, at)); continue;
        case 112: push(loop(at)); continue;
        case 117: push({ kind: "commonEvent", commonEventId: num(params(c)[0]) }); continue;
        case 201: {
          const p = params(c);
          push(p[0] === 0 ? { kind: "transfer", mapId: num(p[1]), x: num(p[2]), y: num(p[3]) } : { kind: "transfer", mapId: null });
          continue;
        }
        case 231: {
          const name = str(params(c)[1]);
          if (name) { push({ kind: "picture", pictureId: num(params(c)[0]), name }); continue; }
          break;
        }
        default: {
          const sc = describeStateChange(c, data);
          if (sc) { push(sc); continue; }
        }
      }
      if (!other) { other = { kind: "other", commands: [] }; out.push(other); }
      other.commands.push(c);
    }
    return out;
  }

  // Top level accepts every indent (even negative/garbage), so nothing is dropped.
  return parseBlock(-Infinity);
}

/** True when the tree (including nested blocks) contains message, scroll or choices. */
export function hasDialogue(nodes: ScriptNode[]): boolean {
  return nodes.some(n => {
    switch (n.kind) {
      case "message": case "scroll": case "choices": return true;
      case "conditional": return hasDialogue(n.then) || hasDialogue(n.else ?? []);
      case "loop": return hasDialogue(n.body);
      default: return false;
    }
  });
}
