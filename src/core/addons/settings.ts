import { ADDONS, type AddonState } from "./registry";
import { isPictureRole, type PictureRoles, type SpriteRoles } from "./screenPictures";
import { cleanNoticeHooks } from "./notices";
import { keyText, parseKeyText } from "../story/progress";

/**
 * 게임별 애드온 설정 전체: 켜짐 상태와 화면 그림 구분(그림 번호 → 직접 고른 구분),
 * noticeHooks = 알림 문구 기록에 직접 추가한 함수 경로(없으면 없음)
 */
export interface AddonFile {
  state: AddonState; pictureRoles: PictureRoles; noticeHooks?: string[];
  /** 플러그인이 띄운 그림(1.10.0)의 이름 열쇠(spriteKeyOf) → 직접 고른 구분(없으면 없음) */
  spriteRoles?: SpriteRoles;
  /** 이야기 진행 기준(직접 고른 것, `v:12` 또는 `s:3,4,5`). 없으면 자동 */
  storyProgress?: string;
}

/**
 * 게임 폴더의 rpg-viewer/addons.json 본문(계약 v1):
 * { v: 1, enabled: { [id]: boolean }, pictureRoles?: { [그림 번호]: 구분 }, noticeHooks?: string[] }.
 * pictureRoles·noticeHooks·spriteRoles({ [이름 열쇠]: 구분 }, 1.10.0)·storyProgress(이야기 진행 기준 `v:12`·`s:3,4`)는
 * 있을 때만 쓴다(noticeHooks는 쓸 수 있는 경로만).
 */
export function addonsJson(
  state: AddonState, pictureRoles?: PictureRoles | null, noticeHooks?: readonly string[] | null, spriteRoles?: SpriteRoles | null,
  storyProgress?: string | null,
): string {
  const enabled: Record<string, boolean> = {};
  for (const a of ADDONS) enabled[a.id] = state?.[a.id] === true;
  const roles = cleanRoles(pictureRoles);
  const body: Record<string, unknown> = { v: 1, enabled };
  if (Object.keys(roles).length > 0) body.pictureRoles = roles;
  const hooks = cleanNoticeHooks(noticeHooks);
  if (hooks.length > 0) body.noticeHooks = hooks;
  const sprites = cleanSpriteRoles(spriteRoles);
  if (Object.keys(sprites).length > 0) body.spriteRoles = sprites;
  const story = cleanStoryProgress(storyProgress);
  if (story) body.storyProgress = story;
  return JSON.stringify(body, null, 2) + "\n";
}

/** 이야기 진행 기준 글(`v:12`·`s:3,4`)을 고쳐 쓴다. 못 읽으면 null */
export function cleanStoryProgress(v: unknown): string | null {
  const k = parseKeyText(v);
  return k ? keyText(k) : null;
}

const SPRITE_ROLES_MAX = 500, SPRITE_KEY_MAX = 200;

/** 이름 열쇠 → 구분(빈 열쇠·너무 긴 열쇠·모르는 구분은 버린다, 최대 500개) */
export function cleanSpriteRoles(v: unknown): SpriteRoles {
  const out: SpriteRoles = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  let n = 0;
  for (const [k, r] of Object.entries(v as Record<string, unknown>)) {
    if (n >= SPRITE_ROLES_MAX) break;
    if (k === "" || k.length > SPRITE_KEY_MAX || k === "__proto__" || !isPictureRole(r)) continue;
    out[k] = r;
    n++;
  }
  return out;
}

function cleanRoles(v: unknown): PictureRoles {
  const out: PictureRoles = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [k, r] of Object.entries(v as Record<string, unknown>)) {
    const id = Number(k);
    if (Number.isInteger(id) && id >= 1 && id <= 100000 && isPictureRole(r)) out[id] = r;
  }
  return out;
}

/** addons.json 본문(또는 저장된 값) → 켜짐 상태와 그림 구분. 모르는 값은 버린다. 읽을 수 없으면 null. 예외를 던지지 않는다. */
export function parseAddonFile(text: string | null | undefined): AddonFile | null {
  if (typeof text !== "string") return null;
  try {
    const raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown;
    if (!raw || typeof raw !== "object") return null;
    const en = (raw as { enabled?: unknown }).enabled;
    if (!en || typeof en !== "object") return null;
    const state: AddonState = {};
    for (const a of ADDONS) {
      const v = (en as Record<string, unknown>)[a.id];
      if (typeof v === "boolean") state[a.id] = v;
    }
    const file: AddonFile = { state, pictureRoles: cleanRoles((raw as { pictureRoles?: unknown }).pictureRoles) };
    const hooks = cleanNoticeHooks((raw as { noticeHooks?: unknown }).noticeHooks);
    if (hooks.length > 0) file.noticeHooks = hooks;
    const sprites = cleanSpriteRoles((raw as { spriteRoles?: unknown }).spriteRoles);
    if (Object.keys(sprites).length > 0) file.spriteRoles = sprites;
    const story = cleanStoryProgress((raw as { storyProgress?: unknown }).storyProgress);
    if (story) file.storyProgress = story;
    return file;
  } catch {
    return null;
  }
}

/** addons.json 본문(또는 저장된 값) → 상태. 모르는 id·잘못된 값은 버린다. 읽을 수 없으면 null. 예외를 던지지 않는다. */
export function parseAddons(text: string | null | undefined): AddonState | null {
  return parseAddonFile(text)?.state ?? null;
}
