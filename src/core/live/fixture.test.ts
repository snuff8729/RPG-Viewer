import { describe, it, expect } from "vitest";
import { fixtureLive, fixtureLogText, fixtureRecords } from "../../../tests/helpers/fixtureLog";

describe("log fixture", () => {
  it("fixture log has 35 records and one broken line", () => {
    expect(fixtureRecords()).toHaveLength(35);
    expect(fixtureLogText().split("\n").filter(l => l.trim()).length).toBe(36);
  });
  it("records are in seq order with v:1 and escapes survive", () => {
    const rs = fixtureRecords();
    expect(rs.map(r => r.seq)).toEqual(Array.from({ length: 35 }, (_, i) => i + 1));
    expect(rs.every(r => r.v === 1)).toBe(true);
    expect(rs[1]).toMatchObject({ type: "message", text: "왔구나, \\N[1].\n숲이 이상하다는 소문은 들었겠지?" });
    expect(rs[5]).toMatchObject({ type: "message", text: "도와주겠나? \\C[2]보상\\C[0]은 \\V[1]만큼." });
    expect(rs.slice(14, 26).map(r => r.t)).toEqual(Array.from({ length: 12 }, (_, i) => 1015000 + i * 1000));
    expect(rs[26].t).toBe(1027000);
    expect(rs[27]).toMatchObject({ type: "branchStart", reason: "load", parentBranch: 1, fromSeq: 8, run: 1, branch: 2 });
    expect(rs[31]).toMatchObject({ type: "branchStart", reason: "unknownSave", run: 2, branch: 3 });
  });
  it("live snapshot", () => expect(fixtureLive()).toMatchObject({ v: 1, run: 1, branch: 2, seq: 31, mapId: 2, choice: null }));
});
