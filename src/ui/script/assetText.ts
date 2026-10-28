import type { AssetKind } from "@/core/assets/assets";

/** 게임 폴더에 없는 그림 문구. 얼굴은 `얼굴 그림 없음: {name}`, 그 밖은 폴더 이름과 (있으면) 그림 번호를 붙인다. */
export function missingAssetText(kind: AssetKind, name: string, pictureId?: number): string {
  if (kind === "faces") return `얼굴 그림 없음: ${name}`;
  const no = typeof pictureId === "number" && pictureId > 0 ? ` #${pictureId}` : "";
  return `게임 폴더에 없는 그림${no}: ${name} (${kind})`;
}
