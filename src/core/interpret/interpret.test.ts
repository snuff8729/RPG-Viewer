import { describe, it, expect, beforeAll } from "vitest";
import { loadGame } from "../loader/loadGame";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import type { EventCommand, GameData, ScriptNode } from "../types";
import { interpret, hasDialogue, findNodePathByCmd } from "./interpret";

let data: GameData;
let nodes: ScriptNode[];
let mvNodes: ScriptNode[];

beforeAll(async () => {
  const r = await loadGame(loadFixtureFolder("sample-mz"));
  if (!r.ok) throw new Error("load failed");
  data = r.data;
  const ev1Page0 = data.maps.get(2)!.events[1]!.pages[0];
  nodes = interpret(ev1Page0.list, data);
  const mv = await loadGame(loadFixtureFolder("sample-mv"));
  if (!mv.ok) throw new Error("mv load failed");
  mvNodes = interpret(mv.data.maps.get(1)!.events[1]!.pages[0].list, mv.data);
});

const cmd = (code: number, indent: number, parameters: any[]): EventCommand => ({ code, indent, parameters });

describe("interpret (sample-mz Map002 EV1 p0)", () => {
  it("produces the expected top-level kinds", () => expect(nodes.map(n => n.kind)).toEqual(
    ["message", "message", "message", "picture", "message", "choices", "conditional", "scroll", "commonEvent", "other", "transfer"]));
  it("message with MZ speaker and escapes", () => expect(nodes[0]).toEqual(
    { kind: "message", cmd: 0, face: { name: "People1", index: 3 }, speaker: "촌장", lines: ["왔구나, 레나.", "숲이 이상하다는 소문은 들었겠지?"] }));
  it("infers speaker from face", () => expect((nodes[1] as any).speaker).toBe("레나"));
  it("faceless message is narration", () => expect(nodes[2]).toEqual({ kind: "message", cmd: 5, lines: ["(창밖에서 바람 소리가 들린다.)"] }));
  it("picture", () => expect(nodes[3]).toEqual({ kind: "picture", cmd: 7, pictureId: 1, name: "village_map" }));
  it("choices with branches", () => {
    const c = nodes[5] as Extract<ScriptNode, { kind: "choices" }>;
    expect(c.branches.map(b => b.label)).toEqual(["네, 도울게요", "생각해볼게요"]);
    expect(c.branches[0].body.map(n => n.kind)).toEqual(["message", "stateChange"]);
    expect(c.branches[0].body[1]).toMatchObject({ description: "스위치 숲 개방 → ON", refs: [{ type: "switch", id: 1 }] });
    expect(c.branches[1].body).toEqual([]);
  });
  it("conditional with then/else", () => {
    const c = nodes[6] as Extract<ScriptNode, { kind: "conditional" }>;
    expect(c.condition.text).toBe("변수: 호감도 ≥ 5");
    expect(c.then[1]).toMatchObject({ kind: "stateChange", description: "아이템 은 반지 +1" });
    expect(c.else).toEqual([]);
  });
  it("scroll", () => expect(nodes[7]).toEqual({ kind: "scroll", cmd: 27, lines: ["― 그날 밤 ―", "마을에 다시 정적이 찾아왔다."] }));
  it("commonEvent", () => expect(nodes[8]).toEqual({ kind: "commonEvent", commonEventId: 1 }));
  it("groups other commands", () => expect((nodes[9] as any).commands.map((c: any) => c.code)).toEqual([250, 225, 357, 9999]));
  it("transfer", () => expect(nodes[10]).toEqual({ kind: "transfer", mapId: 3, x: 5, y: 12 }));
  it("records source command index", () => {
    expect(nodes.filter(n => "cmd" in n).map(n => [n.kind, (n as any).cmd]))
      .toEqual([["message", 0], ["message", 3], ["message", 5], ["picture", 7], ["message", 8], ["choices", 10], ["scroll", 27]]);
    expect(((nodes[5] as any).branches[0].body[0]).cmd).toBe(12);
    expect(((nodes[6] as any).then[0]).cmd).toBe(20);
  });
  it("findNodePathByCmd", () => {
    expect(findNodePathByCmd(nodes, 12)).toEqual([5, 0, 0]);
    expect(findNodePathByCmd(nodes, 20)).toEqual([6, 0, 0]);
    expect(findNodePathByCmd(nodes, 99)).toBeNull();
  });
  it("cmd is the index in the original list even with null entries", () => {
    const out = interpret([null as any, cmd(101, 0, ["", 0, 0, 2]), cmd(401, 0, ["a"])], data);
    expect((out[0] as any).cmd).toBe(1);
  });
  it("MV speaker comes from face", () => expect((mvNodes[0] as any).speaker).toBe("레나"));
});

