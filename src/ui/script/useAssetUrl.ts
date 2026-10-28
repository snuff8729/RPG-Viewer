import { useEffect, useState } from "react";
import { useGame } from "@/app/GameProvider";
import type { AssetKind } from "@/core/assets/assets";

/** undefined = 로딩 중, null = 없음/실패. Blob은 object URL로 만들고 unmount 시 revoke. */
export function useAssetUrl(kind: AssetKind, name: string): string | null | undefined {
  const { assets } = useGame();
  const key = `${kind}/${name}`;
  const [state, setState] = useState<{ key: string; assets: unknown; url: string | null }>();

  useEffect(() => {
    if (!assets) return;
    let cancelled = false;
    let created: string | null = null;
    assets.load(kind, name).then(
      (blob) => {
        if (cancelled) return;
        created = blob ? URL.createObjectURL(blob) : null;
        setState({ key, assets, url: created });
      },
      () => { if (!cancelled) setState({ key, assets, url: null }); },
    );
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [assets, kind, name, key]);

  if (!assets) return null;
  return state && state.key === key && state.assets === assets ? state.url : undefined;
}
