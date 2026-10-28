import { beforeAll, describe, expect, it } from "vitest";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { buildIndex } from "../index/buildIndex";
import { loadGame } from "../loader/loadGame";
import type { Condition, ScriptNode } from "../types";
import { remainingNodes } from "./remaining";

let ev1p0: ScriptNode[];
beforeAll(async () => {
  const r = await loadGame(loadFixtureFolder("sample-mz"));
  if (!r.ok) throw new Error("load failed");
  const entry = buildIndex(r.data).pages.find(p =>
    p.location.source === "map" && p.location.mapId === 2 && p.location.eventId === 1 && p.location.page === 0)!;
  ev1p0 = entry.nodes;
});

describe("remainingNodes", () => {
  it("inside a choice branch: rest of branch, then nodes after the choices", () => {
    const out = remainingNodes(ev1p0, 12);
    expect(out[0]).toMatchObject({ kind: "message", cmd: 12 });
    expect(out.map(n => n.kind)).toEqual(["message", "stateChange", "conditional", "scroll", "commonEvent", "other", "transfer"]);
  });
  it("cmd 0 → whole list; past the end → from the last cmd node", () => {
    expect(remainingNodes(ev1p0, 0)).toEqual(ev1p0);
    const out = remainingNodes(ev1p0, 99);
    expect(out[0]).toMatchObject({ kind: "scroll", cmd: 27 });
    expect(out.map(n => n.kind)).toEqual(["scroll", "commonEvent", "other", "transfer"]);
  });
  it("cmd between nodes uses the last one at or before it", () => {
    expect(remainingNodes(ev1p0, 9)[0]).toMatchObject({ kind: "message", cmd: 8 });
  });
  it("conditional and loop bodies continue after the block", () => {
    const condition = { text: "c", refs: [] } as unknown as Condition;
    const nodes: ScriptNode[] = [
      { kind: "loop", body: [
        { kind: "conditional", condition,
          then: [{ kind: "message", cmd: 3, lines: ["a"] }, { kind: "commonEvent", commonEventId: 1 }],
          else: [{ kind: "message", cmd: 6, lines: ["b"] }] },
        { kind: "scroll", cmd: 9, lines: ["s"] },
      ] },
      { kind: "transfer", mapId: null },
    ];
    expect(remainingNodes(nodes, 4).map(n => n.kind)).toEqual(["message", "commonEvent", "scroll", "transfer"]);
    expect(remainingNodes(nodes, 7).map(n => n.kind)).toEqual(["message", "scroll", "transfer"]);
  });
  it("no matching node or odd input → whole list, never throws", () => {
    const nodes: ScriptNode[] = [{ kind: "commonEvent", commonEventId: 1 }, { kind: "message", cmd: 5, lines: [] }];
    expect(remainingNodes(nodes, 2)).toEqual(nodes);
    expect(remainingNodes(nodes, NaN)).toEqual(nodes);
    expect(remainingNodes(null as unknown as ScriptNode[], 3)).toEqual([]);
    expect(remainingNodes([null as unknown as ScriptNode, ...nodes], 5)).toEqual([nodes[1]]);
  });
});
