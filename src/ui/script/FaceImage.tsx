import { useAssetUrl } from "./useAssetUrl";

export function FaceImage({ name, index }: { name: string; index: number }) {
  const url = useAssetUrl("faces", name);
  if (!url) return <div className="size-10 shrink-0 rounded-md bg-muted" title={name} />;
  return (
    <div
      className="size-10 shrink-0 rounded-md"
      title={name}
      style={{
        backgroundImage: `url(${url})`,
        backgroundSize: "160px 80px",
        backgroundPosition: `${-(index % 4) * 40}px ${-Math.floor(index / 4) * 40}px`,
      }}
    />
  );
}
