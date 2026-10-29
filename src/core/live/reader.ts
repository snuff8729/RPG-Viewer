import { formatText } from "../text/escape";
import { battleActionOf, battleLogText, type BattleAction } from "./battleLine";
import { dTextCaption } from "../text/textPicture";
import { locationKey } from "../index/locations";
import {
  coarseShotKey, ctxAt, DEFAULT_SCREEN, knownScreenAt, nextShot, screenAt, visibleScene, withScreen,
  type PictureContext, type ScreenScene, type ScreenShot,
} from "../addons/screenPictures";
import { applyPictureOp, composedScene, pictureOp, stackPictures, type PictureVars, type StackPicture } from "./pictureStack";
import { cutinRuns, withOldErases, type CutinStep } from "./cutins";
import { isNoticeHidden, noticeRecordKind, noticeSourceLabel, type NoticeKind } from "../addons/notices";
import type { GameData, Location } from "../types";
import { branchLabel, foldTimelineFrom, isContinuation, type FoldCache, type FoldOptions } from "./history";
import { classifyPluginRecord, pluginKey, type PluginOverrides } from "./pluginText";
import type { HistoryItem, HistoryModel, LogRecord, RecordOf } from "./types";

export type ReaderItem =
  /** 장면 구분(장소 이동·갈래 시작). part = 목차의 큰 단위(플레이 묶음·변수 값) 제목 줄(읽기 화면이 넣는다, key p{seq}) */
  | { kind: "chapter"; key: string; text: string; part?: true }
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
  | { kind: "notice"; key: string; seq: number; text: string; source: string; noticeKind: NoticeKind }
  /**
   * 1.10.0 기록 사이에 바뀐 화면 그림(다른 플러그인이 잠깐 띄운 컷인 등) — 새로 보일 그림이 있을 때만.
   * 화면 그림 따라 그리기가 꺼졌으면 대사 없이 바뀐 그림 명령 묶음(다시 쌓은 그림, key = 묶음 첫 기록)도.
   */
  | { kind: "screen"; key: string; seq: number; screen: ScreenShot }
  /**
   * 컷인: 대사(전투 안에서는 전투 로그 줄) 사이에 잠깐 띄웠다 지운 그림(core/live/cutins). frames = 그림 명령마다의 장면
   * (모두 같은 kind — 이벤트 그림이 있으면 화면 그대로), best = 가장 완전한(겹이 가장 많은·가장 넓은) 장면 번호.
   */
  | { kind: "cutin"; key: string; seq: number; frames: ScreenShot[]; best: number };

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
      return text ? { kind: "notice", key: `r${r.seq}`, seq: r.seq, text, source: noticeSourceLabel(r.source), noticeKind: noticeRecordKind(r) } : null;
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
  // 전투 건너뛰기(플러그인 1.24.0)로 이긴 전투는 앞에 그렇게 적는다
  const skipped = end?.skipped === true ? "전투 건너뜀" : null;
  if (!rw || typeof rw !== "object") return skipped;
  const parts: string[] = skipped ? [skipped] : [];
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

/** readerItems 설정 */
export interface ReaderItemsOptions { battles?: boolean; notices?: boolean; hiddenNoticeKinds?: ReadonlySet<NoticeKind>; compose?: ComposeOptions }

/** 화면 항목 하나와 그것을 넣은 목록 */
type PlacedScreen = { out: ReaderItem[]; item: ReaderItem; bridge: boolean };

/**
 * 읽기 항목을 만드는 중인 상태. 이어 만들기(readerItemsFrom)는 이것을 보관했다가 새 접힌 항목만 더 바꾼다.
 * 이미 넣은 항목 중 뒤에서 바뀌는 것은 lastScreen(더 진한 모습으로 바뀜)과 지금 구간(seg)의 화면 항목(컷인으로 빠짐)뿐이다.
 */
