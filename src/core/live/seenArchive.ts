// 본 기록 보관(rpg-viewer/seen-archive.json): 갈래를 영구 삭제해도 진행도(본 대사·고른 선택·실행된 페이지·플러그인 명령)가
// 그대로 남도록, 지운 기록이 보태던 진행도만 따로 적어 두고 불러올 때 합친다. 예외를 던지지 않는다.
import type { Coverage, PickInfo } from "./types";

export const SEEN_ARCHIVE_VERSION = 1;

export interface SeenArchive {
  v: 1;
  /** 마지막으로 고친 시각 */
  t: number;
  seen: string[];
  touched: string[];
  pluginRan: string[];
  /** pickKey → 선택들(seq로 구분). 남은 기록에 같은 seq 선택이 있으면 결과(aftermath)를 보탠다. */
  picks: Record<string, PickInfo[]>;
  uncertainSeqs: number[];
  changedSeqs: number[];
}

export const emptyArchive = (): SeenArchive => ({
  v: 1, t: 0, seen: [], touched: [], pluginRan: [], picks: {}, uncertainSeqs: [], changedSeqs: [],
});

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === "number" && Number.isFinite(x)) : []);

function parsePick(v: unknown): PickInfo | null {
  if (!isObj(v)) return null;
  const { picked, run, branch, seq } = v;
  if (typeof picked !== "number" || typeof run !== "number" || typeof branch !== "number" || typeof seq !== "number") return null;
  return { picked, run, branch, seq, aftermath: strs(v.aftermath) };
}

/** seen-archive.json 원문 → 보관. 없거나 해석 못 하면 null. */
export function parseSeenArchive(text: string | null | undefined): SeenArchive | null {
  if (typeof text !== "string" || text.trim() === "") return null;
  try {
    const o = JSON.parse(text) as unknown;
    if (!isObj(o) || o.v !== SEEN_ARCHIVE_VERSION) return null;
    const picks: Record<string, PickInfo[]> = {};
    if (isObj(o.picks)) {
      for (const [k, list] of Object.entries(o.picks)) {
        const l = (Array.isArray(list) ? list : []).map(parsePick).filter((p): p is PickInfo => p !== null);
        if (l.length > 0) picks[k] = l;
      }
    }
    return {
      v: 1, t: typeof o.t === "number" ? o.t : 0,
      seen: strs(o.seen), touched: strs(o.touched), pluginRan: strs(o.pluginRan), picks,
      uncertainSeqs: nums(o.uncertainSeqs), changedSeqs: nums(o.changedSeqs),
    };
  } catch { return null; }
}

export function serializeSeenArchive(a: SeenArchive): string {
  return JSON.stringify(a) + "\n";
}

function isEmptyArchive(a: SeenArchive): boolean {
  return a.seen.length === 0 && a.touched.length === 0 && a.pluginRan.length === 0 && Object.keys(a.picks).length === 0
    && a.uncertainSeqs.length === 0 && a.changedSeqs.length === 0;
}

/**
 * 기록에서 계산한 진행도에 보관을 합친다(새 객체, 입력은 바꾸지 않는다). 보관이 없거나 비면 cov 그대로.
 * 선택: 같은 키·같은 seq가 이미 있으면 보관의 결과를 쓴다(남은 기록의 결과가 더 길면 — 지운 뒤 새로 이어진 기록 — 그쪽), 보관이 보탠 키의 목록은 seq 순으로 정렬한다.
 */
export function mergeSeenArchive(cov: Coverage, archive: SeenArchive | null | undefined): Coverage {
  if (!archive || isEmptyArchive(archive)) return cov;
  try {
    const picks = new Map<string, PickInfo[]>(cov.picks);
    for (const [key, list] of Object.entries(archive.picks)) {
      const cur = (picks.get(key) ?? []).slice();
      for (const p of list) {
        const i = cur.findIndex(q => q.seq === p.seq);
        if (i < 0) cur.push({ ...p, aftermath: p.aftermath.slice() });
        else if (p.aftermath.length >= cur[i].aftermath.length) cur[i] = { ...cur[i], aftermath: p.aftermath.slice() };
      }
      cur.sort((a, b) => a.seq - b.seq);
      picks.set(key, cur);
    }
    const union = <T>(a: Set<T>, b: T[]) => {
      if (b.length === 0) return a;
      const s = new Set(a);
      for (const x of b) s.add(x);
      return s;
    };
    return {
      seen: union(cov.seen, archive.seen),
      picks,
      uncertainSeqs: union(cov.uncertainSeqs, archive.uncertainSeqs),
      changedSeqs: union(cov.changedSeqs, archive.changedSeqs),
      touched: union(cov.touched, archive.touched),
      pluginRan: union(cov.pluginRan, archive.pluginRan),
    };
  } catch { return cov; }
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * 새 보관: full(지우기 전 진행도 = 원래 기록 + 이전 보관)에서 rest(남는 기록의 진행도)로는 나오지 않는 것만 담는다.
 * mergeSeenArchive(rest, 결과)가 full과 같아진다.
 */
export function buildSeenArchive(full: Coverage, rest: Coverage, now: number): SeenArchive {
  const a = emptyArchive();
  a.t = now;
  try {
    const diff = <T>(x: Set<T>, y: Set<T>) => [...x].filter(k => !y.has(k));
    a.seen = diff(full.seen, rest.seen);
    a.touched = diff(full.touched, rest.touched);
    a.pluginRan = diff(full.pluginRan, rest.pluginRan);
    a.uncertainSeqs = diff(full.uncertainSeqs, rest.uncertainSeqs);
    a.changedSeqs = diff(full.changedSeqs, rest.changedSeqs);
    for (const [key, list] of full.picks) {
      const restList = rest.picks.get(key) ?? [];
      const need = list.filter(p => {
        const q = restList.find(x => x.seq === p.seq);
        return !q || !sameList(q.aftermath, p.aftermath);
      });
      if (need.length > 0) a.picks[key] = need.map(p => ({ ...p, aftermath: p.aftermath.slice() }));
    }
  } catch { /* 빈 보관 */ }
  return a;
}
