import type { LogRecord } from "../../src/core/live/types";

/** 결정적인 난수 */
export function rng(seed: number) {
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
export function synthLog(seed: number, n: number, opts: { pics?: boolean; forks?: boolean } = {}): LogRecord[] {
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