describe("interpret robustness", () => {
  it("survives missing end markers", () => {
    const broken = [cmd(102, 0, [["a"], 1, 0, 2, 0]), cmd(402, 0, [0, "a"]),
      cmd(101, 1, ["", 0, 0, 2]), cmd(401, 1, ["x"]),
      cmd(101, 0, ["", 0, 0, 2]), cmd(401, 0, ["after"])];
    const out = interpret(broken, data);
    expect(out.map(n => n.kind)).toEqual(["choices", "message"]);
    expect((out[1] as any).lines).toEqual(["after"]);
  });
  it("survives indent jumps and unknown codes", () => expect(() => interpret([
    cmd(401, 3, ["orphan"]), cmd(411, 0, []), cmd(77, 0, [])], data)).not.toThrow());
  it("survives garbage parameters", () => expect(() => interpret([
    cmd(101, 0, []), cmd(102, 0, [null]), cmd(402, 0, []), cmd(121, 0, []), cmd(122, 0, [1, 1, 9, 9]),
    cmd(126, 0, []), cmd(129, 0, []), cmd(231, 0, []), cmd(111, 0, []), { code: 117 } as any], data)).not.toThrow());
  it("empty picture name becomes other", () => expect(interpret([cmd(231, 0, [1, "", 0])], data)[0].kind).toBe("other"));
  it("cancel branch and loop", () => {
    const out = interpret([
      cmd(102, 0, [["a", "b"], 2, 0, 2, 0]), cmd(402, 0, [0, "a"]), cmd(0, 1, []),
      cmd(403, 0, [6, null]), cmd(113, 1, []), cmd(0, 1, []), cmd(404, 0, []),
      cmd(112, 0, []), cmd(230, 1, [60]), cmd(0, 1, []), cmd(413, 0, []),
    ], data);
    expect(out.map(n => n.kind)).toEqual(["choices", "loop"]);
    expect((out[0] as any).cancelBranch.map((n: any) => n.kind)).toEqual(["other"]);
    expect((out[1] as any).body.map((n: any) => n.kind)).toEqual(["other"]);
  });
  it("transfer by variable", () => expect(interpret([cmd(201, 0, [1, 1, 2, 3, 0, 0])], data)[0])
    .toEqual({ kind: "transfer", mapId: null }));
});

describe("stateChange descriptions", () => {
  const one = (c: EventCommand) => interpret([c], data)[0] as Extract<ScriptNode, { kind: "stateChange" }>;
  it("switch range", () => expect(one(cmd(121, 0, [1, 3, 1]))).toMatchObject({
    target: "switch", description: "스위치 #1~#3 → OFF",
    refs: [{ type: "switch", id: 1 }, { type: "switch", id: 2 }, { type: "switch", id: 3 }] }));
  it("variable ops", () => {
    expect(one(cmd(122, 0, [1, 1, 0, 0, 5])).description).toBe("변수 호감도 = 5");
    expect(one(cmd(122, 0, [1, 1, 1, 0, 5])).description).toBe("변수 호감도 += 5");
    expect(one(cmd(122, 0, [1, 1, 2, 0, 5])).description).toBe("변수 호감도 -= 5");
    expect(one(cmd(122, 0, [1, 1, 3, 0, 5])).description).toBe("변수 호감도 *= 5");
    expect(one(cmd(122, 0, [1, 1, 4, 0, 5])).description).toBe("변수 호감도 /= 5");
    expect(one(cmd(122, 0, [1, 1, 5, 0, 5])).description).toBe("변수 호감도 %= 5");
    expect(one(cmd(122, 0, [1, 1, 0, 1, 1]))).toMatchObject({ description: "변수 호감도 = [변수: 호감도]",
      refs: [{ type: "variable", id: 1 }] });
    expect(one(cmd(122, 0, [1, 1, 0, 1, 1])).refs).toEqual([{ type: "variable", id: 1 }]);
    // operand variable is a read, not a write: refs hold only the target
    expect(one(cmd(122, 0, [2, 2, 0, 1, 1])).refs).toEqual([{ type: "variable", id: 2 }]);
    expect(one(cmd(122, 0, [1, 1, 0, 2, 1, 6])).description).toBe("변수 호감도 = 랜덤 1~6");
    expect(one(cmd(122, 0, [1, 1, 0, 3, 0, 0, 0])).description).toBe("변수 호감도 = (게임 데이터)");
    expect(one(cmd(122, 0, [1, 1, 0, 4, "1+1"])).description).toBe("변수 호감도 = (스크립트)");
  });
  it("self switch", () => expect(one(cmd(123, 0, ["A", 0]))).toMatchObject({
    target: "selfSwitch", description: "셀프 스위치 A → ON", refs: [{ type: "selfSwitch", id: "A" }] }));
  it("gold", () => {
    expect(one(cmd(125, 0, [0, 0, 100]))).toMatchObject({ target: "gold", description: "소지금 +100G", refs: [] });
    expect(one(cmd(125, 0, [1, 0, 100])).description).toBe("소지금 -100G");
    expect(one(cmd(125, 0, [0, 1, 1])).description).toBe("소지금 +[변수: 호감도]G");
    expect(one(cmd(125, 0, [0, 1, 1])).refs).toEqual([]);
    const gil = { ...data, system: { ...data.system, currencyUnit: "Gil" } };
    expect((interpret([cmd(125, 0, [0, 0, 5])], gil)[0] as any).description).toBe("소지금 +5Gil");
    const none = { ...data, system: { ...data.system, currencyUnit: "" } };
    expect((interpret([cmd(125, 0, [0, 0, 5])], none)[0] as any).description).toBe("소지금 +5G");
  });
  it("items/weapons/armors", () => {
    expect(one(cmd(126, 0, [2, 0, 0, 1]))).toMatchObject({ target: "item", description: "아이템 은 반지 +1", refs: [{ type: "item", id: 2 }] });
    expect(one(cmd(126, 0, [2, 0, 1, 1])).description).toBe("아이템 은 반지 +[변수: 호감도]");
    expect(one(cmd(126, 0, [2, 0, 1, 1])).refs).toEqual([{ type: "item", id: 2 }]);
    expect(one(cmd(127, 0, [1, 1, 0, 1, false]))).toMatchObject({ target: "weapon", refs: [{ type: "weapon", id: 1 }] });
    expect(one(cmd(127, 0, [1, 1, 0, 1, false])).description).toMatch(/^무기 .+ -1$/);
    expect(one(cmd(128, 0, [1, 0, 0, 1, false])).description).toMatch(/^방어구 .+ \+1$/);
  });
  it("party", () => {
    expect(one(cmd(129, 0, [1, 0, false]))).toMatchObject({ target: "party", description: "파티에 레나 추가", refs: [{ type: "actor", id: 1 }] });
    expect(one(cmd(129, 0, [1, 1, false])).description).toBe("파티에서 레나 제외");
  });
});

