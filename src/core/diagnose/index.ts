import type { AddonFile } from "../addons/settings";
import type { DiagnoseSettings } from "./types";

export * from "./types";
export { diagnoseGame, PICTURE_COPY_MIN_VERSION, PICTURE_WANTS_MAX, pictureWants, pictureWantsText } from "./diagnose";
export { attentionCount, needsAttention, recommendedActions, reportMarkdown, STATUS_LABELS } from "./report";
export { gatherDiagnosisInput, listPictureCopies, listPictures, parseLogText, type GatheredInput } from "./gather";
export { isKnownPlugin, KNOWN_PLUGINS, scanPluginSource, unknownPluginsOf, type PluginScan } from "./knowledge";

/** 저장된 게임 설정(addons.json) → 진단이 보는 설정 */
export function settingsOfAddonFile(file: AddonFile | null | undefined): DiagnoseSettings {
  if (!file) return {};
  return {
    addons: file.state ?? {},
    ...(file.adapters ? { adapters: file.adapters } : {}),
    ...(file.spriteRoles ? { spriteRoles: file.spriteRoles } : {}),
  };
}
