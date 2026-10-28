import { useCallback, useEffect, useState } from "react";
import { useGame } from "@/app/GameProvider";
import type { AssetKind } from "@/core/assets/assets";

export type AssetView =
  | { status: "loading" }
  | { status: "ok"; url: string }
  | { status: "missing" }
  | { status: "failed"; retry: () => void };

type Loaded = { status: "ok"; url: string } | { status: "missing" } | { status: "failed" };

/** 그림 하나의 상태. Blob은 object URL로 만들고 unmount 시 revoke. failed면 retry()로 다시 읽는다. */
export function useAsset(kind: AssetKind, name: string): AssetView {
  const { assets } = useGame();
  const [attempt, setAttempt] = useState(0);
  const key = `${kind}/${name}#${attempt}`;
  const [state, setState] = useState<{ key: string; assets: unknown; value: Loaded }>();
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!assets) return;
    let cancelled = false;
    let created: string | null = null;
    assets.fetch(kind, name).then(
      (r) => {
        if (cancelled) return;
        if (r.status === "ok") {
          created = URL.createObjectURL(r.blob);
          setState({ key, assets, value: { status: "ok", url: created } });
        } else setState({ key, assets, value: { status: r.status } });
      },
      () => { if (!cancelled) setState({ key, assets, value: { status: "failed" } }); },
    );
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [assets, kind, name, key]);

  if (!assets) return { status: "missing" };
  if (!state || state.key !== key || state.assets !== assets) return { status: "loading" };
  return state.value.status === "failed" ? { status: "failed", retry } : state.value;
}