describe("hasDialogue", () => {
  it("detects dialogue", () => {
    expect(hasDialogue(nodes)).toBe(true);
    expect(hasDialogue(interpret([cmd(250, 0, [{}]), cmd(0, 0, [])], data))).toBe(false);
  });
  it("detects nested dialogue", () => expect(hasDialogue(interpret([
    cmd(111, 0, [0, 1, 0]), cmd(101, 1, ["", 0, 0, 2]), cmd(401, 1, ["x"]), cmd(0, 1, []), cmd(412, 0, [])], data))).toBe(true));
});

describe("MV name-box speaker", () => {
  const mv = (): GameData => ({ ...data, engine: "MV" });
  const one = (face: string, line: string, name = "", d = mv()) =>
    interpret([cmd(101, 0, [face, 0, 0, 2, name]), cmd(401, 0, [line])], d)[0] as Extract<ScriptNode, { kind: "message" }>;
  it("n<X> without face sets speaker and strips the code", () =>
    expect(one("", String.raw`\n<하롤드>안녕`)).toEqual({ kind: "message", cmd: 0, speaker: "하롤드", lines: ["안녕"] }));
  it("nl<N[1]> formats the name", () => {
    const n = one("", String.raw`\nl<\N[1]>…`);
    expect(n.speaker).toBe("레나");
    expect(n.lines).toEqual(["…"]);
  });
  it("NC<X> / nr<X> are case-insensitive", () => {
    expect(one("", String.raw`\NC<가>a`).speaker).toBe("가");
    expect(one("", String.raw`\nr<나>b`).speaker).toBe("나");
  });
  it("name-box wins over face-inferred speaker", () => {
    const n = one("People1", String.raw`\n<하롤드>안녕`);
    expect(n.speaker).toBe("하롤드");
  });
  it("MZ speaker wins and the code is stripped", () => {
    const n = one("", String.raw`\n<하롤드>안녕`, "촌장", data);
    expect(n.speaker).toBe("촌장");
    expect(n.lines).toEqual(["안녕"]);
  });
  it("only the first line is inspected", () => {
    const out = interpret([cmd(101, 0, ["", 0, 0, 2]), cmd(401, 0, ["첫 줄"]), cmd(401, 0, [String.raw`\n<X>둘째`])], mv())[0] as any;
    expect(out.speaker).toBeUndefined();
    expect(out.lines).toEqual(["첫 줄", "둘째"]);
  });
  it("does not mutate the source commands", () => {
    const list = [cmd(101, 0, ["", 0, 0, 2]), cmd(401, 0, [String.raw`\n<하롤드>안녕`])];
    interpret(list, mv());
    expect(list[1].parameters[0]).toBe(String.raw`\n<하롤드>안녕`);
    expect((interpret(list, mv())[0] as any).speaker).toBe("하롤드");
  });
  it("N[1] mid-line is still the actor name", () =>
    expect(one("", String.raw`안녕, \N[1].`)).toEqual({ kind: "message", cmd: 0, lines: ["안녕, 레나."] }));
});
