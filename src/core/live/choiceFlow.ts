import { locationKey } from "../index/locations";
import { formatText } from "../text/escape";
import type { GameData, Location } from "../types";
import { pickKey } from "./coverage";
import { branchLabel } from "./history";
import type { ReaderItem } from "./reader";
import type { Coverage, HistoryItem, HistoryModel } from "./types";

export type FlowItem =
  | { kind: "chapter"; key: string; text: string }
  | { kind: "segment"; key: string; items: ReaderItem[]; messages: number; pictures: number }
  | { kind: "choice"; key: string; seq: number; question: { speaker: string; text: string } | null;
      options: { label: string; picked: boolean; elsewhere: string[] }[] }
  | { kind: "fork"; key: string; atSeq: number; branches: number[] };

type Question = { speaker: string; text: string } | null;

const QUESTION_MAX = 40;
const safeFmt = (s: unknown, data: GameData): string => {
  const t = typeof s === "string" ? s : "";
  try { return formatText(t, data); } catch { return t; }
};
const locKey = (src: Location | null | undefined): string | null => {
  try { return src && typeof src === "object" ? locationKey(src) : null; } catch { return null; }
};
const clip = (s: string): string => { const a = [...s]; return a.length > QUESTION_MAX ? `${a.slice(0, QUESTION_MAX).join("")}…` : s; };

/**
 * 선택 흐름. HistoryItem 목록(items)을 순서대로 훑으며, 기록/반복 항목마다 reader의 다음 항목
 * (키가 r{seq}/c{seq}로 맞을 때만)을 하나씩 소비해 두 목록을 나란히 걷는다.
 * fork 항목은 reader에 없으므로 그 자리에서 구간을 끊고 fork로 넣는다.
 * choices 기록도 reader엔 없지만 옵션·질문 계산을 위해 훑으며 기억한다. 예외를 던지지 않는다.
 */
export function choiceFlow(args: {
  items: HistoryItem[]; reader: ReaderItem[];
  data: GameData; model: HistoryModel; coverage: Coverage; branch: number; choiceText: Map<number, string>;
}): FlowItem[] {
  const out: FlowItem[] = [];
  try {
    const { data, model, coverage, branch } = args;
    const items = Array.isArray(args.items) ? args.items : [];
    const reader = Array.isArray(args.reader) ? args.reader : [];
    let ri = 0;
    let seg: ReaderItem[] = [];
    const flushSeg = () => {
      const list = seg;
      seg = [];
      let boxes = 0, messages = 0, pictures = 0;
      for (const i of list) {
        if (i.kind === "message" || i.kind === "scroll") {
          boxes++;
          if (!(i.kind === "message" && i.repeat !== undefined)) messages += Array.isArray(i.lines) ? i.lines.length : 0;   // 반복 항목은 줄 수에서 제외
        } else if (i.kind === "picture") pictures++;
      }
      if (boxes === 0 && pictures === 0) return;
      out.push({ kind: "segment", key: `s${list[0].key}`, items: list, messages, pictures });
    };

    const lastOptions = new Map<string, string[]>();   // 위치+cmd → 직전 choices 옵션
    let lastMsg: Extract<ReaderItem, { kind: "message" }> | null = null;
    let pending: { k: string | null; question: Question } | null = null;
    // key → reader 위치들(오름차순). 위치는 앞으로만 움직이고, 없으면 위치를 유지한 채 이 기록만 건너뛴다.
    const readerIdx = new Map<string, number[]>();
    reader.forEach((it, j) => {
      const k = it?.key;
      if (typeof k !== "string") return;
      const a = readerIdx.get(k);
      if (a) a.push(j); else readerIdx.set(k, [j]);
    });
    const pathSeqs = new Set<number>();
    for (const h of items) {
      if (h && (h.kind === "record" || h.kind === "repeat") && h.record) pathSeqs.add(h.record.seq);
    }
    const take = (key: string): ReaderItem | null => {
      const a = readerIdx.get(key);
      if (!a) return null;
      for (const j of a) {
        if (j >= ri) { ri = j + 1; return reader[j]; }
      }
      return null;
    };

    for (const h of items) {
      try {
        if (!h) continue;
        if (h.kind === "fork") {
          flushSeg();
          out.push({ kind: "fork", key: `f${h.atSeq}`, atSeq: h.atSeq, branches: Array.isArray(h.branches) ? h.branches : [] });
        } else if (h.kind === "repeat") {
          const it = take(`r${h.record.seq}`);
          if (it) { seg.push(it); if (it.kind === "message") lastMsg = it; }
        } else if (h.kind === "record") {
          const r = h.record;
          if (r.type === "choices") {
            const k = locKey(r.src);
            if (k !== null) lastOptions.set(`${k}#${r.cmd}`, Array.isArray(r.options) ? r.options : []);
            const q = lastMsg && k !== null && locKey(lastMsg.src) === k ? lastMsg : null;
            pending = { k, question: q ? { speaker: q.speaker, text: clip(safeFmt(q.lines[0], data)) } : null };
            continue;
          }
          const it = take(r.type === "transfer" || r.type === "branchStart" ? `c${r.seq}` : `r${r.seq}`);
          if (!it) continue;
          if (it.kind === "chapter") {
            flushSeg();
            out.push(it);
          } else if (it.kind === "choice" && r.type === "choice") {
            flushSeg();
            const k = locKey(r.src);
            const labels = (k !== null ? lastOptions.get(`${k}#${r.cmd}`) ?? [] : []).map(o => safeFmt(o, data));
            // 취소(-2)는 `취소` 항목을 더해 고른 것으로 친다
            const cancel = r.picked === -2;
            if (cancel) labels.push("취소");
            const infos = k !== null && r.src ? coverage?.picks?.get(pickKey(r.src, r.cmd)) ?? [] : [];
            const options = labels.map((label, i) => {
              const idx = cancel && i === labels.length - 1 ? -2 : i;
              const elsewhere: string[] = [];
              for (const p of infos) {
                if (p.branch === branch || p.seq === r.seq || p.picked !== idx || pathSeqs.has(p.seq)) continue;   // 이 기록 자신(상속된 선택 포함)은 제외
                const bl = branchLabel(model, p.branch);
                if (!elsewhere.includes(bl)) elsewhere.push(bl);
              }
              return { label, picked: idx === r.picked, elsewhere };
            });
            if (!options.some(o => o.picked)) {
              // 이 경로에 choices 기록이 없거나 picked가 범위를 벗어나면 reader 라벨로 고른 옵션을 보인다
              const label = typeof it.label === "string" ? it.label : "";
              if (label) options.push({ label, picked: true, elsewhere: [] });
            }
            const question = pending && pending.k === k ? pending.question : null;
            pending = null;
            out.push({ kind: "choice", key: it.key, seq: it.seq, question, options });
          } else {
            seg.push(it);
            if (it.kind === "message") lastMsg = it;
          }
        }
      } catch { /* 깨진 항목은 건너뛴다 */ }
    }
    flushSeg();
  } catch { /* 빈 결과 */ }
  return out;
}
