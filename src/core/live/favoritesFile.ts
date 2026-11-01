import {
  emptyFavorites, FAVORITES_MAX, findFavorite, NICKNAME_MAX, parseList, renameFavorite, toggleFavorite,
  type FavoriteKind, type Favorites,
} from "./favorites";
import type { GameFolder } from "../fs/folder";

/**
 * 게임 폴더의 rpg-viewer/favorites.json — 보조 즐겨찾기(맨 위 줄에 올린 기능과 순서)와 치트 즐겨찾기(스위치·변수 id, 별명).
 * PC·따로 띄운 창·휴대폰 보기가 같은 파일을 쓴다. control.json처럼 쓸 때마다 디스크 파일을 먼저 읽고
 * 이 뷰어에서 바꾼 것(FavoritesOp)만 얹어 쓴다(mergeFavorites).
 *
 * 파일: { v: 1, assist?: { items: AssistFavoriteId[] }, cheat?: { switches: [{id, nick?}], variables: [{id, nick?}] }, t }
 * 칸이 없으면(absent) 기본값: 보조 = DEFAULT_ASSIST_FAVORITES, 치트 = 예전 localStorage 즐겨찾기(이전) 또는 빈 것.
 * 모든 함수는 예외를 던지지 않는다.
 */

/** 맨 위 줄에 올릴 수 있는 보조 기능. autoFast = 본 이벤트 자동 배속(켜기 + 빠르기 autoSpeed). */
export type AssistFavoriteId =
  | "speed" | "walkSpeed" | "skipSeen" | "autoFast"
  | "noRandomEncounter" | "skipBattles" | "skipKnownOnly"
  | "win" | "lose" | "escape" | "enemyHpFull" | "enemyHpLow"
  | "hpFull" | "hpLow"
  | "quickSave" | "quickLoad" | "saveMenu" | "loadMenu"
  | "backup" | "restore";

/** 모든 보조 즐겨찾기 후보(보조 탭에 보이는 순서) */
export const ASSIST_FAVORITE_IDS: readonly AssistFavoriteId[] = [
  "speed", "walkSpeed", "skipSeen", "autoFast",
  "noRandomEncounter", "skipBattles", "skipKnownOnly",
  "win", "lose", "escape", "enemyHpFull", "enemyHpLow",
  "hpFull", "hpLow",
  "quickSave", "quickLoad", "saveMenu", "loadMenu",
  "backup", "restore",
];

/** 처음(파일에 보조 칸이 없을 때) 맨 위 줄에 오는 기능 */
export const DEFAULT_ASSIST_FAVORITES: readonly AssistFavoriteId[] = [
  "speed", "skipSeen", "autoFast", "noRandomEncounter", "skipBattles",
];

const ASSIST_ID_SET: ReadonlySet<unknown> = new Set(ASSIST_FAVORITE_IDS);
const BATTLE_ONLY: ReadonlySet<AssistFavoriteId> = new Set<AssistFavoriteId>(["win", "lose", "escape", "enemyHpFull", "enemyHpLow"]);

export const isAssistFavoriteId = (v: unknown): v is AssistFavoriteId => ASSIST_ID_SET.has(v);

/** 즐겨찾기여도 전투 중에만 보이는 기능 */
export const battleOnly = (id: AssistFavoriteId): boolean => BATTLE_ONLY.has(id);

export const FAVORITES_FILE_VERSION = 1;

/** 파싱한 파일. null인 칸 = 파일에 없음(기본값을 쓴다). */
export interface FavoritesFile {
  assist: AssistFavoriteId[] | null;
  cheat: Favorites | null;
  t: number;
}

/** 칸을 기본값으로 채운, 화면이 쓰는 즐겨찾기 */
export interface FavoritesState {
  assist: AssistFavoriteId[];
  cheat: Favorites;
}

function parseAssistList(v: unknown): AssistFavoriteId[] {
  if (!Array.isArray(v)) return [];
  const out: AssistFavoriteId[] = [];
  for (const x of v) if (isAssistFavoriteId(x) && !out.includes(x)) out.push(x);
  return out;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** favorites.json 글 → 파일. 없거나 깨졌으면(JSON 아님·객체 아님·v가 다름) null. 칸 안의 잘못된 항목은 버린다. */
export function parseFavoritesFile(raw: string | null | undefined): FavoritesFile | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!isObj(v) || v.v !== FAVORITES_FILE_VERSION) return null;
  const assist = isObj(v.assist) ? parseAssistList(v.assist.items) : null;
  const cheat = isObj(v.cheat) ? { switch: parseList(v.cheat.switches, "nick"), variable: parseList(v.cheat.variables, "nick") } : null;
  const t = typeof v.t === "number" && Number.isFinite(v.t) ? v.t : 0;
  return { assist, cheat, t };
}

