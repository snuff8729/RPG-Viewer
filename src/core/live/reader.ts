import { formatText } from "../text/escape";
import { dTextCaption } from "../text/textPicture";
import { locationKey } from "../index/locations";
import { samePictures, type ScreenPicture } from "../addons/screenPictures";
import type { GameData, Location } from "../types";
import { branchLabel, isContinuation } from "./history";
import { classifyPluginRecord, pluginKey, type PluginOverrides } from "./pluginText";
import type { HistoryItem, HistoryModel, LogRecord, RecordOf } from "./types";

export type ReaderItem =
  | { kind: "chapter"; key: string; text: string }
  /** screen: 화면 그림 따라 그리기 — 이 대사에서 화면 그림 묶음이 바뀌었을 때만(그림 번호 순) */
  | { kind: "message"; key: string; seq: number; speaker: string; face: string; faceIndex: number; lines: string[]; src: Location | null; cmd: number | null; repeat?: number; screen?: ScreenPicture[] }
  | { kind: "scroll"; key: string; seq: number; lines: string[] }
  /** name이 ""이면 화면에 글자 띄우기(파일 없음) — caption: 바로 앞 D_TEXT 플러그인 기록의 글. 글도 이름도 없는 빈 자리는 항목을 만들지 않는다. */
  | { kind: "picture"; key: string; seq: number; pictureId: number; name: string; caption?: string }
  /**
   * 이벤트가 실행한 플러그인 명령. tech = 기술 명령(기본으로 숨김). text = 글이면 고른 글(제어 문자 처리), 기술 명령이면 원문.
   * raw = 원문, name = 명령별 설정 키(pluginKey)
   */
  | { kind: "plugin"; key: string; seq: number; text: string; raw: string; name: string; tech: boolean }
  | { kind: "choice"; key: string; seq: number; label: string }
  | { kind: "battle"; key: string; seq: number };

const safe = (s: unknown): string => typeof s === "string" ? s : "";
const lines = (text: unknown, data: GameData): string[] => formatText(safe(text), data).split("\n");

function speakerOf(r: RecordOf<"message">, data: GameData): string {
  const named = safe(r.speaker) ? formatText(r.speaker, data) : "";
  if (named) return named;
  if (!r.face) return "";
  const actor = (data?.actors ?? []).find(a => a && a.faceName === r.face && a.faceIndex === r.faceIndex);
  return actor?.name ?? "";
}

function messageItem(r: RecordOf<"message">, data: GameData, repeat?: number): ReaderItem {
  const item: ReaderItem = {
    kind: "message", key: `r${r.seq}`, seq: r.seq, speaker: speakerOf(r, data), face: safe(r.face),
    faceIndex: typeof r.faceIndex === "number" ? r.faceIndex : 0, lines: lines(r.text, data),
    src: r.src ?? null, cmd: typeof r.cmd === "number" ? r.cmd : null,
  };
  if (repeat !== undefined) item.repeat = repeat;
  return item;
}

function pluginItem(r: RecordOf<"plugin">, data: GameData, overrides: PluginOverrides | null): ReaderItem {
  const raw = safe(r.text);
  const c = classifyPluginRecord(r, overrides);
  const text = c.kind === "text" ? formatText(c.text, data) : raw;
  return { kind: "plugin", key: `r${r.seq}`, seq: r.seq, text, raw, name: pluginKey(r), tech: c.kind === "tech" };
}

/** 파일 없는 그림 기록 바로 앞(같은 목록, 이어진 명령 위치)의 D_TEXT 플러그인 기록들에서 설명을 만든다. */
function pictureCaption(r: RecordOf<"picture">, before: RecordOf<"plugin">[]): string {
  if (!r.src || typeof r.cmd !== "number") return "";
  const at = locationKey(r.src);
  const texts: string[] = [];
  let want = r.cmd - 1;
  for (let i = before.length - 1; i >= 0; i--) {
    const p = before[i];
    if (!p.src || p.code !== 356 || p.cmd !== want || locationKey(p.src) !== at || !/^\s*D_TEXT/i.test(safe(p.text))) break;
    texts.unshift(safe(p.text));
    want--;
  }
  return dTextCaption(texts);
}

function pictureItem(r: RecordOf<"picture">, before: RecordOf<"plugin">[]): ReaderItem | null {
  const item: Extract<ReaderItem, { kind: "picture" }> = { kind: "picture", key: `r${r.seq}`, seq: r.seq,
    pictureId: typeof r.pictureId === "number" ? r.pictureId : 0, name: safe(r.name),
  };
  if (!item.name) {
    const caption = pictureCaption(r, before);
    // 글도 파일도 없는 빈 그림 자리는 화면에 보이는 것이 없으니 읽기에 넣지 않는다
    if (!caption) return null;
    item.caption = caption;
  }
  return item;
}

