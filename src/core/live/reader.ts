import { formatText } from "../text/escape";
import { battleActionOf, battleLogText, type BattleAction } from "./battleLine";
import { dTextCaption } from "../text/textPicture";
import { locationKey } from "../index/locations";
import {
  coarseShotKey, DEFAULT_SCREEN, nextShot, visibleScene, type PictureContext, type ScreenScene, type ScreenShot,
} from "../addons/screenPictures";
import { applyPictureOp, composedScene, pictureOp, stackPictures, type PictureVars, type StackPicture } from "./pictureStack";
import { noticeSourceLabel } from "../addons/notices";
import type { GameData, Location } from "../types";
import { branchLabel, isContinuation } from "./history";
import { classifyPluginRecord, pluginKey, type PluginOverrides } from "./pluginText";
import type { HistoryItem, HistoryModel, LogRecord, RecordOf } from "./types";

export type ReaderItem =
  | { kind: "chapter"; key: string; text: string }
  /** screen: 화면 그림 따라 그리기 — 이 대사에서 새로 보일 이벤트 그림·스탠딩(nextShot)이 있을 때만 */
  | { kind: "message"; key: string; seq: number; speaker: string; face: string; faceIndex: number; lines: string[]; src: Location | null; cmd: number | null; repeat?: number; screen?: ScreenShot;
    /** 접힌 반복 대화(repeat)의 회차별 항목(대사·그림·알림·플러그인 글). 펼치면 `1회째`·`2회째`…로 보인다. */
    occurrences?: ReaderItem[][] }
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
  /**
   * 1.10.0 기록 사이에 바뀐 화면 그림(다른 플러그인이 잠깐 띄운 컷인 등) — 새로 보일 그림이 있을 때만.
   * 화면 그림 따라 그리기가 꺼졌으면 대사 없이 바뀐 그림 명령 묶음(다시 쌓은 그림, key = 묶음 첫 기록)도.
   */
  | { kind: "screen"; key: string; seq: number; screen: ScreenShot };

/**
 * 그림 명령 기록으로 다시 쌓은 화면(pictureStack)을 그릴 때 쓰는 것. ctx = 그림 구분(없으면 게임 화면 크기만),
 * vars = 변수로 정한 위치에 쓸 지금 게임 변수(같은 갈래만).
 */
export interface ComposeOptions { ctx?: PictureContext | null; vars?: PictureVars | null }

/** 그림 명령 기록 사이가 이보다 길면(ms) 앞의 묶음을 따로 보인다(잠깐 띄웠다 지운 그림) */
export const PICTURE_RUN_GAP_MS = 800;

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

