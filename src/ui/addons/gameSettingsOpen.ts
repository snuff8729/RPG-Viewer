import { formatRoute } from "@/app/route";
/** 어디서든 같은 관리 섹션으로 이동해요. */
export function openGameSettings(): void { window.location.hash = formatRoute({ kind: "manage", section: "settings" }); }
