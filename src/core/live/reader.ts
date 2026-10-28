import { formatText } from "../text/escape";
import { battleActionOf, battleLogText, type BattleAction } from "./battleLine";
import { dTextCaption } from "../text/textPicture";
import { locationKey } from "../index/locations";
import { nextShot, type ScreenScene, type ScreenShot } from "../addons/screenPictures";
import { noticeSourceLabel } from "../addons/notices";
import type { GameData, Location } from "../types";
import { branchLabel, isContinuation } from "./history";
import { classifyPluginRecord, pluginKey, type PluginOverrides } from "./pluginText";
import type { HistoryItem, HistoryModel, LogRecord, RecordOf } from "./types";

export type ReaderItem =
  | { kind: "chapter"; key: string; text: string }
  /** screen: 화면 그림 따라 그리기 — 이 대사에서 새로 보일 이벤트 그림·스탠딩(nextShot)이 있을 때만 */
  | { kind: "message"; key: string; seq: number; speaker: string; face: string; faceIndex: number; lines: string[]; src: Location | null; cmd: number | null; repeat?: number; screen?: ScreenShot }
  | { kind: "scroll"; key: string; seq: number; lines: string[] }
  /** name이 ""이면 화면에 글자 띄우기(파일 없음) — caption: 바로 앞 D_TEXT 플러그인 기록의 글. 글도 이름도 없는 빈 자리는 항목을 만들지 않는다. */
  | { kind: "picture"; key: string; seq: number; pictureId: number; name: string; caption?: string }
  /**
   * 이벤트가 실행한 플러그인 명령. tech = 기술 명령(기본으로 숨김). text = 글이면 고른 글(제어 문자 처리), 기술 명령이면 원문.
   * raw = 원문, name = 명령별 설정 키(pluginKey)
   */
  | { kind: "plugin"; key: string; seq: number; text: string; raw: string; name: string; tech: boolean }
  | { kind: "choice"; key: string; seq: number; label: string }
  /**
   * 전투 한 번(foldTimeline의 battle 묶음). key = 시작 기록(r{시작 seq}), seq = 묶음의 마지막 읽기 기록 seq.
   * troop = 적 무리 이름, result = 결과(null = 진행 중·모름), items = 안의 대사·그림·선택·플러그인·전투 로그(battlelog),
   * logLines = 전투 로그 줄 수, dropped = 플러그인이 줄 수 제한으로 안 남긴 줄 수, rewards = 승리 보상 글(없으면 null),
   * repeat = 같은 전투를 다시 본 횟수(0 = 처음), screen·endScreen = 시작·끝에 새로 보일 화면 그림.
   */
  | {
    kind: "battle"; key: string; seq: number; troop: string; result: BattleResult | null; ended: boolean;
    items: ReaderItem[]; logLines: number; dropped: number; rewards: string | null; repeat: number;
    screen?: ScreenShot; endScreen?: ScreenShot;
  }
  /** 전투 로그 한 줄(제어 문자·줄 태그 처리). action: 기술·아이템 사용 줄. screen: 이 줄에서 새로 보일 화면 그림 */
  | { kind: "battlelog"; key: string; seq: number; text: string; action?: BattleAction; screen?: ScreenShot }
  /** 1.9.0 알림 문구(티커·코멘트 등). text = 제어 문자 처리한 글, source = 보일 출처 이름 */
  | { kind: "notice"; key: string; seq: number; text: string; source: string }
  /** 1.10.0 기록 사이에 바뀐 화면 그림(다른 플러그인이 잠깐 띄운 컷인 등) — 새로 보일 그림이 있을 때만 */
  | { kind: "screen"; key: string; seq: number; screen: ScreenShot };