const cheatListJson = (list: Favorites[FavoriteKind]) => list.map((x) => (x.nickname ? { id: x.id, nick: x.nickname } : { id: x.id }));

/** 파일 → 글(t 포함). null인 칸은 쓰지 않는다. */
export function serializeFavoritesFile(f: Omit<FavoritesFile, "t">, t: number): string {
  const o: Record<string, unknown> = { v: FAVORITES_FILE_VERSION };
  if (f.assist) o.assist = { items: f.assist };
  if (f.cheat) o.cheat = { switches: cheatListJson(f.cheat.switch), variables: cheatListJson(f.cheat.variable) };
  o.t = t;
  return JSON.stringify(o, null, 1);
}

/** 내용이 같은지(t는 보지 않는다) */
export const sameFavoritesContent = (a: Omit<FavoritesFile, "t"> | null, b: Omit<FavoritesFile, "t"> | null): boolean =>
  (a === null || b === null) ? a === b : serializeFavoritesFile(a, 0) === serializeFavoritesFile(b, 0);

/**
 * 이 뷰어에서 한 바꿈 하나. 몇 번 다시 얹어도 결과가 같다(켜기·끄기를 값으로 적는다) — 쓰기에 실패해 다음에 다시 얹어도 된다.
 * assistOrder·cheatSet은 목록 통째(순서 바꾸기, 오래 못 쓴 바꿈 묶기).
 */
export type FavoritesOp =
  | { op: "assist"; id: AssistFavoriteId; on: boolean }
  | { op: "assistOrder"; items: AssistFavoriteId[] }
  | { op: "cheat"; kind: FavoriteKind; id: number; on: boolean }
  | { op: "nick"; kind: FavoriteKind; id: number; nick: string }
  | { op: "cheatSet"; favorites: Favorites };

const isKind = (v: unknown): v is FavoriteKind => v === "switch" || v === "variable";
const isId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;

/** 저장해 둔 바꿈 목록(localStorage) → 바꿈. 잘못된 항목은 버린다. */
export function parseFavoritesOps(raw: string | null | undefined): FavoritesOp[] {
  if (typeof raw !== "string" || raw === "") return [];
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(v)) return [];
  const out: FavoritesOp[] = [];
  for (const x of v) {
    if (!isObj(x)) continue;
    if (x.op === "assist" && isAssistFavoriteId(x.id) && typeof x.on === "boolean") out.push({ op: "assist", id: x.id, on: x.on });
    else if (x.op === "assistOrder") out.push({ op: "assistOrder", items: parseAssistList(x.items) });
    else if (x.op === "cheat" && isKind(x.kind) && isId(x.id) && typeof x.on === "boolean") out.push({ op: "cheat", kind: x.kind, id: x.id, on: x.on });
    else if (x.op === "nick" && isKind(x.kind) && isId(x.id) && typeof x.nick === "string") out.push({ op: "nick", kind: x.kind, id: x.id, nick: x.nick.slice(0, NICKNAME_MAX * 2) });
    else if (x.op === "cheatSet" && isObj(x.favorites)) out.push({ op: "cheatSet", favorites: { switch: parseList(x.favorites.switch), variable: parseList(x.favorites.variable) } });
  }
  return out;
}

const touchesAssist = (o: FavoritesOp) => o.op === "assist" || o.op === "assistOrder";

/** 바꿈 하나를 얹는다 */
export function applyFavoritesOp(s: FavoritesState, o: FavoritesOp): FavoritesState {
  switch (o.op) {
    case "assist": {
      const has = s.assist.includes(o.id);
      if (has === o.on) return s;
      return { ...s, assist: o.on ? [...s.assist, o.id] : s.assist.filter((x) => x !== o.id) };
    }
    case "assistOrder":
      return { ...s, assist: [...o.items] };
    case "cheat": {
      const has = findFavorite(s.cheat, o.kind, o.id) !== undefined;
      if (has === o.on || (o.on && s.cheat[o.kind].length >= FAVORITES_MAX)) return s;
      return { ...s, cheat: toggleFavorite(s.cheat, o.kind, o.id) };
    }
    case "nick":
      return { ...s, cheat: renameFavorite(s.cheat, o.kind, o.id, o.nick) };
    case "cheatSet":
      return { ...s, cheat: { switch: [...o.favorites.switch], variable: [...o.favorites.variable] } };
  }
}

export const applyFavoritesOps = (s: FavoritesState, ops: readonly FavoritesOp[]): FavoritesState => ops.reduce(applyFavoritesOp, s);