interface ReaderState {
  /** 맨 위 목록 */
  top: ReaderItem[];
  /** 그림 명령으로 다시 쌓은 화면 그림(번호 → 그림) */
  stack: ReadonlyMap<number, StackPicture>;
  /** shown이 이 묶음으로 정해졌으면 그 묶음(같으면 다시 계산하지 않는다) */
  composedFor: ReadonlyMap<number, StackPicture> | null;
  /** 아직 보이지 않은 그림 명령 묶음: 첫·끝 기록 seq와 끝 기록 시각 */
  pending: { first: number; last: number; t: number } | null;
  /** 바로 앞에 이어진 플러그인 기록들(글자 그림 설명용) */
  plugins: RecordOf<"plugin">[];
  /** 마지막으로 보인 그림의 열쇠(nextShot). "" = 아무것도 없음, null = 모름 */
  shown: string | null;
  /** 마지막으로 보인(또는 화면에 있던) 그림의 대략적인 열쇠(coarseShotKey). null = 모름 */
  shownCoarse: string | null;
  /**
   * 지금 구간(대사·전투 로그 줄·선택·장면 구분 사이)의 그림 명령들(컷인 찾기). start = 구간 시작 때의 그림 묶음,
   * screens = 구간 안에 넣은 화면 항목(bridge = 화면 기록, 아니면 다시 쌓은 것)과 넣은 목록.
   */
  seg: { start: ReadonlyMap<number, StackPicture>; steps: CutinStep[]; screens: PlacedScreen[] } | null;
  /** 마지막으로 넣은 화면 항목(그 뒤로 다른 기록의 그림을 보면 null) */
  lastScreen: Extract<ReaderItem, { kind: "screen" }> | null;
}

const newReaderState = (): ReaderState => ({
  top: [], stack: new Map(), composedFor: null, pending: null, plugins: [], shown: null, shownCoarse: null, seg: null, lastScreen: null,
});

/**
 * 뒤에서 제자리로 바뀔 수 있는 lastScreen을 사본으로 바꾼다(맨 위 목록, 또는 그것이 든 전투 항목의 목록에서도).
 * 이미 내준 항목 객체가 바뀌지 않게 한다. top이 s.top과 다르면(사본 목록) 그 목록에서 바꾼다. 찾지 못하면 false.
 */
function detachLastScreen(s: ReaderState, top: ReaderItem[]): boolean {
  const ls = s.lastScreen;
  if (!ls) return true;
  const copy = { ...ls };
  let found = false;
  for (let i = top.length - 1; i >= 0 && !found; i--) {
    const it = top[i];
    if (it === ls) { top[i] = copy; found = true; }
    else if (it.kind === "battle") {
      const j = it.items.indexOf(ls);
      if (j >= 0) { const items = it.items.slice(); items[j] = copy; top[i] = { ...it, items }; found = true; }
    }
  }
  if (!found) return false;
  if (s.seg) s.seg = { ...s.seg, screens: s.seg.screens.map(x => (x.item === ls ? { ...x, item: copy } : x)) };
  s.lastScreen = copy;
  return true;
}

/** 같은 상태의 사본(맨 위 목록·구간을 따로 가진다). 원본·원본이 내준 항목은 바뀌지 않는다. 만들 수 없으면 null. */
function cloneReaderState(s: ReaderState): ReaderState | null {
  const top = s.top.slice();
  const seg = s.seg && {
    start: s.seg.start, steps: s.seg.steps.slice(),
    screens: s.seg.screens.map(x => (x.out === s.top ? { ...x, out: top } : x)),
  };
  const c: ReaderState = { ...s, top, seg };
  return detachLastScreen(c, top) ? c : null;
}

interface ReaderConfig {
  data: GameData; choiceText: Map<number, string>; model: HistoryModel; overrides: PluginOverrides | null;
  scenes: Map<number, ScreenScene> | null; opts: ReaderItemsOptions;
}

