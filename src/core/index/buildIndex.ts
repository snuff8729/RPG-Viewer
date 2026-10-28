import { describeCommonEventConditions, describePageConditions, describeTroopPageConditions } from "../conditions/describe";
import { hasDialogue, interpret } from "../interpret/interpret";
import type { EventCommand, GameData, GameIndex, PageEntry, Ref, ScriptNode, SearchHit, XrefEntry } from "../types";

const GENERIC_NAME = /^EV\d+$/;
const refKey = (r: Ref) => `${r.type}:${r.id}`;

/** 노드 하위 블록과 nodePath 접두 인덱스 (types.ts 규칙) */
function subBlocks(n: ScriptNode): { path: number[]; nodes: ScriptNode[] }[] {
  switch (n.kind) {
    case "choices": {
      const out = n.branches.map((b, bi) => ({ path: [bi], nodes: b.body }));
      if (n.cancelBranch) out.push({ path: [-1], nodes: n.cancelBranch });
      return out;
    }
    case "conditional": return [{ path: [0], nodes: n.then }, ...(n.else ? [{ path: [1], nodes: n.else }] : [])];
    case "loop": return [{ path: [0], nodes: n.body }];
    default: return [];
  }
}

function walk(nodes: ScriptNode[], prefix: number[], visit: (n: ScriptNode, path: number[]) => void): void {
  nodes.forEach((n, i) => {
    const path = [...prefix, i];
    visit(n, path);
    for (const b of subBlocks(n)) walk(b.nodes, [...path, ...b.path], visit);
  });
}

function firstMessageTitle(nodes: ScriptNode[]): string | undefined {
  let found: ScriptNode | undefined;
  walk(nodes, [], n => { if (!found && n.kind === "message") found = n; });
  if (!found || found.kind !== "message") return undefined;
  const first = found.lines[0] ?? "";
  if (!first) return undefined;
  const cut = first.length > 20 ? `${first.slice(0, 20).trimEnd()}…` : first;
  return found.speaker ? `${found.speaker} — "${cut}"` : `"${cut}"`;
}

function safeInterpret(list: EventCommand[], data: GameData): ScriptNode[] {
  try { return interpret(list, data); } catch { return []; }
}

export function buildIndex(data: GameData): GameIndex {
  const pages: PageEntry[] = [];
  const make = (entry: Omit<PageEntry, "nodes" | "hasDialogue">, nodes: ScriptNode[]) => {
    pages.push({ ...entry, nodes, hasDialogue: hasDialogue(nodes) });
  };

  const infos = data.mapInfos
    .map((m, i) => ({ m, i }))
    .filter((x): x is { m: NonNullable<typeof x.m>; i: number } => !!x.m)
    .sort((a, b) => a.m.order - b.m.order || a.i - b.i);
  for (const { m: info } of infos) {
    const map = data.maps.get(info.id);
    if (!map) continue;
    const events = map.events.filter((e): e is NonNullable<typeof e> => !!e).sort((a, b) => a.id - b.id);
    for (const ev of events) {
      const pageNodes = ev.pages.map(pg => safeInterpret(pg.list, data));
      let title = ev.name;
      if (GENERIC_NAME.test(ev.name)) {
        for (const nodes of pageNodes) {
          const t = firstMessageTitle(nodes);
          if (t) { title = t; break; }
        }
      }
      ev.pages.forEach((pg, pi) => make({
        location: { source: "map", mapId: info.id, eventId: ev.id, page: pi },
        path: `${info.name} › ${title} › p${pi + 1}`,
        title,
        conditions: describePageConditions(pg.conditions, pg.trigger, data),
      }, pageNodes[pi]));
    }
  }
  for (const ce of data.commonEvents.filter((c): c is NonNullable<typeof c> => !!c).sort((a, b) => a.id - b.id)) {
    make({
      location: { source: "common", commonEventId: ce.id },
      path: `공통 이벤트 › ${ce.name}`, title: ce.name,
      conditions: describeCommonEventConditions(ce, data),
    }, safeInterpret(ce.list, data));
  }
  for (const tr of data.troops.filter((t): t is NonNullable<typeof t> => !!t).sort((a, b) => a.id - b.id)) {
    tr.pages.forEach((pg, pi) => make({
      location: { source: "troop", troopId: tr.id, page: pi },
      path: `전투 › ${tr.name} › p${pi + 1}`, title: tr.name,
      conditions: describeTroopPageConditions(pg.conditions, pg.span, data),
    }, safeInterpret(pg.list, data)));
  }

  const strings: { entry: PageEntry; text: string; lower: string; nodePath: number[] }[] = [];
  const addStr = (entry: PageEntry, text: string, nodePath: number[]) => {
    if (text) strings.push({ entry, text, lower: text.toLowerCase(), nodePath });
  };
  const writes = new Map<string, PageEntry[]>();
  const reads = new Map<string, PageEntry[]>();
  const callerMap = new Map<number, PageEntry[]>();
  const push = <K>(m: Map<K, PageEntry[]>, k: K, e: PageEntry) => {
    const l = m.get(k);
    if (!l) m.set(k, [e]);
    else if (!l.includes(e)) l.push(e);
  };
  for (const entry of pages) {
    for (const c of entry.conditions) for (const r of c.refs) if (r.type !== "selfSwitch") push(reads, refKey(r), entry);
    walk(entry.nodes, [], (n, path) => {
      switch (n.kind) {
        case "message":
          if (n.speaker) addStr(entry, n.speaker, path);
          for (const l of n.lines) addStr(entry, l, path);
          break;
        case "scroll":
          for (const l of n.lines) addStr(entry, l, path);
          break;
        case "choices":
          for (const b of n.branches) addStr(entry, b.label, path);
          break;
        case "conditional":
          for (const r of n.condition.refs) if (r.type !== "selfSwitch") push(reads, refKey(r), entry);
          break;
        case "stateChange":
          for (const r of n.refs) if (r.type !== "selfSwitch") push(writes, refKey(r), entry);
          break;
        case "commonEvent":
          push(callerMap, n.commonEventId, entry);
          break;
      }
    });
  }

  return {
    pages,
    search(query, limit = 200): SearchHit[] {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const out: SearchHit[] = [];
      for (const s of strings) {
        if (out.length >= limit) break;
        if (s.lower.includes(q)) out.push({ entry: s.entry, text: s.text, nodePath: s.nodePath });
      }
      return out;
    },
    xref(ref): XrefEntry {
      const k = refKey(ref);
      return { writes: writes.get(k) ?? [], reads: reads.get(k) ?? [] };
    },
    callers: id => callerMap.get(id) ?? [],
  };
}
