import { beforeAll, describe, expect, it } from "vitest";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { rng, synthLog } from "../../../tests/helpers/synthLog";
import { ChoiceTextsCache, choiceTexts } from "../../ui/live/historyText";
import { countLines, LineCounter } from "../../ui/live/mobilePlay";
import { CommandNamesScan, commandPictureNames, factsOf, ScreenSizeMarksScan, SnapshotScan } from "../addons/pictureScans";
import { hudKeys, hudKeysOfTally, picturesBySeq, scenesBySeq, screenSizeMarks, snapshotCounts, type PictureContext } from "../addons/screenPictures";
import { loadGame } from "../loader/loadGame";
import type { GameData } from "../types";
import { branchPath, buildHistory, foldTimeline, foldTimelineFrom, noisyVariables, type FoldCache } from "./history";
import { extendsArray, newLineage, tagLineage } from "./lineage";
import { withoutMenuRecords, type MenuCommonEvents } from "./menuScenes";
import { hasLayeredPictures, pictureVarIds } from "./pictureStack";
import { BranchPathCache, MenuFilterCache, PathFactsCache, ScenesCache } from "./readerPath";
import type { LogRecord } from "./types";

let data: GameData;
beforeAll(async () => {
  const r = await loadGame(loadFixtureFolder("sample-mz"));
  if (!r.ok) throw new Error("load failed");
  data = r.data;
});

const MENU: MenuCommonEvents = { direct: new Set([7]), called: new Set([7, 9]), after: 8 };
const STAND = (name: string, x = 0) => [110, name, 0, x, 0, 100, 100, 255, 0, 0, 0, 300, 600];

/** synthLog에 메뉴 커먼 이벤트 기록·화면 크기(sw·sh)·장식 그림을 섞는다(seq는 다시 매긴다). */
function richLog(seed: number, n: number): LogRecord[] {
  const rnd = rng(seed);
  const out: LogRecord[] = [];
  let seq = 0;
  for (const r of synthLog(seed, n, { pics: true, forks: true })) {
    const o = { ...r } as Record<string, unknown>;
    if (o.type === "message" && rnd() < 0.2) { o.sw = rnd() < 0.5 ? 816 : 1280; o.sh = o.sw === 816 ? 624 : 720; }
    if (o.type === "message" && Array.isArray(o.pics)) o.pics = [...(o.pics as unknown[]), STAND("hud_icon", 700)];
    out.push({ ...o, seq: ++seq } as unknown as LogRecord);
    if (rnd() < 0.05) {
      const base = { v: 1, run: r.run, branch: r.branch, t: r.t };
      const menuSrc = { source: "common", commonEventId: rnd() < 0.5 ? 7 : 9 };
      out.push({ ...base, seq: ++seq, type: "picture", src: menuSrc, cmd: 1, pictureId: 3, name: "menu_bg", x: 0, y: 0 } as unknown as LogRecord);
      out.push({ ...base, seq: ++seq, type: "message", src: menuSrc, cmd: 2, face: "", faceIndex: 0, speaker: "", text: "메뉴", pics: [STAND("menu_bg")] } as unknown as LogRecord);
      if (rnd() < 0.5) out.push({ ...base, seq: ++seq, type: "state", src: { source: "common", commonEventId: 8 }, cmd: 0, changes: [] } as unknown as LogRecord);
    }
  }
  return out;
}

const ctx: PictureContext = { screen: { width: 816, height: 624 } };

describe("lineage", () => {
  it("only arrays tagged with the same lineage extend each other", () => {
    const id = newLineage();
    const a = tagLineage([1, 2], id);
    const b = tagLineage([1, 2, 3], id);
    expect(extendsArray(a, b)).toBe(true);
    expect(extendsArray(b, a)).toBe(false); // shorter
    expect(extendsArray(a, a)).toBe(true);
    expect(extendsArray(a, tagLineage([1, 2, 3], newLineage()))).toBe(false);
    expect(extendsArray([1], [1, 2])).toBe(false); // untagged
    expect(extendsArray(null, b)).toBe(false);
  });
});

