import { beforeAll, describe, expect, it } from "vitest";
import { fixtureRecords } from "../../../tests/helpers/fixtureLog";
import { synthLog } from "../../../tests/helpers/synthLog";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { choiceTexts } from "../../ui/live/historyText";
import { loadGame } from "../loader/loadGame";
import type { GameData } from "../types";
import { picturesBySeq, scenesBySeq, type PictureContext } from "../addons/screenPictures";
import { branchPath, buildHistory, foldTimeline, foldTimelineFrom, noisyVariables, representative, type FoldCache } from "./history";
import { readerItems, readerItemsFrom, type ReaderCache, type ReaderItemsOptions } from "./reader";
import type { LogRecord } from "./types";

let data: GameData;
beforeAll(async () => {
  const r = await loadGame(loadFixtureFolder("sample-mz"));
  if (!r.ok) throw new Error("load failed");
  data = r.data;
});

interface Scenario {
  scenes?: boolean;
  opts?: Omit<ReaderItemsOptions, "compose">;
  /** 볼 갈래: 없으면 지금 최신 갈래 */
  branch?: number;
}

const ctx: PictureContext = { screen: { width: 816, height: 624 } };

/**
 * 기록을 하나씩 덧붙이며 이어 만들기(foldTimelineFrom → readerItemsFrom)와 처음부터 만들기를 비교한다.
 * 앞에서 내준 결과가 뒤에 바뀌지 않는지도 본다. 이어 쓴 횟수를 돌려준다.
 */
function replay(all: LogRecord[], sc: Scenario, step = 1): { foldResumed: number; readerResumed: number; steps: number } {
  let fc: FoldCache | null = null;
  let rc: ReaderCache | null = null;
  let prevOut: { items: unknown; json: string } | null = null;
  let foldResumed = 0, readerResumed = 0, steps = 0;
  for (let k = 1; k <= all.length; k += step) {
    const recs = all.slice(0, k);
    const model = buildHistory(recs);
    const branch = sc.branch ?? model.latestBranch;
    if (branch === null) continue;
    const path = branchPath(recs, model, representative(model, branch));
    // 불확실한 기록 표시는 새 기록에만 붙는다(앞의 기록에 붙으면 처음부터 다시 접는다 — 그것도 같아야 한다)
    const uncertainSeqs = new Set(recs.filter(r => r.seq % 37 === 0).map(r => r.seq));
    const changedSeqs = new Set(recs.filter(r => r.seq % 41 === 0).map(r => r.seq));
    const foldOpts = { uncertainSeqs, changedSeqs, noisy: noisyVariables(recs), isHiddenImage: null };
    const scenes = sc.scenes ? scenesBySeq(picturesBySeq(path), ctx) : null;
    const opts: ReaderItemsOptions = { ...sc.opts, compose: { ctx } };
    const choices = choiceTexts(path, data);

    const f = foldTimelineFrom(path, model, foldOpts, fc);
    const wantFold = foldTimeline(path, model, foldOpts);
    expect(f.items).toEqual(wantFold);
    const r = readerItemsFrom(f, data, choices, model, null, scenes, opts, rc);
    const want = readerItems(wantFold, data, choices, model, null, scenes, opts);
    expect(r.items).toEqual(want);
    // 앞에서 내준 결과는 그대로다
    if (prevOut) expect(JSON.stringify(prevOut.items)).toBe(prevOut.json);
    prevOut = { items: r.items, json: JSON.stringify(r.items) };
    if (f.resumed) foldResumed++;
    if (rc && rc.state && f.resumed && r.cache.used > 0 && rc.used > 0) readerResumed++;
    fc = f.cache;
    rc = r.cache;
    steps++;
  }
  return { foldResumed, readerResumed, steps };
}

describe("incremental reader build (foldTimelineFrom + readerItemsFrom)", () => {
  it("matches a full rebuild after every appended record (plain log)", () => {
    for (const seed of [1, 2, 3]) {
      const res = replay(synthLog(seed, 260), {});
      // 대부분은 이어서 만든다(잦은 변수가 생기는 순간 등만 처음부터)
      expect(res.foldResumed).toBeGreaterThan(res.steps / 2);
      expect(res.readerResumed).toBeGreaterThan(res.steps / 2);
    }
  });

  it("matches with screen pictures (pics, screen records, cut-ins) on", () => {
    for (const seed of [4, 5, 6]) {
      const res = replay(synthLog(seed, 240, { pics: true }), { scenes: true });
      expect(res.foldResumed).toBeGreaterThan(res.steps / 2);
    }
  });

  it("matches with battles / notices hidden and notice kinds filtered", () => {
    const log = synthLog(7, 200, { pics: true });
    replay(log, { opts: { battles: false } });
    replay(log, { opts: { notices: false }, scenes: true });
    replay(log, { opts: { hiddenNoticeKinds: new Set(["gain"]) } });
  });

  it("matches across new branches (forks and save-load continuations) and when watching an older branch", () => {
    for (const seed of [8, 9]) {
      const log = synthLog(seed, 260, { forks: true });
      replay(log, {});
      replay(log, { branch: 1 });
    }
  });

  it("matches when several records arrive at once", () => {
    replay(synthLog(10, 300, { pics: true, forks: true }), { scenes: true }, 7);
  });

  it("matches on the sample fixture log", () => {
    const log = fixtureRecords();
    replay(log, {});
    replay(log, { branch: 1 });
  });

  it("starts over (and stays equal) when settings or the earlier records change", () => {
    const log = synthLog(11, 120);
    const model = buildHistory(log);
    const path = branchPath(log, model, 1);
    const noisy = noisyVariables(log);
    const half = path.slice(0, 60);
    const f1 = foldTimelineFrom(half, model, { noisy }, null);
    const r1 = readerItemsFrom(f1, data, new Map(), model, null, null, {}, null);
    // 앞의 기록이 바뀜(지우기) → 처음부터
    const edited = path.filter(r => r.seq !== half[10].seq);
    const f2 = foldTimelineFrom(edited, model, { noisy }, f1.cache);
    expect(f2.resumed).toBe(false);
    expect(f2.items).toEqual(foldTimeline(edited, model, { noisy }));
    // 설정이 바뀜 → 읽기 항목은 처음부터
    const f3 = foldTimelineFrom(path, model, { noisy }, f1.cache);
    expect(f3.resumed).toBe(true);
    const r3 = readerItemsFrom(f3, data, new Map(), model, null, null, { battles: false }, r1.cache);
    expect(r3.items).toEqual(readerItems(foldTimeline(path, model, { noisy }), data, new Map(), model, null, null, { battles: false }));
    // 잦은 변수가 바뀜 → 처음부터
    const f4 = foldTimelineFrom(path, model, { noisy: new Set([...noisy, 999]) }, f3.cache);
    expect(f4.resumed).toBe(false);
    // 앞의 기록이 불확실해짐 → 처음부터
    const f5 = foldTimelineFrom(path, model, { noisy, uncertainSeqs: new Set([path[3].seq]) }, f3.cache);
    expect(f5.resumed).toBe(false);
    expect(f5.items).toEqual(foldTimeline(path, model, { noisy, uncertainSeqs: new Set([path[3].seq]) }));
  });
});