/**
 * 파일 → 화면 값: 보조 칸이 없으면 기본 즐겨찾기, 치트 칸이 없으면 예전 localStorage 치트 즐겨찾기(legacy, 한 번 가져오기).
 */
export function resolveFavorites(file: FavoritesFile | null, legacyCheat: Favorites | null = null): FavoritesState {
  return {
    assist: file?.assist ? [...file.assist] : [...DEFAULT_ASSIST_FAVORITES],
    cheat: file?.cheat ?? legacyCheat ?? emptyFavorites(),
  };
}

const hasCheat = (f: Favorites | null) => !!f && (f.switch.length > 0 || f.variable.length > 0);

/**
 * 읽고-고쳐-쓰기의 "고쳐": 디스크 파일(다른 뷰어가 썼을 수 있다) 위에 이 뷰어의 바꿈만 얹은 새 파일 내용.
 * - 보조 칸: 디스크에 있었거나 보조 바꿈이 있을 때만 쓴다(아니면 계속 기본값을 따른다).
 * - 치트 칸: 디스크에 있었거나, 치트 바꿈이 있거나, 가져올 예전 즐겨찾기(legacy)가 있으면 쓴다.
 */
export function mergeFavorites(disk: FavoritesFile | null, ops: readonly FavoritesOp[], legacyCheat: Favorites | null = null): Omit<FavoritesFile, "t"> {
  const s = applyFavoritesOps(resolveFavorites(disk, legacyCheat), ops);
  const writeAssist = disk?.assist != null || ops.some(touchesAssist);
  const writeCheat = disk?.cheat != null || ops.some((o) => !touchesAssist(o)) || hasCheat(legacyCheat);
  return { assist: writeAssist ? s.assist : null, cheat: writeCheat ? s.cheat : null };
}

/** 파일에 써야 하는지: 얹은 결과가 디스크와 다르다(바꿈이 있거나, 예전 치트 즐겨찾기를 아직 옮기지 않았다) */
export function favoritesNeedWrite(disk: FavoritesFile | null, ops: readonly FavoritesOp[], legacyCheat: Favorites | null = null): boolean {
  const merged = mergeFavorites(disk, ops, legacyCheat);
  if (merged.assist === null && merged.cheat === null) return false;
  return !sameFavoritesContent(disk, merged);
}

/** 다음 쓰기 시각: 지금, 그리고 디스크 파일보다 늦게 */
export const nextFavoritesT = (disk: FavoritesFile | null, now: number): number => Math.max(now, (disk?.t ?? 0) + 1);

/** 못 쓴 바꿈이 이만큼 넘게 쌓이면(쓸 수 있는 폴더가 없는 경우 등) 지금 값 통째로 묶는다 */
export const OPS_COMPACT_AT = 100;

/** 바꿈이 너무 많으면 지금 화면 값(state) 통째 두 개로 묶는다 */
export function compactFavoritesOps(ops: readonly FavoritesOp[], state: FavoritesState): FavoritesOp[] {
  if (ops.length <= OPS_COMPACT_AT) return [...ops];
  const out: FavoritesOp[] = [];
  if (ops.some(touchesAssist)) out.push({ op: "assistOrder", items: [...state.assist] });
  if (ops.some((o) => !touchesAssist(o))) out.push({ op: "cheatSet", favorites: state.cheat });
  return out;
}

/**
 * favorites.json 읽기 결과. failed(네트워크·서버 오류, 권한 등)면 쓰지 않고 다음에 다시 읽는다 —
 * "없음"으로 보고 쓰면 다른 뷰어가 만든 파일을 덮는다.
 */
export type FavoritesRead = { state: "ok"; text: string } | { state: "missing" } | { state: "failed" };

/**
 * 없음과 읽기 실패를 나눠 읽는다. readBinaryStrict(없으면 null, 못 읽으면 throw)가 있으면 그것으로,
 * 없으면 readText로 읽되 null은 확실하지 않으므로(없음인지 실패인지 모른다) failed로 본다. 예외를 던지지 않는다.
 */
export async function readFavoritesText(folder: GameFolder, path: string): Promise<FavoritesRead> {
  try {
    if (folder.readBinaryStrict) {
      const buf = await folder.readBinaryStrict(path);
      return buf === null ? { state: "missing" } : { state: "ok", text: new TextDecoder().decode(buf) };
    }
    const text = await folder.readText(path);
    return text === null ? { state: "failed" } : { state: "ok", text };
  } catch {
    return { state: "failed" };
  }
}

/** 게임별 못 쓴 바꿈(localStorage) */
export const favoritesPendingKey = (gameKey: string) => `rpgv.favoritesPending.${gameKey}`;
