import { AssetPlaceholder } from "./AssetPlaceholder";
import { useAsset } from "./useAssetUrl";

export function FaceImage({ name, index }: { name: string; index: number }) {
  const a = useAsset("faces", name);
  if (a.status === "missing" || a.status === "failed") return <AssetPlaceholder view={a} name={name} compact className="size-10" />;
  if (a.status !== "ok") return <div className="size-10 shrink-0 rounded-md bg-muted" title={name} />;
  return (
    <div
      className="size-10 shrink-0 rounded-md"
      title={name}
      style={{
        backgroundImage: `url(${a.url})`,
        backgroundSize: "160px 80px",
        backgroundPosition: `${-(index % 4) * 40}px ${-Math.floor(index / 4) * 40}px`,
      }}
    />
  );
}