/** 상태 st를 바꾸며 접힌 항목을 읽기 항목으로 바꾸는 함수들 */
function readerConverter(cfg: ReaderConfig, st: ReaderState) {
  const { data, choiceText, model, overrides, scenes, opts } = cfg;
  const pctx: PictureContext = opts?.compose?.ctx ?? { screen: data?.screenSize ?? DEFAULT_SCREEN };
  const vars = opts?.compose?.vars ?? null;
  /** seq의 화면에서 새로 보일 그림. always가 아니면(전투 로그·전투 시작·끝) 그 seq에 화면이 있을 때만 본다. */
  const shotAt = (seq: number, always: boolean): ScreenShot | null => {
    if (!scenes || (!always && !scenes.has(seq))) return null;
    const scene = scenes.get(seq);
    const { shot, key } = nextShot(st.shown, scene);
    st.shown = key;
    st.shownCoarse = scene ? coarseShotKey(nextShot(null, scene).shot) : null;
    st.lastScreen = null;
    st.composedFor = null;
    if (scene) st.pending = null; // 실제 화면 그림이 다시 쌓은 것보다 앞선다
    return shot;
  };
  /** 다시 쌓은 화면 그림에서 새로 보일 그림(shotAt과 같은 비교) */
  const composedShot = (seq: number): ScreenShot | null => {
    st.pending = null;
    if (st.composedFor === st.stack) return null;
    st.composedFor = st.stack;
    // 1.18.2: 그때 게임의 실제 화면 크기로 나눈다
    const scene = withScreen(composedScene(stackPictures(st.stack), ctxAt(pctx, seq)), knownScreenAt(pctx, seq));
    const { shot, key } = nextShot(st.shown, scene);
    st.shown = key;
    st.shownCoarse = coarseShotKey(nextShot(null, scene).shot);
    st.lastScreen = null;
    return shot;
  };
  /** 대사의 그림: 실제 화면 그림(scenes)이 있으면 그것, 없으면 다시 쌓은 것 */
  const messageShot = (seq: number): ScreenShot | null => (scenes?.has(seq) ? shotAt(seq, true) : composedShot(seq));
  /** 대사 없이 바뀐 그림 명령 묶음을 화면 항목으로(화면 그림 따라 그리기 기록이 없을 때만) */
  const flushPending = (out: ReaderItem[]) => {
    const p = st.pending;
    if (!p) return;
    if (scenes) { st.pending = null; return; }
    const shot = composedShot(p.last);
    if (shot) {
      const item: ReaderItem = { kind: "screen", key: `r${p.first}`, seq: p.last, screen: shot };
      out.push(item);
      st.seg?.screens.push({ out, item, bridge: false });
    }
  };
  /** 그림 명령 기록 하나를 쌓는다. 글자 그림(이름 없는 표시)은 항목으로 돌려준다. */
  const pictureRecord = (rec: RecordOf<"picture">, out: ReaderItem[]): ReaderItem | null => {
    const op = pictureOp(rec, data, screenAt(pctx, rec.seq), vars);
    const t = typeof rec.t === "number" ? rec.t : 0;
    if (op && st.pending && t - st.pending.t > PICTURE_RUN_GAP_MS) flushPending(out);
    const next = applyPictureOp(st.stack, op);
    if (op) {
      if (!st.seg) st.seg = { start: st.stack, steps: [], screens: [] };
      st.seg.steps.push({ rec, stack: next });
    }
    if (next !== st.stack) {
      st.stack = next;
      st.pending = st.pending ? { first: st.pending.first, last: rec.seq, t } : { first: rec.seq, last: rec.seq, t };
    }
    const text = op ? op.op === "show" && !op.pic : rec.op === undefined && !rec.name;
    return text ? pictureItem(rec, st.plugins) : null;
  };
  /**
   * 1.10.1 화면 기록(대사 사이에 바뀐 그림): 보이는 그림(10% 넘게 보이는 것)의 이름·대략적인 위치가 지금 보이는 것과
   * 다를 때만 보인다. 1.10.0이 사라지거나 나타나는 중인 그림을 여러 번 기록한 것은 한 번만 보인다.
   */
  const screenShotAt = (seq: number): ScreenShot | null => {
    if (!scenes || !scenes.has(seq)) return null;
    const { shot, key } = nextShot(null, visibleScene(scenes.get(seq)));
    const coarse = coarseShotKey(shot);
    if (coarse === st.shownCoarse) {
      // 같은 그림이 더 진하게(나타나는 중이던 것): 방금 넣은 화면 항목을 더 진한 모습으로 바꾼다
      if (shot && st.lastScreen && opacitySum(shot) > opacitySum(st.lastScreen.screen)) { st.lastScreen.screen = shot; st.shown = key; }
      return null;
    }
    st.shownCoarse = coarse;
    st.shown = key;
    st.lastScreen = null;
    st.composedFor = null;
    return shot;
  };
  /**
   * 구간 끝(경계 기록 앞, 목록 끝이면 boundary null): 예전 기록에서 다음 대사 전에 지운 그림을 지우고(withOldErases),
   * 잠깐 띄웠다 지운 그림을 컷인 항목으로 넣는다. 같은 그림을 보인 화면 항목은 겹이 더 많은 쪽만 남긴다
   * (화면 기록이 컷인의 가장 완전한 장면보다 겹이 많으면 화면 기록을, 아니면 컷인을).
   */
  const finishSegment = (out: ReaderItem[], boundary: LogRecord | null, open = false) => {
    const s = st.seg;
    st.seg = null;
    if (!s || s.steps.length === 0) return;
    // 아직 이어지는 끝(기록의 마지막·진행 중인 전투)은 다음 대사를 모르니 예전 기록의 지우기를 짐작하지 않는다
    const { steps, end } = open ? { steps: s.steps, end: st.stack } : withOldErases(s.steps, st.stack, boundary, data);
    if (end !== st.stack) { st.stack = end; st.composedFor = null; }
    const lastT = s.steps[s.steps.length - 1].rec.t;
    const endT = boundary && typeof boundary.t === "number" && boundary.t > 0 ? boundary.t : (typeof lastT === "number" ? lastT : 0);
    for (const run of cutinRuns({ start: s.start, steps, end, endT }, pctx)) {
      const names = new Set(run.frames.flatMap(f => f.pictures.map(p => p.name)));
      const related = s.screens.filter(x => x.item.kind === "screen" && x.item.screen.pictures.some(p => names.has(p.name)));
      const layers = run.frames[run.best]?.pictures.length ?? 0;
      if (related.some(x => x.bridge && x.item.kind === "screen" && x.item.screen.pictures.length > layers)) continue;
      for (const x of related) {
        const i = x.out.indexOf(x.item);
        if (i >= 0) x.out.splice(i, 1);
      }
      if (related.length > 0) { st.shown = null; st.shownCoarse = null; st.lastScreen = null; st.composedFor = null; }
      out.push({ kind: "cutin", key: `k${run.first}`, seq: run.last, frames: run.frames, best: run.best });
    }
  };
  const battles = opts?.battles !== false;
  const notices = opts?.notices !== false;
  const noticeHide = notices ? (opts?.hiddenNoticeKinds instanceof Set ? opts.hiddenNoticeKinds : undefined) : true;
  const noticeHidden = (rec: LogRecord | null | undefined) => rec?.type === "notice" && isNoticeHidden(rec, noticeHide);
  /** 접힌 항목들을 out에 바꿔 넣는다(끝의 구간은 열어 둔다 — finishList가 닫는다). */
  const convertItems = (list: HistoryItem[], out: ReaderItem[]) => {
    for (const it of Array.isArray(list) ? list : []) {
      try {
        if (!it) continue;
        if (it.kind === "record") {
          const rec = it.record;
          // 1.10.0 화면 기록: 그림만 보인다(글자 그림 설명용 플러그인 기록 이어짐도 끊지 않는다)
          if (rec?.type === "screen") {
            const shot = screenShotAt(rec.seq);
            if (shot) {
              st.lastScreen = { kind: "screen", key: `r${rec.seq}`, seq: rec.seq, screen: shot };
              out.push(st.lastScreen);
              st.seg?.screens.push({ out, item: st.lastScreen, bridge: true });
            }
            continue;
          }
          // 알림 문구는 다른 플러그인이 띄운 것이라 이어진 플러그인 기록(글자 그림 설명)을 끊지 않는다
          if (noticeHidden(rec)) continue;
          // 대사·전투 로그 줄·선택·장면 구분·전투 앞에서 구간을 끝낸다(그 사이에 띄웠다 지운 그림은 컷인)
          if (rec && SEGMENT_BOUNDARY.has(rec.type)) finishSegment(out, rec);
          // 그림 명령(231·232·235)은 화면 그림을 다시 쌓기만 한다(따로 보이지 않는다). 글자 그림만 항목이 된다.
          const r = rec?.type === "picture" ? pictureRecord(rec, out) : fromRecord(rec, data, choiceText, model, overrides);
          if (rec?.type !== "notice") st.plugins = rec?.type === "plugin" ? [...st.plugins, rec].slice(-20) : [];
          // 갈래 시작(이어진 갈래 제외)은 앞의 그림을 모른다
          if (rec?.type === "branchStart" && r) { flushPending(out); st.stack = new Map(); st.composedFor = null; }
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
          st.plugins = [];
          finishSegment(out, it.record);
          flushPending(out);
          const item = messageItem(it.record, data, it.count);
          // 회차마다 그 대화 전부(대사·그림·알림·플러그인 글). 그림 명령은 화면 그림 쌓기에도 그대로 들어간다.
          const occurrences: ReaderItem[][] = [];
          const saved = st.shown, savedCoarse = st.shownCoarse;
          let last: ScreenShot | null = null;
          for (const recs of Array.isArray(it.occurrences) ? it.occurrences : []) {
            const inner: ReaderItem[] = [];
            convert((Array.isArray(recs) ? recs : []).map(record => ({ kind: "record" as const, record, uncertain: false, changed: false })), inner, null);
            flushPending(inner);
            st.plugins = [];
            for (const x of inner) {
              if (x.kind === "screen") last = x.screen;
              else if ((x.kind === "message" || x.kind === "battlelog") && x.screen) last = x.screen;
            }
            if (inner.length > 0) occurrences.push(inner);
          }
          if (occurrences.length > 0) item.occurrences = occurrences;
          st.lastScreen = null;
          st.composedFor = null;
          // 접힌 대화가 새 그림을 남겼으면(앞에 보이던 것과 다르면) 접힌 부분 밖에 그 마지막 그림을 보인다.
          // 아니면 앞의 그림 상태로 되돌린다(접혀 있어 안 보이므로 다음 대사가 그림을 보인다).
          // (보였으면 shown·shownCoarse는 접힌 대화가 끝난 뒤의 그림 그대로 둔다)
          if (last && coarseShotKey(last) !== (savedCoarse ?? "")) {
            item.screen = last;
          } else {
            st.shown = saved;
            st.shownCoarse = savedCoarse;
          }
          out.push(item);
        } else if (it.kind === "battle") {
          st.plugins = [];
          // `전투 기록 보기`를 끄면 전투는 통째로 빠진다(그 안의 그림도 앞뒤 대사의 그림 비교에 넣지 않는다)
          if (!battles || !it.start) continue;
          finishSegment(out, it.start);
          flushPending(out);
          const screen = it.repeat > 0 ? null : shotAt(it.start.seq, false);
          const inner: ReaderItem[] = [];
          // 다시 본 같은 전투는 접혀 있어 그림을 붙이지 않는다
          if (it.repeat > 0) {
            const saved = st.shown, savedCoarse = st.shownCoarse;
            convert(it.items, inner, it.end ?? undefined);
            st.shown = saved;
            st.shownCoarse = savedCoarse;
            st.composedFor = null;
            for (const x of inner) if ((x.kind === "message" || x.kind === "battlelog") && x.screen) delete x.screen;
          } else {
            convert(it.items, inner, it.end ?? undefined);
          }
          const endScreen = it.repeat > 0 || !it.end ? null : shotAt(it.end.seq, false);
          // 알림 문구를 숨겼으면 줄 수에서도 뺀다
          const hidden = it.items.filter(x => x?.kind === "record" && noticeHidden(x.record)).length;
          const logLines = Math.max(0, (typeof it.logLines === "number" ? it.logLines : 0) - hidden);
          const b = battleItem(it.start, it.end ?? null, inner, logLines, typeof it.repeat === "number" ? it.repeat : 0, data);
          if (screen) b.screen = screen;
          if (endScreen) b.endScreen = endScreen;
          out.push(b);
          st.plugins = [];
        }
      } catch { /* 깨진 항목은 건너뛴다 */ }
    }
  };
  /** 목록 끝: 마지막 구간을 닫는다. tail: 목록 다음 기록(전투 끝 등, 모르면 null). undefined = 아직 이어지는 끝(기록의 마지막·진행 중인 전투). */
  const finishList = (out: ReaderItem[], tail?: LogRecord | null) => {
    try { finishSegment(out, tail ?? null, tail === undefined); } catch { /* 컷인 없음 */ }
  };
  const convert = (list: HistoryItem[], out: ReaderItem[], tail?: LogRecord | null) => {
    convertItems(list, out);
    finishList(out, tail);
  };
  return { convertItems, finishList };
}

