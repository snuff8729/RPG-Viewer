import { useLayoutEffect, useRef } from "react";
import { AssetPlaceholder } from "./AssetPlaceholder";
import { FACE_CELL } from "./faceCrop";
import { useAssetBitmap } from "./useAssetBitmap";
import { PictureViewport } from "../addons/PictureViewport";

export function FaceImage({ name, index }: { name: string; index: number }) {
  return <PictureViewport placeholderHeight={40} className="size-10 shrink-0"><Face name={name} index={index} /></PictureViewport>;
}

function Face({ name, index }: { name: string; index: number }) {
  const a = useAssetBitmap("faces", name);
  const ref = useRef<HTMLCanvasElement>(null);
  const image = a.status === "ok" ? a.image : null;
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas || !image) return;
    const size = Math.round(40 * (window.devicePixelRatio || 1));
    canvas.width = canvas.height = size;
    const i = Number.isFinite(index) && index > 0 ? Math.floor(index) : 0;
    canvas.getContext("2d")?.drawImage(image, -(i % 4) * size, -Math.floor(i / 4) * size, image.width * size / FACE_CELL, image.height * size / FACE_CELL);
    return () => { canvas.width = canvas.height = 0; };
  }, [image, index]);
  if (a.status === "missing" || a.status === "failed") return <AssetPlaceholder view={a} kind="faces" name={name} compact className="size-10" />;
  if (a.status !== "ok") return <div className="size-10 shrink-0 rounded-md bg-muted" title={name} />;
  return <canvas ref={ref} width={0} height={0} className="size-10 shrink-0 rounded-md" title={name} />;
}