function messageItem(r: RecordOf<"message">, data: GameData, repeat?: number): Extract<ReaderItem, { kind: "message" }> {
  const item: Extract<ReaderItem, { kind: "message" }> = {
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
    case "picture": return null; // readerItems가 따로 다룬다(pictureRecord)
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
 * 그림 표시 기록(231)은 따로 항목을 만들지 않는다(글자 그림만 남는다): 그림 명령 기록으로 화면 그림을 다시 쌓아(pictureStack)
 * 그림이 없는 대사(화면 그림 따라 그리기가 꺼졌거나 그 전 기록)에 같은 방식으로 screen을 붙인다. 대사 없이 바뀐 묶음
 * (선택·장면 구분·전투 앞, 또는 PICTURE_RUN_GAP_MS 넘게 쉰 뒤)은 화면 항목으로 보인다(scenes가 없을 때만). opts.compose: ComposeOptions.
 */
export function readerItems(
  items: HistoryItem[], data: GameData, choiceText: Map<number, string>, model: HistoryModel, overrides: PluginOverrides | null = null,
  scenes: Map<number, ScreenScene> | null = null, opts: { battles?: boolean; notices?: boolean; compose?: ComposeOptions } = {},
): ReaderItem[] {
  const pctx: PictureContext = opts?.compose?.ctx ?? { screen: data?.screenSize ?? DEFAULT_SCREEN };
  const vars = opts?.compose?.vars ?? null;
  /** 그림 명령으로 다시 쌓은 화면 그림(번호 → 그림) */
  let stack: ReadonlyMap<number, StackPicture> = new Map();
  /** shown이 이 묶음으로 정해졌으면 그 묶음(같으면 다시 계산하지 않는다) */
  let composedFor: ReadonlyMap<number, StackPicture> | null = null;
  /** 아직 보이지 않은 그림 명령 묶음: 첫·끝 기록 seq와 끝 기록 시각 */
  let pending: { first: number; last: number; t: number } | null = null;
  /** 바로 앞에 이어진 플러그인 기록들(글자 그림 설명용) */
  let plugins: RecordOf<"plugin">[] = [];
  /** 마지막으로 보인 그림의 열쇠(nextShot). "" = 아무것도 없음, null = 모름 */
  let shown: string | null = null;
  /** 마지막으로 보인(또는 화면에 있던) 그림의 대략적인 열쇠(coarseShotKey). null = 모름 */
  let shownCoarse: string | null = null;
  /** 마지막으로 넣은 화면 항목(그 뒤로 다른 기록의 그림을 보면 null) */
  let lastScreen: Extract<ReaderItem, { kind: "screen" }> | null = null;
  /** seq의 화면에서 새로 보일 그림. always가 아니면(전투 로그·전투 시작·끝) 그 seq에 화면이 있을 때만 본다. */
  const shotAt = (seq: number, always: boolean): ScreenShot | null => {
    if (!scenes || (!always && !scenes.has(seq))) return null;
    const scene = scenes.get(seq);
    const { shot, key } = nextShot(shown, scene);
    shown = key;
    shownCoarse = scene ? coarseShotKey(nextShot(null, scene).shot) : null;
    lastScreen = null;
    composedFor = null;
    if (scene) pending = null; // 실제 화면 그림이 다시 쌓은 것보다 앞선다
    return shot;
  };
  /** 다시 쌓은 화면 그림에서 새로 보일 그림(shotAt과 같은 비교) */
  const composedShot = (): ScreenShot | null => {
    pending = null;
    if (composedFor === stack) return null;
    composedFor = stack;
    const scene = composedScene(stackPictures(stack), pctx);
    const { shot, key } = nextShot(shown, scene);
    shown = key;
    shownCoarse = coarseShotKey(nextShot(null, scene).shot);
    lastScreen = null;
    return shot;
  };
  /** 대사의 그림: 실제 화면 그림(scenes)이 있으면 그것, 없으면 다시 쌓은 것 */
  const messageShot = (seq: number): ScreenShot | null => (scenes?.has(seq) ? shotAt(seq, true) : composedShot());
  /** 대사 없이 바뀐 그림 명령 묶음을 화면 항목으로(화면 그림 따라 그리기 기록이 없을 때만) */
  const flushPending = (out: ReaderItem[]) => {
    const p = pending;
    if (!p) return;
    if (scenes) { pending = null; return; }
    const shot = composedShot();
    if (shot) out.push({ kind: "screen", key: `r${p.first}`, seq: p.last, screen: shot });
  };
  /** 그림 명령 기록 하나를 쌓는다. 글자 그림(이름 없는 표시)은 항목으로 돌려준다. */
  const pictureRecord = (rec: RecordOf<"picture">, out: ReaderItem[]): ReaderItem | null => {
    const op = pictureOp(rec, data, pctx.screen, vars);
    const t = typeof rec.t === "number" ? rec.t : 0;
    if (op && pending && t - pending.t > PICTURE_RUN_GAP_MS) flushPending(out);
    const next = applyPictureOp(stack, op);
    if (next !== stack) {
      stack = next;
      pending = pending ? { first: pending.first, last: rec.seq, t } : { first: rec.seq, last: rec.seq, t };
    }
    const text = op ? op.op === "show" && !op.pic : rec.op === undefined && !rec.name;
    return text ? pictureItem(rec, plugins) : null;
  };
  /**
   * 1.10.1 화면 기록(대사 사이에 바뀐 그림): 보이는 그림(10% 넘게 보이는 것)의 이름·대략적인 위치가 지금 보이는 것과
   * 다를 때만 보인다. 1.10.0이 사라지거나 나타나는 중인 그림을 여러 번 기록한 것은 한 번만 보인다.
   */
  const screenShotAt = (seq: number): ScreenShot | null => {
    if (!scenes || !scenes.has(seq)) return null;
    const { shot, key } = nextShot(null, visibleScene(scenes.get(seq)));
    const coarse = coarseShotKey(shot);
    if (coarse === shownCoarse) {
      // 같은 그림이 더 진하게(나타나는 중이던 것): 방금 넣은 화면 항목을 더 진한 모습으로 바꾼다
      if (shot && lastScreen && opacitySum(shot) > opacitySum(lastScreen.screen)) { lastScreen.screen = shot; shown = key; }
      return null;
    }
    shownCoarse = coarse;
    shown = key;
    lastScreen = null;
    composedFor = null;
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
            const shot = screenShotAt(rec.seq);
            if (shot) {
              lastScreen = { kind: "screen", key: `r${rec.seq}`, seq: rec.seq, screen: shot };
              out.push(lastScreen);
            }
            continue;
          }
          // 알림 문구는 다른 플러그인이 띄운 것이라 이어진 플러그인 기록(글자 그림 설명)을 끊지 않는다
          if (rec?.type === "notice" && !notices) continue;
          // 그림 명령(231·232·235)은 화면 그림을 다시 쌓기만 한다(따로 보이지 않는다). 글자 그림만 항목이 된다.
          const r = rec?.type === "picture" ? pictureRecord(rec, out) : fromRecord(rec, data, choiceText, model, overrides);
          if (rec?.type !== "notice") plugins = rec?.type === "plugin" ? [...plugins, rec].slice(-20) : [];
          // 갈래 시작(이어진 갈래 제외)은 앞의 그림을 모른다
          if (rec?.type === "branchStart" && r) { flushPending(out); stack = new Map(); composedFor = null; }
          if (!r) continue;
          if (r.kind === "battle" && !battles) continue;
          // 대사 없이 바뀐 그림 묶음은 선택·장면 구분·스크롤 글·전투 앞에 따로 보인다
          if (r.kind === "choice" || r.kind === "chapter" || r.kind === "scroll" || r.kind === "battle") flushPending(out);
          if (r.kind === "message") {
            const shot = messageShot(r.seq);
            if (shot) r.screen = shot;
          } else if (r.kind === "battlelog") {
            const shot = shotAt(r.seq, false);
            if (shot) r.screen = shot;
          }
          out.push(r);
        } else if (it.kind === "repeat") {
          plugins = [];
          flushPending(out);
          const item = messageItem(it.record, data, it.count);
          // 회차마다 그 대화 전부(대사·그림·알림·플러그인 글). 그림 명령은 화면 그림 쌓기에도 그대로 들어간다.
          const occurrences: ReaderItem[][] = [];
          const saved = shown, savedCoarse = shownCoarse;
          let last: ScreenShot | null = null;
          for (const recs of Array.isArray(it.occurrences) ? it.occurrences : []) {
            const inner: ReaderItem[] = [];
            convert((Array.isArray(recs) ? recs : []).map(record => ({ kind: "record" as const, record, uncertain: false, changed: false })), inner);
            flushPending(inner);
            plugins = [];
            for (const x of inner) {
              if (x.kind === "screen") last = x.screen;
              else if ((x.kind === "message" || x.kind === "battlelog") && x.screen) last = x.screen;
            }
            if (inner.length > 0) occurrences.push(inner);
          }
          if (occurrences.length > 0) item.occurrences = occurrences;
          lastScreen = null;
          composedFor = null;
          // 접힌 대화가 새 그림을 남겼으면(앞에 보이던 것과 다르면) 접힌 부분 밖에 그 마지막 그림을 보인다.
          // 아니면 앞의 그림 상태로 되돌린다(접혀 있어 안 보이므로 다음 대사가 그림을 보인다).
          // (보였으면 shown·shownCoarse는 접힌 대화가 끝난 뒤의 그림 그대로 둔다)
          if (last && coarseShotKey(last) !== (savedCoarse ?? "")) {
            item.screen = last;
          } else {
            shown = saved;
            shownCoarse = savedCoarse;
          }
          out.push(item);
        } else if (it.kind === "battle") {
          plugins = [];
          // `전투 기록 보기`를 끄면 전투는 통째로 빠진다(그 안의 그림도 앞뒤 대사의 그림 비교에 넣지 않는다)
          if (!battles || !it.start) continue;
          flushPending(out);
          const screen = it.repeat > 0 ? null : shotAt(it.start.seq, false);
          const inner: ReaderItem[] = [];
          // 다시 본 같은 전투는 접혀 있어 그림을 붙이지 않는다
          if (it.repeat > 0) {
            const saved = shown, savedCoarse = shownCoarse;
            convert(it.items, inner);
            shown = saved;
            shownCoarse = savedCoarse;
            composedFor = null;
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

/** 보일 그림들의 투명도 합(같은 그림 중 더 진한 모습 고르기) */
function opacitySum(shot: ScreenShot): number {
  let n = 0;
  for (const p of shot.pictures) n += p.opacity;
  return n;
}

/** 항목이 속한 마지막 기록 seq. chapter는 null. */
export function lastSeqOf(item: ReaderItem): number | null {
  return item.kind === "chapter" ? null : item.seq;
}