/**
 * foldTimeline 결과를 읽기 항목으로 바꾼다(대사·그림·고른 선택·플러그인 명령·장면 구분만). 예외를 던지지 않는다.
 * model은 갈래 시작 문구(`— {n}회차 갈래 {m} 시작 —`)에 쓴다. overrides: 플러그인 명령별 보이기 설정(pluginText).
 * 플러그인 줄은 모두 넣고 tech로 표시만 한다(숨기기는 화면이 정한다).
 * opts.battles = false면 전투 묶음을, opts.notices = false면 알림 문구(1.9.0, 전투 안의 것도)를 뺀다.
 * opts.hiddenNoticeKinds: 그 종류(업적·획득·퀘스트·알림)의 알림 문구만 뺀다.
 * scenes(화면 그림 따라 그리기, scenesBySeq): 주면 보이는 이벤트 그림·스탠딩이 앞에 보인 것과 달라진 대사에 screen을 붙인다(nextShot).
 * 그림 표시 기록(231)은 따로 항목을 만들지 않는다(글자 그림만 남는다): 그림 명령 기록으로 화면 그림을 다시 쌓아(pictureStack)
 * 그림이 없는 대사(화면 그림 따라 그리기가 꺼졌거나 그 전 기록)에 같은 방식으로 screen을 붙인다. 대사 없이 바뀐 묶음
 * (선택·장면 구분·전투 앞, 또는 PICTURE_RUN_GAP_MS 넘게 쉰 뒤)은 화면 항목으로 보인다(scenes가 없을 때만). opts.compose: ComposeOptions.
 */
