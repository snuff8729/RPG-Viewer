/**
 * 게임 폴더의 rpg-viewer/reader.json — 읽기 화면의 북마크·숨김 규칙·(선택) 챕터 변수.
 * PC·따로 띄운 창·휴대폰 보기가 같은 파일을 쓴다. favoritesFile과 같은 방식: 쓸 때마다 디스크 파일을 먼저 읽고
 * 이 뷰어에서 바꾼 것(ReaderOp)만 얹어 쓴다(mergeReaderFile). 읽기 실패(없음과 구분)면 쓰지 않는다.
 *
 * 파일: { v: 1, bookmarks: [{ id, branch, seq, name, t }], hide: [{ id, kind, text|pattern|type, t }], chapterVar?: number | null, t }
 * hide 칸이 없으면 예전 보기 설정(브라우저에 기억한 스위치)을 바꾼 규칙(legacyHideRules)을 쓰고, 파일을 처음 쓸 때 함께 적는다.
 * 모든 함수는 예외를 던지지 않는다.
 */

export const READER_FILE_VERSION = 1;
export const BOOKMARK_NAME_MAX = 40;
/** 북마크·숨김 규칙 최대 개수(파일이 끝없이 커지지 않게) */
export const BOOKMARKS_MAX = 500;
export const HIDE_RULES_MAX = 1000;

/** 북마크: branch = 대표 갈래, seq = 그 줄의 기록 seq */
export interface Bookmark { id: string; branch: number; seq: number; name: string; t: number }

/**
 * 숨김 규칙. exact = 공백을 정리한 글이 완전히 같은 줄, digits = 숫자 덩어리를 #으로 바꾼 글이 같은 줄,
 * type = 줄 종류(hideRules.lineTypesOf: plugin-tech·plugin:{이름}·notice·notice-kind:{종류}·notice-source:{출처}·battle·battlelog).
 */
export type HideRule =
  | { id: string; kind: "exact"; text: string; t: number }
  | { id: string; kind: "digits"; pattern: string; t: number }
  | { id: string; kind: "type"; type: string; t: number };

/** 파싱한 파일. hide가 null = 파일에 없음(예전 설정을 쓴다). */
export interface ReaderFile {
  bookmarks: Bookmark[];
  hide: HideRule[] | null;
  chapterVar: number | null;
  t: number;
}

/** 화면이 쓰는 값(칸을 채운 것) */
export interface ReaderState {
  bookmarks: Bookmark[];
  hide: HideRule[];
  chapterVar: number | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;
const isSeq = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export const cleanBookmarkName = (s: unknown): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, BOOKMARK_NAME_MAX) : "");

export function parseBookmark(v: unknown): Bookmark | null {
  if (!isObj(v) || !isId(v.id) || !isSeq(v.branch) || !isSeq(v.seq)) return null;
  return { id: v.id, branch: v.branch, seq: v.seq, name: cleanBookmarkName(v.name), t: num(v.t) };
}

export function parseHideRule(v: unknown): HideRule | null {
  if (!isObj(v) || !isId(v.id)) return null;
  const t = num(v.t);
  if (v.kind === "exact" && typeof v.text === "string" && v.text !== "") return { id: v.id, kind: "exact", text: v.text, t };
  if (v.kind === "digits" && typeof v.pattern === "string" && v.pattern !== "") return { id: v.id, kind: "digits", pattern: v.pattern, t };
  if (v.kind === "type" && typeof v.type === "string" && v.type !== "") return { id: v.id, kind: "type", type: v.type, t };
  return null;
}

/** 규칙이 가리키는 것(같으면 같은 규칙) */
export const hideRuleValue = (r: HideRule): string =>
  r.kind === "exact" ? `e:${r.text}` : r.kind === "digits" ? `d:${r.pattern}` : `t:${r.type}`;

function parseList<T>(v: unknown, parse: (x: unknown) => T | null, idOf: (x: T) => string, max: number): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    const p = parse(x);
    if (!p || seen.has(idOf(p))) continue;
    seen.add(idOf(p));
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

const parseRules = (v: unknown): HideRule[] => {
  const out: HideRule[] = [];
  const values = new Set<string>();
  for (const r of parseList(v, parseHideRule, (x) => x.id, HIDE_RULES_MAX)) {
    if (values.has(hideRuleValue(r))) continue;
    values.add(hideRuleValue(r));
    out.push(r);
  }
  return out;
};

/** reader.json 글 → 파일. 없거나 깨졌으면(JSON 아님·객체 아님·v가 다름) null. 잘못된 항목은 버린다. */
export function parseReaderFile(raw: string | null | undefined): ReaderFile | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!isObj(v) || v.v !== READER_FILE_VERSION) return null;
  return {
    bookmarks: parseList(v.bookmarks, parseBookmark, (x) => x.id, BOOKMARKS_MAX),
    hide: Array.isArray(v.hide) ? parseRules(v.hide) : null,
    chapterVar: isSeq(v.chapterVar) && v.chapterVar > 0 ? v.chapterVar : null,
    t: num(v.t),
  };
}

