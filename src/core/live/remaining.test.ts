import { beforeAll, describe, expect, it } from "vitest";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { buildIndex } from "../index/buildIndex";
import { loadGame } from "../loader/loadGame";
import { interpret } from "../interpret/interpret";
import type { Condition, EventCommand, GameData, ScriptNode } from "../types";
import { firstMessage, remainingNodes, untilStop } from "./remaining";

let ev1p0: ScriptNode[];
let list: EventCommand[];
let data: GameData;
beforeAll(async () => {
  const r = await loadGame(loadFixtureFolder("sample-mz"));
  if (!r.ok) throw new Error("load failed");
  const entry = buildIndex(r.data).pages.find(p =>
    p.location.source === "map" && p.location.mapId === 2 && p.location.eventId === 1 && p.location.page === 0)!;
  ev1p0 = entry.nodes;
  data = r.data;
  list = r.data.maps.get(2)!.events[1]!.pages[0].list;
});

const show = (ns: ScriptNode[]) => ns.map(n => n.kind + ("cmd" in n ? "#" + n.cmd : ""));
const AFTER_CHOICES = ["conditional", "scroll#27", "commonEvent", "other", "transfer"];

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
  it("inline question: choices right after its message starts at the message", () => {
    // 101@8 + 401@9 + 102@10 → 메시지와 선택지가 함께 떠 있다
    expect(show(remainingNodes(ev1p0, 10))[0]).toBe("message#8");
    expect(show(remainingNodes(ev1p0, 10, list))[0]).toBe("message#8");
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

describe("remainingNodes with the raw command list (branch-aware)", () => {
  it("empty branch 1 picked (wait/terminator at 17): skips branch 0, continues after the choices", () => {
    const out = remainingNodes(ev1p0, 17, list);
    expect(show(out)).not.toContain("message#12");
    expect(show(out)).toEqual(AFTER_CHOICES);
    expect(show(remainingNodes(ev1p0, 16, list))).toEqual(AFTER_CHOICES); // 402 of branch 1
    expect(show(remainingNodes(ev1p0, 18, list))).toEqual(AFTER_CHOICES); // 404
  });
  it("inside branch 0", () => {
    // 402 marker → branch 0 from its start
    expect(show(remainingNodes(ev1p0, 11, list))).toEqual(["message#12", "stateChange", ...AFTER_CHOICES]);
    // 13 = 메시지의 401(아직 표시 중) → 메시지부터
    expect(show(remainingNodes(ev1p0, 13, list))).toEqual(["message#12", "stateChange", ...AFTER_CHOICES]);
    // 14 = 메시지 이후(121) → stateChange부터
    expect(show(remainingNodes(ev1p0, 14, list))).toEqual(["stateChange", ...AFTER_CHOICES]);
    // 15 = branch 0 끝 → 선택지 이후
    expect(show(remainingNodes(ev1p0, 15, list))).toEqual(AFTER_CHOICES);
  });
  it("conditional: then body, else marker, closer", () => {
    expect(show(remainingNodes(ev1p0, 19, list))).toEqual(AFTER_CHOICES);
    const then = show(remainingNodes(ev1p0, 21, list));
    expect(then[0]).toBe("message#20");
    expect(then.slice(-4)).toEqual(AFTER_CHOICES.slice(1));
    expect(show(remainingNodes(ev1p0, 24, list))).toEqual(AFTER_CHOICES.slice(1)); // 411, else empty
    expect(show(remainingNodes(ev1p0, 25, list))).toEqual(AFTER_CHOICES.slice(1));
    expect(show(remainingNodes(ev1p0, 26, list))).toEqual(AFTER_CHOICES.slice(1)); // 412
  });
  it("command without a node after a dialogue node starts after that node", () => {
    expect(show(remainingNodes(ev1p0, 29, list))[0]).toBe("scroll#27"); // 405 still showing
    expect(show(remainingNodes(ev1p0, 30, list))).toEqual(["commonEvent", "other", "transfer"]);
  });
  it("nested: wait inside a choice branch inside a loop inside a conditional", () => {
    const c = (code: number, indent: number, parameters: unknown[] = []) => ({ code, indent, parameters }) as EventCommand;
    const l: EventCommand[] = [
      c(111, 0, [0, 1, 0]),                // 0 if
      c(112, 1),                           // 1  loop
      c(101, 2, ["", 0, 0, 2, ""]),        // 2   msg
      c(401, 2, ["Q"]),                    // 3
      c(102, 2, [["A", "B"], 1, 0, 2, 0]), // 4   choices
      c(402, 2, [0, "A"]),                 // 5
      c(101, 3, ["", 0, 0, 2, ""]),        // 6    msg A
      c(401, 3, ["a"]),                    // 7
      c(0, 3),                             // 8
      c(402, 2, [1, "B"]),                 // 9
      c(230, 3, [60]),                     // 10   wait
      c(101, 3, ["", 0, 0, 2, ""]),        // 11   msg B
      c(401, 3, ["b"]),                    // 12
      c(0, 3),                             // 13
      c(404, 2),                           // 14
      c(0, 2),                             // 15
      c(413, 1),                           // 16
      c(0, 1),                             // 17
      c(412, 0),                           // 18
      c(101, 0, ["", 0, 0, 2, ""]),        // 19 msg end
      c(401, 0, ["end"]),                  // 20
      c(0, 0),                             // 21
    ];
    const nodes = interpret(l, data);
    expect(show(remainingNodes(nodes, 10, l))).toEqual(["other", "message#11", "message#19"]); // 대기(other)부터
    expect(show(remainingNodes(nodes, 8, l))).toEqual(["message#19"]);
    expect(show(remainingNodes(nodes, 4, l))).toEqual(["message#2", "choices#4", "message#19"]);
    expect(show(remainingNodes(nodes, 18, l))).toEqual(["message#19"]);
  });
  it("mismatched / odd lists fall back to the plain behavior, never throw", () => {
    expect(remainingNodes(ev1p0, 17, [])).toEqual(remainingNodes(ev1p0, 17));
    expect(remainingNodes(ev1p0, 99, list)).toEqual(remainingNodes(ev1p0, 99));
    expect(remainingNodes(ev1p0, 17, [{ code: 111, indent: 0, parameters: [] }] as EventCommand[]))
      .toEqual(remainingNodes(ev1p0, 17));
    expect(() => remainingNodes(ev1p0, 17, [null, 5, "x"] as unknown as EventCommand[])).not.toThrow();
    expect(() => remainingNodes(ev1p0, 17, {} as unknown as EventCommand[])).not.toThrow();
  });
});

describe("untilStop / firstMessage", () => {
  it("stops before the first top-level choices", () => {
    const r = untilStop(remainingNodes(ev1p0, 0));
    expect(r.nodes.map(n => n.kind)).toEqual(["message", "message", "message", "picture", "message"]);
    expect(r.stop?.kind).toBe("choices");
  });
  it("after a branch, stops before the transfer", () => {
    const r = untilStop(remainingNodes(ev1p0, 14, list));
    expect(r.stop?.kind).toBe("transfer");
    expect(r.nodes.some(n => n.kind === "transfer" || n.kind === "choices")).toBe(false);
  });
  it("no stop → null", () => {
    const r = untilStop([{ kind: "message", cmd: 1, lines: ["a"] } as ScriptNode]);
    expect(r.stop).toBeNull();
    expect(r.nodes).toHaveLength(1);
  });
  it("firstMessage finds the first message in document order", () => {
    const ch = ev1p0.find(n => n.kind === "choices")!;
    if (ch.kind !== "choices") throw new Error();
    expect(firstMessage(ch.branches[0].body)).toMatchObject({ kind: "message", cmd: 12 });
    expect(firstMessage([])).toBeNull();
  });
});
