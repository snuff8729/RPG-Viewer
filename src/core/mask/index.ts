// 가린 사본(AI 에이전트에게 줄 읽기 전용 사본). 게임은 절대 고치지 않는다 — 잘못 가려도 사본이 덜 읽힐 뿐이다.
export { cyrb53, isToken, tokenOf, TOKEN_PATTERN } from "./token";
export { hasCjkKana, hasKeyword, hasNonAsciiLetter, keywordHits } from "./detect";
export { createMaskContext, defaultSensitive, maskFileName, maskRun, maskString, tokenFor, type MaskContext, type Sensitive } from "./text";
export { maskJsonLines, maskJsonText, maskPluginsJs } from "./json";
export { countLines, maskJsLines, maskJsSource, type JsMaskResult } from "./js";
export {
  buildFreeTextIndex, keepWordsOf, maskFreeText, scanFiles, scanText, unmaskText,
  type FreeTextIndex, type ScanHit, type ScanResult, type UnmaskResult,
} from "./free";
export { maskFileText, mirrorKindOf, type MirrorKind } from "./files";