describe("incremental reader derivations", () => {
  /**
   * 기록을 조금씩 덧붙이며(LiveProvider처럼 줄기 표시가 붙은 사본) 이어 만든 것과 처음부터 만든 것을 비교한다.
   * 중간에 기록을 처음부터 다시 읽는 경우(새 줄기)와 갈래를 바꾸는 경우도 섞는다.
   */
  function replay(all: LogRecord[], keepMenu: boolean) {
    const c = {
      bp: new BranchPathCache(), menu: new MenuFilterCache(), facts: new PathFactsCache(), scenes: new ScenesCache(), choices: new ChoiceTextsCache(),
      marks: new ScreenSizeMarksScan(), snaps: new SnapshotScan(), names: new CommandNamesScan(), lines: new LineCounter(),
    };
    let lineage = newLineage();
    let fc: FoldCache | null = null;
    let resumedFolds = 0, steps = 0;
    const rnd = rng(7);
    for (let k = 1; k <= all.length; k += 1 + Math.floor(rnd() * 4)) {
      if (k === Math.floor(all.length / 2)) lineage = newLineage(); // 기록을 처음부터 다시 읽음
      const recs = tagLineage(all.slice(0, k), lineage);
      const model = buildHistory(recs);
      const latest = model.latestBranch;
      if (latest === null) continue;
      // 가끔 다른 갈래를 본다
      const branch = rnd() < 0.1 ? [...model.branches.keys()][0] : latest;
      steps++;

      const path = c.menu.get(c.bp.get(recs, model, branch), keepMenu, MENU);
      const want = withoutMenuRecords(branchPath(recs, model, branch), keepMenu, MENU);
      expect(path).toEqual(want);

      const f = c.facts.get(path, data);
      expect([...f.pictures.entries()]).toEqual([...picturesBySeq(want).entries()]);
      expect(f.varIds).toEqual(pictureVarIds(want, data));
      expect(f.layered).toBe(hasLayeredPictures(want));
      expect(f.hasPictureRecords).toBe(want.some(r => r.type === "picture" && r.op === undefined && !!r.name));
      expect(JSON.stringify([...c.scenes.get(f.pictures, ctx)])).toBe(JSON.stringify([...scenesBySeq(picturesBySeq(want), ctx)]));
      expect([...c.choices.get(path, data)]).toEqual([...choiceTexts(want, data)]);

      expect(c.marks.get(recs)).toEqual(screenSizeMarks(recs));
      const snaps = c.snaps.get(recs);
      const batch = factsOf(snapshotCounts(recs));
      expect(snaps.total).toBe(batch.total);
      expect(snaps.names).toEqual(batch.names);
      expect(new Map([...snaps.tally].map(([k, v]) => [k, v.n]))).toEqual(new Map([...batch.tally].map(([k, v]) => [k, v.n])));
      expect(new Map([...snaps.tally].map(([k, v]) => [k, v.p]))).toEqual(new Map([...batch.tally].map(([k, v]) => [k, v.p])));
      expect([...hudKeysOfTally(snaps.tally, snaps.total, ctx.screen)].sort()).toEqual([...hudKeys(snapshotCounts(recs), ctx.screen)].sort());
      expect([...c.names.get(recs)].sort()).toEqual([...commandPictureNames(recs)].sort());
      expect(c.lines.count(recs)).toBe(countLines(recs));

      // 줄기 표시가 붙은 경로로 이어 접기: 처음부터 접은 것과 같다
      const foldOpts = { noisy: noisyVariables(recs), isHiddenImage: null };
      const fr = foldTimelineFrom(path, model, foldOpts, fc);
      expect(fr.items).toEqual(foldTimeline(want, model, foldOpts));
      if (fr.resumed) resumedFolds++;
      fc = fr.cache;
    }
    return { steps, resumedFolds };
  }

  it("match the batch functions while records are appended (menu pictures removed)", () => {
    const r = replay(richLog(11, 500), false);
    expect(r.steps).toBeGreaterThan(50);
    expect(r.resumedFolds).toBeGreaterThan(r.steps / 3);
  });

  it("match the batch functions with menu pictures kept", () => {
    replay(richLog(23, 300), true);
  });

  it("returns the same objects while nothing new is relevant, new ones when it grows", () => {
    const all = richLog(5, 200);
    const id = newLineage();
    const a = tagLineage(all.slice(0, 150), id);
    const model = buildHistory(all);
    const bp = new BranchPathCache();
    const facts = new PathFactsCache();
    const p1 = bp.get(a, model, model.latestBranch!);
    const f1 = facts.get(p1, data);
    expect(bp.get(a, model, model.latestBranch!)).toBe(p1);
    expect(facts.get(p1, data)).toBe(f1);
    const b = tagLineage(all.slice(0, 200), id);
    const p2 = bp.get(b, model, model.latestBranch!);
    expect(p2).not.toBe(p1);
    expect(p1).toEqual(branchPath(a, model, model.latestBranch!)); // the earlier result is unchanged
    expect(extendsArray(p1, p2)).toBe(true);
  });

  it("falls back to a full rebuild for records out of seq order", () => {
    const all = richLog(3, 120);
    const id = newLineage();
    const model = buildHistory(all);
    const bp = new BranchPathCache();
    bp.get(tagLineage(all.slice(0, 60), id), model, model.latestBranch!);
    const swapped = all.slice(0, 80);
    [swapped[70], swapped[71]] = [swapped[71], swapped[70]];
    const recs = tagLineage(all.slice(0, 60).concat(swapped.slice(60)), id);
    expect(bp.get(recs, model, model.latestBranch!)).toEqual(branchPath(recs, model, model.latestBranch!));
    const snaps = new SnapshotScan();
    snaps.get(tagLineage(recs.slice(0, 60), id));
    expect(snaps.get(recs).total).toBe(factsOf(snapshotCounts(recs)).total);
  });
});