export function readerItems(
  items: HistoryItem[], data: GameData, choiceText: Map<number, string>, model: HistoryModel, overrides: PluginOverrides | null = null,
  scenes: Map<number, ScreenScene> | null = null, opts: ReaderItemsOptions = {},
): ReaderItem[] {
  const st = newReaderState();
  const { convertItems, finishList } = readerConverter({ data, choiceText, model, overrides, scenes, opts }, st);
  convertItems(items, st.top);
  finishList(st.top);
  return st.top;
}

// ---------------------------------------------------------------- 이어 만들기

/** 이어 만들기 상태(readerItemsFrom이 돌려주고 다음 부를 때 다시 받는다). 밖에서 고치지 않는다. */
export interface ReaderCache {
  state: ReaderState | null;
  /** 바꾼(다시 볼 일 없는) 접힌 항목 수와 그 마지막 항목 */
  used: number;
  lastUsed: HistoryItem | null;
  /** 같아야 이어 쓰는 설정들(같은 객체) */
  deps: readonly unknown[];
}

/**
 * readerItems를 이어서 한다: fold가 앞의 cache를 이어 접은 결과(foldTimelineFrom, resumed)이고 설정이 같으면
 * 앞에서 바꾼 데서부터 새로 다 접힌 항목만 바꾼다. 아니면 처음부터. 결과는 언제나
 * readerItems(fold.items, data, choiceText, model, overrides, scenes, opts)와 같다.
 * choiceText·scenes는 매번 새로 만들어도 되지만, 이미 지나간 기록의 값은 같아야 한다(기록이 덧붙기만 했으면 그렇다).
 * scenes를 만든 그림 구분(ctx)이 바뀌면 opts.compose.ctx도 바뀌어야 한다(같은 ctx를 쓴다).
 */
