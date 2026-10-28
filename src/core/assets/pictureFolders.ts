import { parsePluginsJs } from "@/core/live/installer";

/**
 * 그림 이름에 든 글자로 하위 폴더를 고르는 플러그인(BY_PictureClassify)의 규칙 하나:
 * 파일 이름(마지막 칸)에 token이 들어 있으면 그 파일은 같은 폴더 아래 folder/ 안에 있다.
 * 예: { token: "cg_09", folder: "cg_09" } 이면 Show Picture "cg_09_0_06" → img/pictures/cg_09/cg_09_0_06.png.
 */
export interface FolderRule { token: string; folder: string }

/** 플러그인 파라미터 값(JSON 글로 겹겹이 싼 것)을 푼다. 못 풀면 그대로. */
const unwrap = (v: unknown): unknown => {
  let cur = v;
  for (let i = 0; i < 4 && typeof cur === "string"; i++) {
    try { cur = JSON.parse(cur); } catch { break; }
  }
  return cur;
};

/**
 * plugins.js 텍스트에서 켜진 BY_PictureClassify(플러그인 켜짐 + `switch` 파라미터 true)의 폴더 규칙(설정 순서대로).
 * 이 플러그인은 ImageManager.loadNormalBitmap 등을 바꿔, 모든 그림 폴더에서 파일 이름에 token이 든 그림을
 * folder 하위 폴더에서 읽는다. 없으면 []. 예외를 던지지 않는다.
 */
export function pictureFolderRulesFromPlugins(text: string | null | undefined): FolderRule[] {
  try {
    if (typeof text !== "string") return [];
    const out: FolderRule[] = [];
    for (const e of parsePluginsJs(text) ?? []) {
      if (!e || typeof e !== "object" || e.status !== true || e.name !== "BY_PictureClassify") continue;
      const params = e.parameters && typeof e.parameters === "object" ? e.parameters as Record<string, unknown> : {};
      if (unwrap(params.switch) !== true) continue;
      const list = unwrap(params.tokens);
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const o = unwrap(item);
        if (!o || typeof o !== "object") continue;
        const rec = o as Record<string, unknown>;
        const token = typeof rec.token === "string" ? rec.token : "";
        const folder = typeof rec.floderToken === "string" ? rec.floderToken.replace(/^\/+|\/+$/g, "") : "";
        if (token !== "" && folder !== "") out.push({ token, folder });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * 규칙대로 옮긴 이름(확장자 없는 이름, 하위 폴더 포함 가능). 맞는 규칙이 없거나 이미 그 폴더 안의 이름이면 null.
 * 게임처럼 파일 이름(마지막 칸)에 token이 든 첫 규칙을 쓴다(대소문자 구분).
 */
export function classifiedName(name: string, rules: readonly FolderRule[] | undefined): string | null {
  try {
    if (!rules || rules.length === 0 || name === "") return null;
    const slash = name.lastIndexOf("/");
    const dir = slash >= 0 ? name.slice(0, slash + 1) : "";
    const base = slash >= 0 ? name.slice(slash + 1) : name;
    if (base === "") return null;
    const rule = rules.find((r) => base.includes(r.token));
    if (!rule) return null;
    // 기록 플러그인이 읽힌 그림 주소로 적은 이름("cg_09/cg_09_0_06")은 이미 옮겨진 것
    if (dir === `${rule.folder}/` || dir.endsWith(`/${rule.folder}/`)) return null;
    return `${dir}${rule.folder}/${base}`;
  } catch {
    return null;
  }
}
