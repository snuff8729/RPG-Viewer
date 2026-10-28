import { describe, expect, it } from "vitest";
import { fixtureLive } from "../../../tests/helpers/fixtureLog";
import { evaluate } from "./evaluate";

describe("evaluate", () => {
  it("evaluate", () => {
    const live = fixtureLive();
    expect(evaluate({ kind: "switch", id: 1, on: true }, live, {})).toBe("met");
    expect(evaluate({ kind: "variable", id: 1, op: ">=", value: 5 }, live, {})).toBe("unmet");
    expect(evaluate({ kind: "item", id: 1 }, live, {})).toBe("met");
    expect(evaluate({ kind: "selfSwitch", letter: "A", on: true }, live, { mapId: 2, eventId: 1 })).toBe("unmet");
    expect(evaluate({ kind: "unknown" }, live, {})).toBe("unknown");
    expect(evaluate({ kind: "switch", id: 1, on: true }, null, {})).toBe("unknown");
  });
  it("other kinds", () => {
    const live = { ...fixtureLive(), selfSwitches: ["2,1,A"], variables: { "1": 3, "2": 3 } };
    expect(evaluate(undefined, live, {})).toBe("unknown");
    expect(evaluate({ kind: "trigger" }, live, {})).toBe("met");
    expect(evaluate({ kind: "switch", id: 2, on: false }, live, {})).toBe("met");
    expect(evaluate({ kind: "selfSwitch", letter: "A", on: true }, live, { mapId: 2, eventId: 1 })).toBe("met");
    expect(evaluate({ kind: "selfSwitch", letter: "A", on: false }, live, { mapId: 2, eventId: 1 })).toBe("unmet");
    expect(evaluate({ kind: "selfSwitch", letter: "A", on: true }, live, {})).toBe("unknown");
    expect(evaluate({ kind: "variable", id: 9, op: "=", value: 0 }, live, {})).toBe("met");
    expect(evaluate({ kind: "variable", id: 1, op: "!=", value: 3 }, live, {})).toBe("unmet");
    expect(evaluate({ kind: "variable", id: 1, op: "<", value: 4 }, live, {})).toBe("met");
    expect(evaluate({ kind: "variableVar", id: 1, op: "=", otherId: 2 }, live, {})).toBe("met");
    expect(evaluate({ kind: "weapon", id: 1 }, live, {})).toBe("unmet");
    expect(evaluate({ kind: "armor", id: 1 }, live, {})).toBe("unmet");
    expect(evaluate({ kind: "actorInParty", id: 1 }, live, {})).toBe("met");
    expect(evaluate({ kind: "actorInParty", id: 2 }, live, {})).toBe("unmet");
    expect(evaluate({ kind: "gold", op: ">=", value: 100 }, live, {})).toBe("met");
    expect(evaluate({ kind: "gold", op: "<", value: 100 }, live, {})).toBe("unmet");
  });
  it("never throws on odd snapshots", () => {
    const odd = { v: 1 } as never;
    expect(() => evaluate({ kind: "switch", id: 1, on: true }, odd, {})).not.toThrow();
    expect(evaluate({ kind: "item", id: 1 }, odd, {})).toBe("unmet");
    expect(evaluate({ kind: "bogus" } as never, fixtureLive(), {})).toBe("unknown");
  });
});
