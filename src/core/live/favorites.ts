import { searchSystem, type SearchEntry } from "./cheat";

/**
 * 치트 창 스위치·변수 즐겨찾기(게임별로 저장). 별명은 게임 원래 이름(대개 일본어) 대신 보이는 이름(예: "공격력").
 * 모든 함수는 예외를 던지지 않고, 새 객체를 돌려준다.
 */
export type FavoriteKind = "switch" | "variable";

export interface Favorite {
  id: number;
  /** 사용자가 붙인 별명(빈 문자열 = 없음) */
  nickname: string;
}

export interface Favorites {
  switch: Favorite[];
  variable: Favorite[];
}

/** 별명 최대 길이 */
export const NICKNAME_MAX = 40;
/** 종류별 즐겨찾기 최대 개수 */
export const FAVORITES_MAX = 200;

export const emptyFavorites = (): Favorites => ({ switch: [], variable: [] });

/** 게임별 저장 키(localStorage) */
export const favoritesStorageKey = (gameKey: string) => `rpgv.cheatFavorites.${gameKey}`;

const cleanNickname = (s: unknown): string => (typeof s === "string" ? s.trim().slice(0, NICKNAME_MAX) : "");

function parseList(v: unknown): Favorite[] {
  if (!Array.isArray(v)) return [];
  const out: Favorite[] = [];
  const seen = new Set<number>();
  for (const x of v) {
    const id = typeof x === "number" ? x : typeof x === "object" && x !== null ? (x as { id?: unknown }).id : undefined;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1 || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, nickname: typeof x === "object" && x !== null ? cleanNickname((x as { nickname?: unknown }).nickname) : "" });
    if (out.length >= FAVORITES_MAX) break;
  }
  return out;
}

/** 저장된 글 → 즐겨찾기. 없거나 깨졌으면 빈 것. */
export function parseFavorites(raw: string | null | undefined): Favorites {
  if (typeof raw !== "string" || raw === "") return emptyFavorites();
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return emptyFavorites();
    const o = v as Record<string, unknown>;
    return { switch: parseList(o.switch), variable: parseList(o.variable) };
  } catch {
    return emptyFavorites();
  }
}

export const serializeFavorites = (f: Favorites): string => JSON.stringify({ switch: f.switch, variable: f.variable });

export const findFavorite = (f: Favorites, kind: FavoriteKind, id: number): Favorite | undefined => f[kind].find((x) => x.id === id);

/** 별 누르기: 없으면 끝에 넣고, 있으면 뺀다 */
export function toggleFavorite(f: Favorites, kind: FavoriteKind, id: number): Favorites {
  if (!Number.isSafeInteger(id) || id < 1) return f;
  const list = f[kind];
  if (list.some((x) => x.id === id)) return { ...f, [kind]: list.filter((x) => x.id !== id) };
  if (list.length >= FAVORITES_MAX) return f;
  return { ...f, [kind]: [...list, { id, nickname: "" }] };
}

/** 별명 바꾸기(빈 글 = 별명 지우기). 즐겨찾기가 아니면 즐겨찾기에 넣으면서 붙인다. */
export function renameFavorite(f: Favorites, kind: FavoriteKind, id: number, nickname: string): Favorites {
  const nick = cleanNickname(nickname);
  const list = f[kind];
  if (list.some((x) => x.id === id)) return { ...f, [kind]: list.map((x) => (x.id === id ? { ...x, nickname: nick } : x)) };
  const added = toggleFavorite(f, kind, id);
  return added === f ? f : renameFavorite(added, kind, id, nick);
}

/** 즐겨찾기 목록을 보이는 항목으로(원래 이름 붙여서), 넣은 순서대로 */
export function favoriteEntries(f: Favorites, kind: FavoriteKind, names: readonly unknown[] | undefined): (SearchEntry & { nickname: string })[] {
  return f[kind].map((x) => ({ id: x.id, name: Array.isArray(names) && typeof names[x.id] === "string" ? (names[x.id] as string) : "", nickname: x.nickname }));
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/** 이름·번호 검색 + 별명: 별명이 맞는 즐겨찾기를 먼저, 그 뒤 원래 검색(겹치면 한 번만) */
export function searchWithNicknames(
  names: readonly unknown[] | undefined, f: Favorites, kind: FavoriteKind, query: string, limit = 200,
): SearchEntry[] {
  const q = norm(typeof query === "string" ? query : "");
  const first: SearchEntry[] = [];
  if (q !== "") {
    for (const e of favoriteEntries(f, kind, names)) if (e.nickname !== "" && norm(e.nickname).includes(q)) first.push({ id: e.id, name: e.name });
  }
  const ids = new Set(first.map((e) => e.id));
  const rest = searchSystem(names, query, limit + first.length).filter((e) => !ids.has(e.id));
  return [...first, ...rest].slice(0, Math.max(0, limit));
}
