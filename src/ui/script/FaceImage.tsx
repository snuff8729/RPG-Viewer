import { useEffect, useState } from "react";
import { AssetPlaceholder } from "./AssetPlaceholder";
import { faceBackground } from "./faceCrop";
import { useAsset } from "./useAssetUrl";

/** 그림의 원래 크기(읽기 전·실패면 null) */
function useNaturalSize(url: string | null): { w: number; h: number } | null {
  const [size, setSize] = useState<{ url: string; w: number; h: number } | null>(null);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => { if (!cancelled && img.naturalWidth > 0) setSize({ url, w: img.naturalWidth, h: img.naturalHeight }); };
    img.src = url;
    return () => { cancelled = true; img.onload = null; };
  }, [url]);
  return size && size.url === url ? size : null;
}

export function FaceImage({ name, index }: { name: string; index: number }) {
  const a = useAsset("faces", name);
  const size = useNaturalSize(a.status === "ok" ? a.url : null);
  if (a.status === "missing" || a.status === "failed") return <AssetPlaceholder view={a} kind="faces" name={name} compact className="size-10" />;
  if (a.status !== "ok" || !size) return <div className="size-10 shrink-0 rounded-md bg-muted" title={name} />;
  return (
    <div
      className="size-10 shrink-0 rounded-md"
      title={name}
      style={{ backgroundImage: `url(${a.url})`, ...faceBackground(index, size.w, size.h) }}
    />
  );
}
