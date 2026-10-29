// 가린 사본에 무엇을 어떻게 옮길지: 게임 폴더 안 경로 → 종류. 글 파일은 종류에 맞게 가리고, 그림·소리·영상은 빈 파일(이름만 가림).
import { maskJsonLines, maskJsonText, maskPluginsJs } from "./json";
import { maskJsSource } from "./js";
import { maskString, type MaskContext } from "./text";

export type MirrorKind = "json" | "jsonl" | "plugins" | "pluginJs" | "text" | "placeholder";

const RV_FILES = new Set(["log.jsonl", "live.json", "addons.json", "meta.json"]);

/**
 * 게임 루트 기준 경로(`/` 구분)와 데이터가 있는 바탕 폴더(MV `www`, MZ ``) → 옮길 종류. 안 옮기면 null(세이브 등).
 * 대소문자는 가리지 않는다.
 */
export function mirrorKindOf(rel: string, base: string): MirrorKind | null {
  const p = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  const lower = p.toLowerCase();
  const b = base ? base.toLowerCase() + "/" : "";
  if (lower === "package.json") return "json";
  if (lower === "index.html" || lower === `${b}index.html`) return "text";
  if (b && lower === `${b}package.json`) return "json";
  if (!lower.startsWith(b)) return null;
  const r = lower.slice(b.length);
  const segs = r.split("/");
  if (segs.length === 2 && segs[0] === "data" && segs[1].endsWith(".json")) return "json";
  if (r === "js/plugins.js") return "plugins";
  if (segs[0] === "js" && segs[1] === "plugins" && segs.length >= 3 && r.endsWith(".js")) return "pluginJs";
  if (segs.length === 2 && segs[0] === "rpg-viewer" && RV_FILES.has(segs[1])) return segs[1].endsWith(".jsonl") ? "jsonl" : "json";
  if ((segs[0] === "img" || segs[0] === "audio" || segs[0] === "movies") && segs.length >= 2) return "placeholder";
  return null;
}

/** 글 파일 하나를 종류대로 가린다(예외 없음). fallback: JS 문법을 못 읽어 줄 단위로 가렸는지. */
export function maskFileText(kind: MirrorKind, text: string, ctx?: MaskContext): { text: string; fallback: boolean } {
  try {
    switch (kind) {
      case "json": return { text: maskJsonText(text, ctx), fallback: false };
      case "jsonl": return { text: maskJsonLines(text, ctx), fallback: false };
      case "plugins": return { text: maskPluginsJs(text, ctx), fallback: false };
      case "pluginJs": return maskJsSource(text, ctx);
      case "text": return { text: maskString(text, ctx), fallback: false };
      default: return { text: "", fallback: false };
    }
  } catch { return { text: maskString(String(text), ctx), fallback: true }; }
}