function fromRecord(
  r: LogRecord, data: GameData, choiceText: Map<number, string>, model: HistoryModel, overrides: PluginOverrides | null,
): ReaderItem | null {
  switch (r.type) {
    case "message": return messageItem(r, data);
    case "scroll": return { kind: "scroll", key: `r${r.seq}`, seq: r.seq, lines: lines(r.text, data) };
    case "picture": return pictureItem(r, []);
    case "plugin": return pluginItem(r, data, overrides);
    case "choice": {
      // historyText.pickedFallbackText와 같은 규칙: 취소(-2)는 `취소`, 그 밖은 `{n}번째 선택지`
      const label = choiceText?.get(r.seq) ?? (r.picked === -2 ? "취소" : `${r.picked + 1}번째 선택지`);
      return { kind: "choice", key: `r${r.seq}`, seq: r.seq, label };
    }
    case "transfer":
      return { kind: "chapter", key: `c${r.seq}`, text: `— ${data?.mapInfos?.[r.mapId]?.name || `#${r.mapId}`} —` };
    case "branchStart":
      // 이어진 갈래(저장 → 종료 → 이어하기)의 시작은 새 갈래 시작이 아니다
      if (isContinuation(model, r.branch)) return null;
      return { kind: "chapter", key: `c${r.seq}`, text: `— ${branchLabel(model, r.branch)} 시작 —` };
    case "battle": return r.phase === "start" ? { kind: "battle", key: `r${r.seq}`, seq: r.seq } : null;
    default: return null;
  }
}

/**
 * foldTimeline 결과를 읽기 항목으로 바꾼다(대사·그림·고른 선택·플러그인 명령·장면 구분만). 예외를 던지지 않는다.
 * model은 갈래 시작 문구(`— {n}회차 갈래 {m} 시작 —`)에 쓴다. overrides: 플러그인 명령별 보이기 설정(pluginText).
 * 플러그인 줄은 모두 넣고 tech로 표시만 한다(숨기기는 화면이 정한다).
 * pictures(화면 그림 따라 그리기, picturesBySeq): 주면 화면 그림 묶음이 앞에 보인 것과 달라진 대사에 screen을 붙인다.
 */
export function readerItems(
  items: HistoryItem[], data: GameData, choiceText: Map<number, string>, model: HistoryModel, overrides: PluginOverrides | null = null,
  pictures: Map<number, ScreenPicture[]> | null = null,
): ReaderItem[] {
  const out: ReaderItem[] = [];
  /** 바로 앞에 이어진 플러그인 기록들(글자 그림 설명용) */
  let plugins: RecordOf<"plugin">[] = [];
  /** 마지막으로 보인(또는 비어 있던) 화면 그림 묶음. null = 모름 */
  let shown: ScreenPicture[] | null = null;
  const withScreen = (item: ReaderItem | null): ReaderItem | null => {
    if (!pictures || !item || item.kind !== "message") return item;
    const now = pictures.get(item.seq) ?? null;
    if (now && now.length > 0 && !samePictures(now, shown)) item.screen = now;
    shown = now;
    return item;
  };
  for (const it of Array.isArray(items) ? items : []) {
    try {
      if (!it) continue;
      if (it.kind === "record") {
        const rec = it.record;
        const r = rec?.type === "picture" ? pictureItem(rec, plugins) : fromRecord(rec, data, choiceText, model, overrides);
        plugins = rec?.type === "plugin" ? [...plugins, rec].slice(-20) : [];
        // 화면 그림을 기록하는 중이면 그림 표시(231)는 다음 대사의 화면이 실제 모습으로 보여 주므로 따로 넣지 않는다(글자 띄우기는 남긴다)
        if (r?.kind === "picture" && r.name && shown !== null) continue;
        if (r) out.push(withScreen(r)!);
      } else if (it.kind === "repeat") {
        plugins = [];
        // 접힌 반복 대화는 화면 그림을 붙이지 않는다(접혀 있어 안 보이므로 다음 대사가 보인다)
        out.push(messageItem(it.record, data, it.count));
      }
    } catch { /* 깨진 항목은 건너뛴다 */ }
  }
  return out;
}

/** 항목이 속한 마지막 기록 seq. chapter는 null. */
export function lastSeqOf(item: ReaderItem): number | null {
  return item.kind === "chapter" ? null : item.seq;
}