export type BattleResult = "win" | "lose" | "escape" | "abort";
const BATTLE_RESULTS = new Set<string>(["win", "lose", "escape", "abort"]);

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
    case "battle": return r.phase === "start" ? battleItem(r, null, [], 0, 0, data) : null;
    case "battlelog": {
      const item: Extract<ReaderItem, { kind: "battlelog" }> = { kind: "battlelog", key: `r${r.seq}`, seq: r.seq, text: battleLogText(r.text, data) };
      const action = battleActionOf(r, data);
      if (action) item.action = action;
      return item;
    }
    case "notice": {
      const text = formatText(safe(r.text) || safe(r.raw), data).trim();
      return text ? { kind: "notice", key: `r${r.seq}`, seq: r.seq, text, source: noticeSourceLabel(r.source) } : null;
    }
    default: return null;
  }
}

/** 적 무리 이름: 기록의 이름 → 데이터의 이름 → `#번호` */
export function troopName(r: RecordOf<"battle">, data: GameData): string {
  const named = safe(r.troopName);
  if (named) return named;
  const id = typeof r.troopId === "number" ? r.troopId : 0;
  return data?.troops?.[id]?.name || `#${id}`;
}

function rewardsText(end: RecordOf<"battle"> | null, data: GameData): string | null {
  const rw = end?.rewards;
  if (!rw || typeof rw !== "object") return null;
  const parts: string[] = [];
  if (typeof rw.exp === "number" && rw.exp > 0) parts.push(`경험치 ${rw.exp}`);
  if (typeof rw.gold === "number" && rw.gold > 0) parts.push(`골드 ${rw.gold}`);
  const items = Array.isArray(rw.items) ? rw.items.filter(s => typeof s === "string" && s).map(s => formatText(s, data)) : [];
  if (items.length > 0) parts.push(`얻은 것: ${items.join(", ")}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function battleItem(
  start: RecordOf<"battle">, end: RecordOf<"battle"> | null, items: ReaderItem[], logLines: number, repeat: number, data: GameData,
): Extract<ReaderItem, { kind: "battle" }> {
  let seq = start.seq;
  if (end && end.seq > seq) seq = end.seq;
  for (const it of items) {
    const s = lastSeqOf(it);
    if (s !== null && s > seq) seq = s;
  }
  const result = end && typeof end.result === "string" && BATTLE_RESULTS.has(end.result) ? end.result as BattleResult : null;
  return {
    kind: "battle", key: `r${start.seq}`, seq, troop: troopName(start, data), result, ended: end !== null,
    items, logLines, dropped: typeof end?.dropped === "number" && end.dropped > 0 ? end.dropped : 0,
    rewards: rewardsText(end, data), repeat,
  };
}

/**
 * foldTimeline 결과를 읽기 항목으로 바꾼다(대사·그림·고른 선택·플러그인 명령·장면 구분만). 예외를 던지지 않는다.
 * model은 갈래 시작 문구(`— {n}회차 갈래 {m} 시작 —`)에 쓴다. overrides: 플러그인 명령별 보이기 설정(pluginText).
 * 플러그인 줄은 모두 넣고 tech로 표시만 한다(숨기기는 화면이 정한다).
 * opts.battles = false면 전투 묶음을, opts.notices = false면 알림 문구(1.9.0, 전투 안의 것도)를 뺀다.
 * scenes(화면 그림 따라 그리기, scenesBySeq): 주면 보이는 이벤트 그림·스탠딩이 앞에 보인 것과 달라진 대사에 screen을 붙인다(nextShot).
 */
export function readerItems(
  items: HistoryItem[], data: GameData, choiceText: Map<number, string>, model: HistoryModel, overrides: PluginOverrides | null = null,
  scenes: Map<number, ScreenScene> | null = null, opts: { battles?: boolean; notices?: boolean } = {},
): ReaderItem[] {
  /** 바로 앞에 이어진 플러그인 기록들(글자 그림 설명용) */
  let plugins: RecordOf<"plugin">[] = [];
  /** 마지막으로 보인 그림의 열쇠(nextShot). "" = 아무것도 없음, null = 모름 */
  let shown: string | null = null;
  /** seq의 화면에서 새로 보일 그림. always가 아니면(전투 로그·전투 시작·끝) 그 seq에 화면이 있을 때만 본다. */
  const shotAt = (seq: number, always: boolean): ScreenShot | null => {
    if (!scenes || (!always && !scenes.has(seq))) return null;
    const { shot, key } = nextShot(shown, scenes.get(seq));
    shown = key;
    return shot;
  };
  const battles = opts?.battles !== false;
  const notices = opts?.notices !== false;
  const convert = (list: HistoryItem[], out: ReaderItem[]) => {
    for (const it of Array.isArray(list) ? list : []) {
      try {
        if (!it) continue;
        if (it.kind === "record") {
          const rec = it.record;
          // 1.10.0 화면 기록: 그림만 보인다(글자 그림 설명용 플러그인 기록 이어짐도 끊지 않는다)
          if (rec?.type === "screen") {
            const shot = shotAt(rec.seq, false);
            if (shot) out.push({ kind: "screen", key: `r${rec.seq}`, seq: rec.seq, screen: shot });
            continue;
          }
          // 알림 문구는 다른 플러그인이 띄운 것이라 이어진 플러그인 기록(글자 그림 설명)을 끊지 않는다
          if (rec?.type === "notice" && !notices) continue;
          const r = rec?.type === "picture" ? pictureItem(rec, plugins) : fromRecord(rec, data, choiceText, model, overrides);
          if (rec?.type !== "notice") plugins = rec?.type === "plugin" ? [...plugins, rec].slice(-20) : [];
          // 화면 그림을 기록하는 중이면 그림 표시(231)는 다음 대사의 화면이 실제 모습으로 보여 주므로 따로 넣지 않는다(글자 띄우기는 남긴다)
          if (r?.kind === "picture" && r.name && shown !== null) continue;
          if (!r) continue;
          if (r.kind === "battle" && !battles) continue;
          if (r.kind === "message" || r.kind === "battlelog") {
            const shot = shotAt(r.seq, r.kind === "message");
            if (shot) r.screen = shot;
          }
          out.push(r);
        } else if (it.kind === "repeat") {
          plugins = [];
          // 접힌 반복 대화는 화면 그림을 붙이지 않는다(접혀 있어 안 보이므로 다음 대사가 보인다)
          out.push(messageItem(it.record, data, it.count));
        } else if (it.kind === "battle") {
          plugins = [];
          // `전투 기록 보기`를 끄면 전투는 통째로 빠진다(그 안의 그림도 앞뒤 대사의 그림 비교에 넣지 않는다)
          if (!battles || !it.start) continue;
          const screen = it.repeat > 0 ? null : shotAt(it.start.seq, false);
          const inner: ReaderItem[] = [];
          // 다시 본 같은 전투는 접혀 있어 그림을 붙이지 않는다
          if (it.repeat > 0) {
            const saved = shown;
            convert(it.items, inner);
            shown = saved;
            for (const x of inner) if ((x.kind === "message" || x.kind === "battlelog") && x.screen) delete x.screen;
          } else {
            convert(it.items, inner);
          }
          const endScreen = it.repeat > 0 || !it.end ? null : shotAt(it.end.seq, false);
          // 알림 문구를 숨겼으면 줄 수에서도 뺀다
          const hidden = notices ? 0 : it.items.filter(x => x?.kind === "record" && x.record?.type === "notice").length;
          const logLines = Math.max(0, (typeof it.logLines === "number" ? it.logLines : 0) - hidden);
          const b = battleItem(it.start, it.end ?? null, inner, logLines, typeof it.repeat === "number" ? it.repeat : 0, data);
          if (screen) b.screen = screen;
          if (endScreen) b.endScreen = endScreen;
          out.push(b);
          plugins = [];
        }
      } catch { /* 깨진 항목은 건너뛴다 */ }
    }
  };
  const out: ReaderItem[] = [];
  convert(items, out);
  return out;
}

/** 항목이 속한 마지막 기록 seq. chapter는 null. */
export function lastSeqOf(item: ReaderItem): number | null {
  return item.kind === "chapter" ? null : item.seq;
}
