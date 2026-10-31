import { useCallback, useEffect, useState } from "react";
import { useGame } from "@/app/GameProvider";
import type { AssetKind } from "@/core/assets/assets";
import { usePicturesNearViewport } from "../addons/pictureViewportContext";

type BitmapView = { status: "loading" } | { status: "ok"; image: ImageBitmap } | { status: "missing" } | { status: "failed"; retry: () => void };

/** Faces and standalone reader pictures share the decoded-image budget too. */
export function useAssetBitmap(kind: AssetKind, name: string): BitmapView {
  const { assets } = useGame();
  const enabled = usePicturesNearViewport();
  const [attempt, setAttempt] = useState(0);
  const key = `${kind}/${name}#${attempt}`;
  const [state, setState] = useState<{ key: string; assets: unknown; view: BitmapView }>();
  const retry = useCallback(() => setAttempt(n => n + 1), []);
  if (!enabled && state) setState(undefined);
  useEffect(() => {
    if (!assets || !name || !enabled) return;
    let cancelled = false;
    let release: (() => void) | undefined;
    void assets.fetch(kind, name).then(async result => {
      if (cancelled) return;
      let view: BitmapView;
      if (result.status === "ok") {
        const lease = assets.acquireImage(kind, name);
        release = lease.release;
        const image = await lease.value;
        if (cancelled) return;
        view = image ? { status: "ok", image } : { status: "missing" };
      } else view = result.status === "failed" ? { status: "failed", retry } : { status: "missing" };
      setState({ key, assets, view });
    });
    return () => { cancelled = true; release?.(); };
  }, [assets, kind, name, key, enabled, retry]);
  if (!assets || !name) return { status: "missing" };
  return enabled && state?.key === key && state.assets === assets ? state.view : { status: "loading" };
}
