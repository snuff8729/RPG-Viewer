import { beforeAll, describe, expect, it } from "vitest";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { fixtureLive, fixtureRecords } from "../../../tests/helpers/fixtureLog";
import { buildIndex } from "../index/buildIndex";
import { loadGame } from "../loader/loadGame";
import type { EventCommand, GameData, GameIndex } from "../types";
import { computeCoverage } from "./coverage";
import { computeMissing } from "./missing";

let data: GameData, index: GameIndex;
beforeAll(async () => {
  const r = await loadGame(loadFixtureFolder("sample-mz"));
  if (!r.ok) throw new Error("load failed");
  data = r.data; index = buildIndex(data);
});

const withCommon = (list: EventCommand[]): GameData =>
  ({ ...data, commonEvents: [null, { id: 1, name: "시험", trigger: 0, switchId: 1, list }], troops: [] });

describe("computeMissing", () => {
  it("missing: unpicked choice option", () => {
    const recs = fixtureRecords().filter(r => r.seq <= 27);
    const m = computeMissing(buildIndex(data), data, computeCoverage(recs, data), fixtureLive());
    const ch = m.filter(i => i.kind === "choice");
    expect(ch.map(i => [i.entry.path, i.label, i.nodePath])).toEqual([["촌장의 집 › 촌장 › p1", '"생각해볼게요"', [5, 1]]]);
    expect(ch[0].onCurrentMap).toBe(true);
    expect(ch[0].requirements).toEqual([]);
    expect(ch[0].allMet).toBe(true);
  });
  it("missing: no choice items once every option is picked", () => {
    const m = computeMissing(index, data, computeCoverage(fixtureRecords(), data), fixtureLive());
    expect(m.filter(i => i.kind === "choice")).toEqual([]);
  });
  it("missing: unseen page lines with requirements", () => {
    const m = computeMissing(buildIndex(data), data, computeCoverage(fixtureRecords(), data), fixtureLive());
    const p = m.find(i => i.kind === "page" && i.entry.path === "촌장의 집 › 촌장 › p1")!;
    expect(p.label).toBe("이건 내 아내가 남긴 물건이네.");
    expect(p.nodePath).toEqual([6, 0, 0]);
    expect(p.requirements).toEqual([{ text: "변수: 호감도 ≥ 5", status: "unmet" }]);
    expect(p.allMet).toBe(false);
    expect(m.some(i => i.entry.path === "전투 › 슬라임 › p1")).toBe(true);
    expect(m.some(i => i.entry.path === "공통 이벤트 › 밤의 장면")).toBe(false);
  });
  it("sorts current map first, then allMet, then index order", () => {
    const m = computeMissing(index, data, computeCoverage([], data), fixtureLive());
    expect(m.map(i => [i.kind, i.entry.path, i.onCurrentMap, i.allMet])).toEqual([
      ["page", "촌장의 집 › 촌장 › p1", true, true],
      ["choice", "촌장의 집 › 촌장 › p1", true, true],
      ["choice", "촌장의 집 › 촌장 › p1", true, true],
      ["page", "촌장의 집 › 촌장 › p2", true, true],
      ["page", "촌장의 집 › \"낡은 책이 꽂혀 있다. 숲의 전설에…\" › p1", true, true],
      ["page", "공통 이벤트 › 밤의 장면", false, true],
      ["page", "전투 › 슬라임 › p1", false, true],
    ]);
    expect(m[0]).toMatchObject({ label: "왔구나, 레나.", nodePath: [0] });
    expect(m[1].nodePath).toEqual([5, 0]);
    const p2 = m.find(i => i.entry.path === "촌장의 집 › 촌장 › p2")!;
    expect(p2.requirements).toEqual([{ text: "스위치: 숲 개방 ON", status: "met" }]);
  });
  it("missing without live is all unknown", () => {
    const m = computeMissing(index, data, computeCoverage(fixtureRecords(), data), null);
    expect(m.length).toBeGreaterThan(0);
    expect(m.every(i => !i.onCurrentMap)).toBe(true);
    for (const i of m) for (const r of i.requirements) expect(r.status).toBe("unknown");
    const p = m.find(i => i.kind === "page" && i.entry.path === "촌장의 집 › 촌장 › p1")!;
    expect(p.requirements).toEqual([{ text: "변수: 호감도 ≥ 5", status: "unknown" }]);
    expect(p.allMet).toBe(false);
  });
  it("else branches invert, cancel branch is listed", () => {
    const d = withCommon([
      { code: 111, indent: 0, parameters: [0, 1, 0] },
      { code: 0, indent: 1, parameters: [] },
      { code: 411, indent: 0, parameters: [] },
      { code: 102, indent: 1, parameters: [["가", "나"], 1, 0, 2, 0] },
      { code: 402, indent: 1, parameters: [0, "가"] },
      { code: 101, indent: 2, parameters: ["", 0, 0, 2, ""] },
      { code: 401, indent: 2, parameters: ["안쪽"] },
      { code: 0, indent: 2, parameters: [] },
      { code: 402, indent: 1, parameters: [1, "나"] },
      { code: 0, indent: 2, parameters: [] },
      { code: 403, indent: 1, parameters: [6, null] },
      { code: 0, indent: 2, parameters: [] },
      { code: 404, indent: 1, parameters: [] },
      { code: 0, indent: 1, parameters: [] },
      { code: 412, indent: 0, parameters: [] },
      { code: 0, indent: 0, parameters: [] },
    ]);
    const m = computeMissing(buildIndex(d), d, computeCoverage([], d), fixtureLive());
    const off = { text: "아니라면: 스위치: 숲 개방 ON", status: "unmet" };
    const mine = m.filter(i => i.entry.path === "공통 이벤트 › 시험");
    expect(mine.map(i => [i.kind, i.label, i.nodePath, i.requirements])).toEqual([
      ["choice", "취소했을 때", [0, 1, 0, -1], [off]],
      ["choice", '"가"', [0, 1, 0, 0], [off]],
      ["choice", '"나"', [0, 1, 0, 1], [off]],
    ]);
    // 선택지 분기 안의 대사만 있는 페이지는 "page" 항목이 아니다
    const live = { ...fixtureLive(), switches: [] };
    const m2 = computeMissing(buildIndex(d), d, computeCoverage([], d), live);
    expect(m2.find(i => i.label === '"가"')!.requirements).toEqual([{ text: "아니라면: 스위치: 숲 개방 ON", status: "met" }]);
  });
  it("cancel pick (-2) and nested choice-branch requirement", () => {
    const d = withCommon([
      { code: 102, indent: 0, parameters: [["가"], -2, 0, 2, 0] },
      { code: 402, indent: 0, parameters: [0, "가"] },
      { code: 102, indent: 1, parameters: [["다"], -1, 0, 2, 0] },
      { code: 402, indent: 1, parameters: [0, "다"] },
      { code: 0, indent: 2, parameters: [] },
      { code: 404, indent: 1, parameters: [] },
      { code: 0, indent: 1, parameters: [] },
      { code: 403, indent: 0, parameters: [6, null] },
      { code: 0, indent: 1, parameters: [] },
      { code: 404, indent: 0, parameters: [] },
      { code: 0, indent: 0, parameters: [] },
    ]);
    const src = { source: "common" as const, commonEventId: 1 };
    const cov = computeCoverage([{ v: 1, seq: 1, t: 0, run: 1, branch: 1, type: "choice", src, cmd: 0, picked: -2 }], d);
    const m = computeMissing(buildIndex(d), d, cov, fixtureLive()).filter(i => i.entry.path === "공통 이벤트 › 시험");
    expect(m.map(i => i.label)).toEqual(['"가"', '"다"']);
    expect(m[1].requirements).toEqual([{ text: '선택지 "가" 선택', status: "unknown" }]);
    expect(m[1].allMet).toBe(false);
  });
  it("never throws on odd input", () => {
    const empty = { seen: new Set<string>(), picks: new Map(), uncertainSeqs: new Set<number>(), changedSeqs: new Set<number>() };
    const odd = { ...index, pages: [null as never, { ...index.pages[0], nodes: null as never, conditions: null as never }] };
    expect(() => computeMissing(odd, data, empty, fixtureLive())).not.toThrow();
  });
});

describe("computeMissing + TemplateEvent", () => {
  it("skips the template map's own pages, keeps expanded events", async () => {
    const r = await loadGame(loadFixtureFolder("sample-te"));
    if (!r.ok) throw new Error("load failed");
    const te = r.data;
    const m = computeMissing(buildIndex(te), te, computeCoverage([], te), null);
    const maps = m.map(i => (i.entry.location.source === "map" ? i.entry.location.mapId : -1));
    expect(maps).not.toContain(2);
    expect(m.map(i => i.label)).toEqual(expect.arrayContaining(["안녕하세요!", "물건 보고 가세요."]));
  });
});
