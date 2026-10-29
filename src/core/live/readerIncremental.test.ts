import { beforeAll, describe, expect, it } from "vitest";
import { fixtureRecords } from "../../../tests/helpers/fixtureLog";
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

/** 결정적인 난수 */
function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

const srcA = { source: "map", mapId: 1, eventId: 2, page: 0 } as const;
const srcB = { source: "map", mapId: 2, eventId: 3, page: 0 } as const;
const STAND = (name: string, opacity = 255) => [110, name, 0, 0, 0, 100, 100, opacity, 0, 0, 0, 300, 600];
const CG = (name: string) => [60, name, 0, 0, 0, 100, 100, 255, 0, 0, 0, 816, 624];
const CUT = [1000, "cutin_full", 0, 0, 0, 100, 100, 255, 0, 0, 0, 816, 624, "sprite"];

/**
 * 대사(같은 대화 반복 포함)·선택·상태 변경(잦은 변수 포함)·전투(같은 전투 반복, 끝 없는 전투, 알림 문구)·그림 명령(표시·이동·지우기,
 * 글자 그림, 잠깐 띄운 컷인)·화면 기록·화면 그림(pics)·알림 문구·이동·플러그인·저장/불러오기 갈래가 섞인 기록.
 */
function synthLog(seed: number, n: number, opts: { pics?: boolean; forks?: boolean } = {}): LogRecord[] {
  const rnd = rng(seed);
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
  const out: LogRecord[] = [];
  let seq = 0, t = 1_000_000, branch = 1, lastSave = 0;
  const add = (r: Record<string, unknown>) => { seq++; t += pick([100, 300, 1000, 2500]); out.push({ v: 1, run: 1, branch, seq, t, ...r } as unknown as LogRecord); };
  const pics = () => (opts.pics ? (rnd() < 0.3 ? { picsSame: true } : { pics: pick([[STAND("a")], [STAND("b"), CG("cg1")], [CG("cg2")], [STAND("a", 128)], []]) }) : {});
  const episode = (src: typeof srcA | typeof srcB, cmds: number[], text: string) => {
    for (const cmd of cmds) add({ type: "message", src, cmd, face: pick(["", "People1"]), faceIndex: 0, speaker: pick(["", "촌장"]), text: `${text} ${cmd}`, ...pics() });
  };
  add({ type: "branchStart", reason: "newGame", parentBranch: null, fromSeq: null });
  while (out.length < n) {
    const r = rnd();
    if (r < 0.2) episode(pick([srcA, srcB]), pick([[1, 2], [1, 2], [5], [7, 8, 9]]), pick(["안녕", "또 안녕"]));
    else if (r < 0.27) {
      const src = pick([srcA, srcB]);
      add({ type: "choices", src, cmd: 20, options: ["네", "아니요"] });
      add({ type: "choice", src, cmd: 20, picked: pick([0, 1, -2]) });
    } else if (r < 0.37) add({ type: "state", src: pick([null, srcA]), cmd: null, changes: [{ kind: pick(["variable", "switch"]), id: pick([3, 7, 7, 7, 11]), value: Math.floor(rnd() * 5) }] });
    else if (r < 0.45) {
      // 전투(같은 전투가 이어서 나오기도 한다). 끝 기록 없이 이동으로 끊기기도 한다.
      add({ type: "battle", phase: "start", troopId: 1, troopName: "슬라임", enemies: [], canEscape: true, canLose: false, ...(opts.pics ? { pics: [CG("battle")] } : {}) });
      const lines = pick([1, 2, 2]);
      for (let i = 0; i < lines; i++) add({ type: "battlelog", text: `슬라임에게 ${i} 데미지`, ...(opts.pics && i === 0 ? { pics: [CG("battle"), STAND("hit")] } : {}) });
      if (rnd() < 0.3) add({ type: "notice", source: "ticker", text: "레벨 업!" });
      if (rnd() < 0.8) add({ type: "battle", phase: "end", troopId: 1, result: "win", rewards: { exp: 10, gold: 5, items: [] } });
      else add({ type: "transfer", mapId: 2, x: 1, y: 1 });
    } else if (r < 0.55) {
      // 그림 명령: 표시 → (이동) → 지우기, 사이가 길면 따로 보이는 묶음
      const id = pick([1, 2, 5]);
      add({ type: "picture", src: srcA, cmd: 30, pictureId: id, name: pick(["village_map", "Cutin_A", "Cutin_B"]), x: 0, y: 0 });
      if (rnd() < 0.5) add({ type: "picture", src: srcA, cmd: 31, pictureId: id, name: "", op: "move", x: 10, y: 20, opacity: 200 });
      if (rnd() < 0.6) add({ type: "picture", src: srcA, cmd: 32, pictureId: id, name: "", op: "erase" });
    } else if (r < 0.6) {
      // 글자 그림: D_TEXT 플러그인 기록 바로 뒤의 이름 없는 그림
      add({ type: "plugin", src: srcB, cmd: 40, code: 356, text: "D_TEXT 안내문 24" });
      add({ type: "picture", src: srcB, cmd: 41, pictureId: 9, name: "", x: 0, y: 0 });
    } else if (r < 0.66) add({ type: "notice", source: pick(["ticker", "comment"]), text: pick(["아이템 획득", "퀘스트 갱신"]), ...(rnd() < 0.5 ? { kind: "gain" } : {}) });
    else if (r < 0.71 && opts.pics) add({ type: "screen", scene: "map", pics: pick([[CUT], [STAND("a")], [STAND("a", 60)], [STAND("a", 200)], []]) });
    else if (r < 0.75) add({ type: "transfer", mapId: pick([1, 2, 3]), x: 0, y: 0 });
    else if (r < 0.8) add({ type: "plugin", src: srcA, cmd: 50, code: 357, text: "SomePlugin 명령" });
    else if (r < 0.85) { add({ type: "save", slot: 1 }); lastSave = seq; }
    else if (r < 0.88 && opts.forks && lastSave > 0) {
      // 불러오기: 저장 뒤 이야기가 있었으면 새 갈래(갈래 지점), 없었으면 이어진 갈래
      const parent = branch;
      branch++;
      add({ type: "branchStart", reason: "load", parentBranch: parent, fromSeq: lastSave });
      add({ type: "load", slot: 1 });
    } else episode(srcA, [1, 2], "안녕");
  }
  return out;
}

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
