import { useEffect, useState } from "react";
import { useGame } from "@/app/GameProvider";
import { loadMapTiles, type MapTiles, type TilesetInfo } from "@/core/map/tiles";

export interface LoadedTiles {
  map: MapTiles;
  tileset: TilesetInfo;
  /** tileset.names와 같은 순서(A1..A5,B..E). 이름이 없거나 못 읽으면 null */
  sheets: (ImageBitmap | null)[];
}
export type TilesState = { status: "loading" } | { status: "failed" } | { status: "ready"; tiles: LoadedTiles };

/** 지금 맵의 타일 데이터와 타일셋 그림. 그림을 하나도 못 읽으면 failed(옛 격자로 대신 보여준다). */
export function useMapTiles(mapId: number | null): TilesState {
  const { folder, data, assets } = useGame();
  const [state, setState] = useState<{ key: unknown[]; value: TilesState } | null>(null);
  const key = [folder, data, assets, mapId];

  useEffect(() => {
    if (!folder || !data || !assets || mapId == null) return;
    let alive = true;
    const k = [folder, data, assets, mapId];
    void (async () => {
      const loaded = await loadMapTiles(folder, data, mapId);
      if (!loaded) { if (alive) setState({ key: k, value: { status: "failed" } }); return; }
      const sheets = await Promise.all(loaded.tileset.names.map((n) => assets.image("tilesets", n)));
      if (!alive) return;
      const ok = sheets.some((s) => s !== null);
      setState({ key: k, value: ok ? { status: "ready", tiles: { ...loaded, sheets } } : { status: "failed" } });
    })();
    return () => { alive = false; };
  }, [folder, data, assets, mapId]);

  if (!folder || !data || !assets || mapId == null) return { status: "failed" };
  if (!state || state.key.some((v, i) => v !== key[i])) return { status: "loading" };
  return state.value;
}