export function readerItemsFrom(
  fold: { items: HistoryItem[]; stable: number; resumed: boolean },
  data: GameData, choiceText: Map<number, string>, model: HistoryModel, overrides: PluginOverrides | null,
  scenes: Map<number, ScreenScene> | null, opts: ReaderItemsOptions, prev: ReaderCache | null,
): { items: ReaderItem[]; cache: ReaderCache } {
  const deps = [data, overrides, scenes === null, opts?.battles, opts?.notices, opts?.hiddenNoticeKinds, opts?.compose?.ctx, opts?.compose?.vars] as const;
  const items = Array.isArray(fold.items) ? fold.items : [];
  const stable = Math.min(Math.max(0, fold.stable), items.length);
  const resumable = !!prev && !!prev.state && fold.resumed && prev.used <= stable
    && prev.deps.length === deps.length && prev.deps.every((d, i) => d === deps[i])
    && (prev.used === 0 || items[prev.used - 1] === prev.lastUsed);
  // 보관한 상태는 내준 적이 없다(내준 것은 언제나 사본 fin) — 그대로 이어 쓴다
  const st = resumable && prev?.state ? prev.state : newReaderState();
  const used = resumable && prev ? prev.used : 0;
  const cfg: ReaderConfig = { data, choiceText, model, overrides, scenes, opts };
  readerConverter(cfg, st).convertItems(items.slice(used, stable), st.top);
  const fin = cloneReaderState(st);
  const cache: ReaderCache = { state: fin ? st : null, used: stable, lastUsed: stable > 0 ? items[stable - 1] : null, deps };
  if (!fin) return { items: readerItems(items, data, choiceText, model, overrides, scenes, opts), cache };
  const { convertItems, finishList } = readerConverter(cfg, fin);
  convertItems(items.slice(stable), fin.top);
  finishList(fin.top);
  return { items: fin.top, cache };
}

