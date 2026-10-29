import type { Engine } from "@/core/types";

export interface EngineHints {
  /** 게임 js/ 폴더 바로 아래 파일 이름들(없으면 []) */
  jsFiles: readonly string[];
  /** 데이터 폴더 경로("www/data" 또는 "data") */
  dataRoot: string;
  /** System.json에 MZ 전용 `advanced` 항목이 있는지 */
  hasAdvanced: boolean;
}

/**
 * MV/MZ 판별. 엔진 코어 파일이 가장 확실하다(MZ: rmmz_core.js, MV: rpg_core.js).
 * 코어 파일이 없으면 www/ 배치는 MV, 그 밖에는 System.json의 `advanced`(MZ에만 있음)로 본다.
 * `advanced`는 MV 게임에도 플러그인·변환 도구가 남기는 일이 있어 마지막 근거로만 쓴다.
 */
export function detectEngine(h: EngineHints): Engine {
  const names = new Set(h.jsFiles.map((n) => String(n).toLowerCase()));
  if (names.has("rmmz_core.js")) return "MZ";
  if (names.has("rpg_core.js")) return "MV";
  if (/^www\//i.test(h.dataRoot)) return "MV";
  return h.hasAdvanced ? "MZ" : "MV";
}