/** 화면 값 → 파일 글(t 포함) */
export function serializeReaderFile(s: ReaderState, t: number): string {
  return JSON.stringify({ v: READER_FILE_VERSION, bookmarks: s.bookmarks, hide: s.hide, chapterVar: s.chapterVar, t }, null, 1);
}

/** 파일 → 화면 값: hide 칸이 없으면 예전 설정을 바꾼 규칙(legacy) */
export function resolveReader(file: ReaderFile | null, legacyHide: readonly HideRule[] = []): ReaderState {
  return {
    bookmarks: file ? [...file.bookmarks] : [],
    hide: file?.hide ? [...file.hide] : [...legacyHide],
    chapterVar: file?.chapterVar ?? null,
  };
}

/**
 * 이 뷰어에서 한 바꿈 하나. 몇 번 다시 얹어도 결과가 같다 — 쓰기에 실패해 다음에 다시 얹어도 된다.
 * bookmark = 넣기(같은 id면 바꾸기), hide = 넣기(같은 것을 가리키는 규칙이 있으면 그대로), *Set = 목록 통째(바꿈 묶기).
 */
export type ReaderOp =
  | { op: "bookmark"; bookmark: Bookmark }
  | { op: "unbookmark"; id: string }
  | { op: "rename"; id: string; name: string }
  | { op: "hide"; rule: HideRule }
  | { op: "unhide"; id: string }
  | { op: "chapterVar"; id: number | null }
  | { op: "bookmarkSet"; bookmarks: Bookmark[] }
  | { op: "hideSet"; rules: HideRule[] };

/** 저장해 둔 바꿈 목록(localStorage) → 바꿈. 잘못된 항목은 버린다. */
export function parseReaderOps(raw: string | null | undefined): ReaderOp[] {
  if (typeof raw !== "string" || raw === "") return [];
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(v)) return [];
  const out: ReaderOp[] = [];
  for (const x of v) {
    if (!isObj(x)) continue;
    if (x.op === "bookmark") { const b = parseBookmark(x.bookmark); if (b) out.push({ op: "bookmark", bookmark: b }); }
    else if (x.op === "unbookmark" && isId(x.id)) out.push({ op: "unbookmark", id: x.id });
    else if (x.op === "rename" && isId(x.id) && typeof x.name === "string") out.push({ op: "rename", id: x.id, name: cleanBookmarkName(x.name) });
    else if (x.op === "hide") { const r = parseHideRule(x.rule); if (r) out.push({ op: "hide", rule: r }); }
    else if (x.op === "unhide" && isId(x.id)) out.push({ op: "unhide", id: x.id });
    else if (x.op === "chapterVar" && (x.id === null || (isSeq(x.id) && x.id > 0))) out.push({ op: "chapterVar", id: x.id as number | null });
    else if (x.op === "bookmarkSet") out.push({ op: "bookmarkSet", bookmarks: parseList(x.bookmarks, parseBookmark, (b) => b.id, BOOKMARKS_MAX) });
    else if (x.op === "hideSet") out.push({ op: "hideSet", rules: parseRules(x.rules) });
  }
  return out;
}

/** 바꿈 하나를 얹는다 */
export function applyReaderOp(s: ReaderState, o: ReaderOp): ReaderState {
  switch (o.op) {
    case "bookmark": {
      const i = s.bookmarks.findIndex((b) => b.id === o.bookmark.id);
      if (i >= 0) {
        const next = s.bookmarks.slice();
        next[i] = { ...o.bookmark };
        return { ...s, bookmarks: next };
      }
      if (s.bookmarks.length >= BOOKMARKS_MAX) return s;
      return { ...s, bookmarks: [...s.bookmarks, { ...o.bookmark }] };
    }
    case "unbookmark":
      return s.bookmarks.some((b) => b.id === o.id) ? { ...s, bookmarks: s.bookmarks.filter((b) => b.id !== o.id) } : s;
    case "rename": {
      const name = cleanBookmarkName(o.name);
      const i = s.bookmarks.findIndex((b) => b.id === o.id);
      if (i < 0 || !name || s.bookmarks[i].name === name) return s;
      const next = s.bookmarks.slice();
      next[i] = { ...next[i], name };
      return { ...s, bookmarks: next };
    }
    case "hide": {
      const value = hideRuleValue(o.rule);
      if (s.hide.length >= HIDE_RULES_MAX || s.hide.some((r) => r.id === o.rule.id || hideRuleValue(r) === value)) return s;
      return { ...s, hide: [...s.hide, { ...o.rule }] };
    }
    case "unhide":
      return s.hide.some((r) => r.id === o.id) ? { ...s, hide: s.hide.filter((r) => r.id !== o.id) } : s;
    case "chapterVar":
      return s.chapterVar === o.id ? s : { ...s, chapterVar: o.id };
    case "bookmarkSet":
      return { ...s, bookmarks: o.bookmarks.map((b) => ({ ...b })) };
    case "hideSet":
      return { ...s, hide: o.rules.map((r) => ({ ...r })) };
  }
}

