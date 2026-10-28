import type { AdapterViewer } from "@/core/adapters/bundle";
import type { StandGroup } from "@/core/addons/screenPictures";

/** 겹 이름(ベース·目·口…)을 그리는 순서대로, 같은 것은 한 번 */
function layersOf(g: StandGroup): string[] {
  const out: string[] = [];
  for (const p of g.pictures) {
    const l = p.tag?.layer;
    if (l && !out.includes(l)) out.push(l);
  }
  return out;
}

/** CharacterPictureManager: 배우별 스탠딩 이름과, 마우스를 올리면 겹 이름 */
export const viewer: AdapterViewer = {
  standGroupLabel(g) {
    if (g.actorName) return `${g.actorName} 스탠딩`;
    return typeof g.actorId === "number" ? `배우 ${g.actorId} 스탠딩` : null;
  },
  standGroupTitle(g) {
    const layers = layersOf(g);
    return layers.length > 0 ? `겹: ${layers.join(" · ")}` : null;
  },
};