/**
 * 경로 기록 → 읽기 항목(foldTimeline + readerItems)을 이어 만드는 것. 부를 때마다 앞의 결과에서 이어 간다
 * (foldTimelineFrom·readerItemsFrom). 결과는 readerItems(foldTimeline(path, model, foldOpts), …)와 같다.
 */
export class ReaderItemsBuilder {
  private fold: FoldCache | null = null;
  private reader: ReaderCache | null = null;

  build(
    path: LogRecord[], model: HistoryModel, foldOpts: FoldOptions, data: GameData, choiceText: Map<number, string>,
    overrides: PluginOverrides | null, scenes: Map<number, ScreenScene> | null, opts: ReaderItemsOptions,
  ): ReaderItem[] {
    const folded = foldTimelineFrom(path, model, foldOpts, this.fold);
    const built = readerItemsFrom(folded, data, choiceText, model, overrides, scenes, opts, this.reader);
    this.fold = folded.cache;
    this.reader = built.cache;
    return built.items;
  }
}

/** 컷인 구간을 끝내는 기록(대사·스크롤 글·선택지·고른 선택·전투 로그 줄·장소 이동·갈래 시작·전투) */
const SEGMENT_BOUNDARY = new Set<string>(["message", "scroll", "choices", "choice", "battlelog", "transfer", "branchStart", "battle"]);

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