export const applyReaderOps = (s: ReaderState, ops: readonly ReaderOp[]): ReaderState => ops.reduce(applyReaderOp, s);

/** 읽고-고쳐-쓰기의 "고쳐": 디스크 파일(다른 뷰어가 썼을 수 있다) 위에 이 뷰어의 바꿈만 얹은 새 값. 예전 설정 규칙도 함께 적는다. */
export function mergeReaderFile(disk: ReaderFile | null, ops: readonly ReaderOp[], legacyHide: readonly HideRule[] = []): ReaderState {
  return applyReaderOps(resolveReader(disk, legacyHide), ops);
}

const sameState = (a: ReaderState, b: ReaderState) => serializeReaderFile(a, 0) === serializeReaderFile(b, 0);

/** 파일에 써야 하는지: 바꿈이 있고, 얹은 결과가 디스크와 다르다(디스크에 hide 칸이 없으면 예전 설정 규칙을 적어야 하므로 다르다) */
export function readerNeedsWrite(disk: ReaderFile | null, ops: readonly ReaderOp[], legacyHide: readonly HideRule[] = []): boolean {
  if (ops.length === 0) return false;
  const merged = mergeReaderFile(disk, ops, legacyHide);
  if (!disk) return true;
  if (disk.hide === null) return true;
  return !sameState(resolveReader(disk), merged);
}

/** 다음 쓰기 시각: 지금, 그리고 디스크 파일보다 늦게 */
export const nextReaderT = (disk: ReaderFile | null, now: number): number => Math.max(now, (disk?.t ?? 0) + 1);

/** 못 쓴 바꿈이 이만큼 넘게 쌓이면 지금 값 통째로 묶는다 */
export const READER_OPS_COMPACT_AT = 100;

export function compactReaderOps(ops: readonly ReaderOp[], state: ReaderState): ReaderOp[] {
  if (ops.length <= READER_OPS_COMPACT_AT) return [...ops];
  const touches = (k: "bookmark" | "hide" | "var") => ops.some((o) =>
    k === "bookmark" ? (o.op === "bookmark" || o.op === "unbookmark" || o.op === "rename" || o.op === "bookmarkSet")
      : k === "hide" ? (o.op === "hide" || o.op === "unhide" || o.op === "hideSet") : o.op === "chapterVar");
  const out: ReaderOp[] = [];
  if (touches("bookmark")) out.push({ op: "bookmarkSet", bookmarks: state.bookmarks });
  if (touches("hide")) out.push({ op: "hideSet", rules: state.hide });
  if (touches("var")) out.push({ op: "chapterVar", id: state.chapterVar });
  return out;
}

/** 게임별 못 쓴 바꿈(localStorage) */
export const readerPendingKey = (gameKey: string) => `rpgv.readerPending.${gameKey}`;

/** 예전 읽기 보기 설정(브라우저에 기억한 스위치·플러그인 명령별 설정) */
export interface LegacyReaderDisplay {
  /** `플러그인 명령 모두 보기` */
  showAllPlugins: boolean;
  /** `전투 기록 보기` */
  battlesShown: boolean;
  /** `알림 문구 보기` */
  noticesShown: boolean;
  /** 숨긴 알림 종류 */
  hiddenNoticeKinds: readonly string[];
  /** 플러그인 명령별 `항상 숨기기`로 둔 명령 이름 */
  hiddenPlugins: readonly string[];
}

/**
 * 예전 설정 → 숨김 규칙(처음 한 번 옮긴다). 지금 숨겨지는 것은 계속 숨긴다:
 * 기술 플러그인 명령(모두 보기를 끈 기본값), 꺼 둔 전투·알림, 숨긴 알림 종류, 항상 숨기기로 둔 명령.
 */
export function legacyHideRules(l: Partial<LegacyReaderDisplay> | null | undefined): HideRule[] {
  const out: HideRule[] = [];
  const add = (type: string) => { if (!out.some((r) => r.kind === "type" && r.type === type)) out.push({ id: `legacy-${type}`, kind: "type", type, t: 0 }); };
  try {
    if (l?.showAllPlugins !== true) add("plugin-tech");
    for (const name of Array.isArray(l?.hiddenPlugins) ? l.hiddenPlugins : []) if (typeof name === "string" && name) add(`plugin:${name}`);
    if (l?.battlesShown === false) add("battle");
    if (l?.noticesShown === false) add("notice");
    else for (const k of Array.isArray(l?.hiddenNoticeKinds) ? l.hiddenNoticeKinds : []) if (typeof k === "string" && k) add(`notice-kind:${k}`);
  } catch { /* 있는 것만 */ }
  return out;
}
