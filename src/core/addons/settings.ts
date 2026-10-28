import { ADDONS, type AddonState } from "./registry";

/** 게임 폴더의 rpg-viewer/addons.json 본문(계약 v1): { v: 1, enabled: { [id]: boolean } } */
export function addonsJson(state: AddonState): string {
  const enabled: Record<string, boolean> = {};
  for (const a of ADDONS) enabled[a.id] = state?.[a.id] === true;
  return JSON.stringify({ v: 1, enabled }, null, 2) + "\n";
}

/** addons.json 본문(또는 저장된 값) → 상태. 모르는 id·잘못된 값은 버린다. 읽을 수 없으면 null. 예외를 던지지 않는다. */
export function parseAddons(text: string | null | undefined): AddonState | null {
  if (typeof text !== "string") return null;
  try {
    const raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown;
    if (!raw || typeof raw !== "object") return null;
    const en = (raw as { enabled?: unknown }).enabled;
    if (!en || typeof en !== "object") return null;
    const out: AddonState = {};
    for (const a of ADDONS) {
      const v = (en as Record<string, unknown>)[a.id];
      if (typeof v === "boolean") out[a.id] = v;
    }
    return out;
  } catch {
    return null;
  }
}
