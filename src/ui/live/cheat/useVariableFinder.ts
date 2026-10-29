import { useState } from "react";
import { emptyTracker, trackVariables, type ChangeTracker, type NarrowState } from "@/core/live/varFinder";
import type { FavoriteKind, Favorites } from "@/core/live/favorites";
import type { LiveSnapshot } from "@/core/live/types";
import { useFavorites } from "@/app/FavoritesProvider";

export type FinderMode = "favorites" | "name" | "value" | "narrow" | "recent";

/** 변수 찾기 상태: 치트 창을 닫았다 열어도(게임에서 값을 바꾸고 돌아와도) 남는다. 게임이 바뀌면 비운다. */
export interface VariableFinder {
  kind: FavoriteKind;
  setKind(k: FavoriteKind): void;
  /** 지금 종류의 보기(따로 고르지 않았으면 즐겨찾기가 있을 때 즐겨찾기, 없으면 이름·번호) */
  mode: FinderMode;
  setMode(m: FinderMode): void;
  /** 좁혀 찾기 후보(null = 아직 기억 안 함) */
  narrow: NarrowState | null;
  setNarrow(s: NarrowState | null): void;
  /** 연결된 동안 계속 보는 최근 바뀐 변수 */
  tracker: ChangeTracker;
  /** 게임 폴더별로 저장되는 즐겨찾기(rpg-viewer/favorites.json, app/FavoritesProvider) */
  favorites: Favorites;
  toggleFavorite(kind: FavoriteKind, id: number): void;
  renameFavorite(kind: FavoriteKind, id: number, nickname: string): void;
}

type Modes = Record<FavoriteKind, FinderMode | null>;

export function useVariableFinder(gameKey: string | null, live: LiveSnapshot | null): VariableFinder {
  const store = useFavorites();
  const [kind, setKind] = useState<FavoriteKind>("switch");
  const [modes, setModes] = useState<Modes>({ switch: null, variable: null });
  const [narrow, setNarrow] = useState<NarrowState | null>(null);
  const [tracker, setTracker] = useState<ChangeTracker>(emptyTracker);
  const [key, setKey] = useState(gameKey);
  const [seen, setSeen] = useState<LiveSnapshot | null>(null);
  if (key !== gameKey) {
    setKey(gameKey); setNarrow(null); setTracker(emptyTracker()); setSeen(null);
    setModes({ switch: null, variable: null });
  } else if (seen !== live) {
    // 새 live.json(값이 바뀐 것만 새 객체)마다 바뀐 변수를 적는다. 시각은 live.json을 쓴 시각
    // (뷰어도 게임 시계와 비교해 연결 여부를 판단하므로 같은 시계로 본다)
    setSeen(live);
    setTracker((t) => trackVariables(t, live, typeof live?.t === "number" ? live.t : 0));
  }
  const favorites = store.cheatFavorites;
  const picked = modes[kind];
  const mode: FinderMode = picked ?? (favorites[kind].length > 0 ? "favorites" : "name");
  const update = (changed: boolean) => {
    // 별을 눌러도 보던 화면이 바뀌지 않게, 저절로 고른 보기를 지금 것으로 굳힌다
    if (changed && picked === null) setModes((s) => ({ ...s, [kind]: mode }));
  };
  return {
    kind, setKind, mode,
    setMode: (m) => setModes((s) => ({ ...s, [kind]: kind === "switch" && m !== "favorites" ? "name" : m })),
    narrow, setNarrow, tracker, favorites,
    toggleFavorite: (k, id) => update(store.toggleCheatFavorite(k, id)),
    renameFavorite: (k, id, nick) => update(store.renameCheatFavorite(k, id, nick)),
  };
}
