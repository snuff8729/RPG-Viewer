import { beforeAll, describe, expect, it } from "vitest";
import { fixtureRecords } from "../../../tests/helpers/fixtureLog";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { choiceTexts } from "../../ui/live/historyText";
import { loadGame } from "../loader/loadGame";
import type { GameData } from "../types";
import { choiceFlow } from "./choiceFlow";
import { computeCoverage } from "./coverage";
import { branchPath, buildHistory, foldTimeline } from "./history";
import { readerItems } from "./reader";

let data: GameData;
beforeAll(async () => {
  const r = await loadGame(loadFixtureFolder("sample-mz"));
  if (!r.ok) throw new Error("load failed");
  data = r.data;
});

const records = fixtureRecords();
const model = buildHistory(records);
const flow = (branch: number) => {
  const path = branchPath(records, model, branch);
  const items = foldTimeline(path, model, {});
  const choiceText = choiceTexts(path, data);
  return choiceFlow({ items, reader: readerItems(items, data, choiceText, model), data, model, coverage: computeCoverage(records, data), branch, choiceText });
};

describe("choiceFlow", () => {
  it("branch 2: segment, choice, segment", () => {
    expect(flow(2).some(i => i.kind === "fork")).toBe(true);   // 갈래 2가 갈라진 지점도 경로에 나온다
    const f = flow(2).filter(i => i.kind !== "chapter" && i.kind !== "fork");
    expect(f.map(i => i.kind)).toEqual(["segment", "choice", "segment"]);
    expect(f[0]).toMatchObject({ messages: 4, pictures: 1 });
    expect(f[1]).toMatchObject({
      kind: "choice",
      question: { speaker: "촌장" },
      options: [
        { label: "네, 도울게요", picked: false, elsewhere: ["1회차 갈래 1"] },
        { label: "생각해볼게요", picked: true, elsewhere: [] },
      ],
    });
    expect((f[1] as { question: { text: string } }).question.text).toMatch(/^도와주겠나\?/);
    expect(f[2]).toMatchObject({ messages: 1 });
    expect(JSON.stringify(f[2])).toContain("밤이 깊었다");
  });

  it("branch 1: fork after seq 8, other option elsewhere", () => {
    const f = flow(1);
    const fi = f.findIndex(i => i.kind === "fork");
    expect(fi).toBeGreaterThan(-1);
    expect(f[fi]).toMatchObject({ atSeq: 8 });
    const ci = f.findIndex(i => i.kind === "choice");
    expect(ci).toBeGreaterThan(fi);
    expect(f[ci]).toMatchObject({
      options: [
        { label: "네, 도울게요", picked: true, elsewhere: [] },
        { label: "생각해볼게요", picked: false, elsewhere: ["1회차 갈래 2"] },
      ],
    });
    const keys = f.map(i => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("never throws on garbage", () => {
    const bad = { items: null, reader: null, data, model, coverage: null, branch: 1, choiceText: new Map() } as unknown as Parameters<typeof choiceFlow>[0];
    expect(choiceFlow(bad)).toEqual([]);
  });
});
